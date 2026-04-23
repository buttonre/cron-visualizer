# Cron Visualizer — Deployment Guide
## Linux Server + SSH Tunnel Access from Windows

---

## Overview

The Cron Visualizer is a React component. To run it as a standalone web app you can
reach from your Windows machine, you need:

1. A small **Flask + React** (or Vite) server running on the Linux box
2. An **SSH tunnel** from your Windows PC to the Linux server's local port
3. *(Optional)* A config file so the app knows which tasks to load

---

## What You Need on the Linux Server

| Requirement | Version |
|---|---|
| Python 3 | 3.8+ |
| pip | any |
| Node.js | 16+ (for building React) |
| npm | any |

---

## Step 1 — Copy Files to the Linux Server

From your Windows machine (using SCP or WinSCP):

```bash
# From Windows PowerShell or Git Bash
scp -r "C:\path\to\cron-visualizer" your_user@linux-server-ip:/home/your_user/cron-visualizer
```

Or use **WinSCP** (GUI) — connect to the Linux server, drag the folder over.

---

## Step 2 — Build the React App on the Linux Server

SSH into the Linux server first:

```bash
ssh your_user@linux-server-ip
```

Then set up and build:

```bash
cd ~/cron-visualizer

# Install Node deps and scaffold a Vite app (one-time setup)
npm create vite@latest cron-app -- --template react
cd cron-app

# Copy your component in
cp ../CronVisualizer.jsx src/App.jsx

# Edit src/main.jsx to import App (it already does by default)
# Install and build
npm install
npm run build
```

This produces a `dist/` folder — your static web app.

---

## Step 3 — Serve It with Python (Simplest Option)

No extra packages needed. From the `dist/` directory:

```bash
cd ~/cron-visualizer/cron-app/dist
python3 -m http.server 8765
```

The app is now running on **port 8765** on the Linux server — but only accessible locally on that machine. That's fine — the SSH tunnel handles the rest.

To keep it running after you disconnect:

```bash
nohup python3 -m http.server 8765 &
# or use screen / tmux
screen -S cron-viz
python3 -m http.server 8765
# Ctrl+A, D to detach
```

---

## Step 4 — SSH Tunnel from Windows

This is the key step. You're forwarding a local port on your Windows PC through SSH to the Linux server's port 8765.

### Option A — PowerShell / Command Prompt (built-in SSH)

```powershell
ssh -L 8765:localhost:8765 your_user@linux-server-ip -N
```

- `-L 8765:localhost:8765` — forward Windows port 8765 → Linux port 8765
- `-N` — no remote command, just the tunnel
- Leave this window open while you're using the app

Then open your browser on Windows:

```
http://localhost:8765
```

That's it. You're hitting the app running on the Linux server.

### Option B — PuTTY (if you prefer a GUI)

1. Open PuTTY → enter your Linux server IP, port 22
2. Go to **Connection → SSH → Tunnels**
3. Source port: `8765`
4. Destination: `localhost:8765`
5. Click **Add**, then **Open**
6. Log in normally — tunnel stays open as long as the PuTTY session is open

### Option C — Make It Automatic (Windows Task Scheduler)

Create a `.bat` file:

```bat
@echo off
ssh -L 8765:localhost:8765 -N -o StrictHostKeyChecking=no your_user@linux-server-ip
```

Save as `cron-tunnel.bat` and add it to Task Scheduler to run at login.
Use SSH key auth (no password) so it runs silently.

---

## Step 5 — SSH Key Auth (Recommended — Skips Password Prompts)

On your **Windows machine**:

```powershell
# Generate a key pair (if you don't have one)
ssh-keygen -t ed25519 -C "rich-windows"
# Accept defaults — saves to C:\Users\YourName\.ssh\id_ed25519
```

Copy the public key to the Linux server:

```powershell
type C:\Users\YourName\.ssh\id_ed25519.pub | ssh your_user@linux-server-ip "cat >> ~/.ssh/authorized_keys"
```

After this, `ssh your_user@linux-server-ip` connects without a password.

---

## Step 6 — Config File (Optional but Recommended)

If you want the app to load real task data instead of the seed data hardcoded in the
component, add a `config.json` next to the built app:

```json
{
  "tasks": [
    {
      "taskId":        "brain-trust-inbox-watcher",
      "description":   "Brain Trust Inbox Watcher",
      "cronExpression": "*/30 * * * *",
      "enabled":       true
    },
    {
      "taskId":        "nightly-obsidian-summary",
      "description":   "Nightly Obsidian Summary",
      "cronExpression": "45 23 * * *",
      "enabled":       true
    }
  ]
}
```

Then update `CronVisualizer.jsx` to fetch it at startup:

```jsx
useEffect(() => {
  fetch("/config.json")
    .then(r => r.json())
    .then(data => setTasks(data.tasks))
    .catch(() => setTasks(SEED_TASKS)); // fallback to seed data
}, []);
```

Rebuild after any change:

```bash
cd ~/cron-visualizer/cron-app
npm run build
```

---

## Quick-Start Cheat Sheet

```
LINUX SERVER (do once, then leave running):
  cd ~/cron-visualizer/cron-app/dist
  nohup python3 -m http.server 8765 &

WINDOWS (every time you want to use the app):
  ssh -L 8765:localhost:8765 your_user@linux-server-ip -N
  → open browser → http://localhost:8765
```

---

## Port Reference

| Port | Where | What |
|---|---|---|
| 8765 | Linux server | Python http.server serving the built React app |
| 8765 | Windows (local) | SSH tunnel endpoint — maps to Linux:8765 |
| 22 | Linux server | SSH (standard) |

You can change 8765 to any unused port — just keep both sides of the tunnel consistent.

---

## Notes

- **cron itself lives on the Linux server** — the visualizer just reads and displays it. No cron data leaves the server except through your SSH session.
- **No firewall changes needed** — the tunnel rides over your existing SSH port (22).
- **Same network required** — this setup assumes Windows and Linux are on the same LAN (or you're VPN'd in). If you need remote access from outside the network, you'd need to expose port 22 externally or use a VPN.
- **Production upgrade path**: swap Python's http.server for Flask or Nginx if you want the config API, auth, or live crontab reads down the road.
