# Deployment Guide v2 — Remote Linux Cron via Windows Browser

**Target:** Windows 11 laptop → React UI → Red Hat Linux (Python 2.7.5) on same LAN
**Time:** ~30 minutes once you have SSH access confirmed

---

## Prerequisites

- SSH access to the Red Hat box (username + password or key)
- The Linux box IP address on your LAN (e.g. `192.168.1.50`)
- Node.js installed on Windows (for the React dev server)

---

## Step 1 — Confirm SSH works from Windows

Open PowerShell and run:

```powershell
ssh -V
```

If you see a version number (e.g. `OpenSSH_8.x`), you're done — Windows OpenSSH is available.

If not, install it: **Settings → Apps → Optional Features → Add a feature → OpenSSH Client**

Test the connection:

```powershell
ssh your_username@192.168.1.50
```

If that logs you in, SSH is working. Type `exit` to close.

---

## Step 2 — Copy cron_api.py to the Linux server

From PowerShell on Windows:

```powershell
scp "C:\Users\butto\Documents\AI\MyMemory\Projects\cron-visualizer\server\cron_api.py" your_username@192.168.1.50:~/cron_api.py
```

**Alternative (GUI):** Use WinSCP (free) — connect to the server, drag cron_api.py to the home directory.

---

## Step 3 — Set your secret token

SSH into the server and open the file:

```bash
ssh your_username@192.168.1.50
nano ~/cron_api.py
```

Change line 19:

```python
TOKEN = "CHANGE_ME_BEFORE_DEPLOY"
```

to something only you know, e.g.:

```python
TOKEN = "richcron2026"
```

Save and exit (Ctrl+X, Y, Enter in nano).

**Also update the matching line in CronVisualizer.jsx on Windows:**

```js
const API_TOKEN = "richcron2026";   // must match TOKEN in cron_api.py
```

---

## Step 4 — Open port 8765 on Linux firewall

Still SSH'd in, run:

```bash
sudo iptables -I INPUT -p tcp --dport 8765 -j ACCEPT
```

**Test it:** From a second PowerShell window on Windows, run:

```powershell
curl http://192.168.1.50:8765/health
```

You should see: `{"status": "ok"}`

If you get "connection refused" → the API isn't running yet (Step 5).
If you get "no response" / timeout → firewall is blocking it (see SSH tunnel fallback below).

---

## Step 5 — Start cron_api.py on Linux

```bash
nohup python ~/cron_api.py > ~/cron_api.log 2>&1 &
```

This starts it in the background and survives your SSH session ending.

Confirm it's running:

```bash
ps aux | grep cron_api
```

Check logs if something's wrong:

```bash
cat ~/cron_api.log
```

Expected output in the log: `Cron API listening on port 8765  (token auth required)`

---

## Step 6 — Update API_URL in CronVisualizer.jsx

Open `CronVisualizer.jsx` on Windows and set the real IP at the top:

```js
const API_URL   = "http://192.168.1.50:8765";  // your actual Linux IP
const API_TOKEN = "richcron2026";               // must match cron_api.py
```

---

## Step 7 — Run the React app on Windows

```powershell
cd "C:\Users\butto\Documents\AI\MyMemory\Projects\cron-visualizer"
npm run dev
```

Open your browser to: **http://localhost:3131**

You should see your real Linux cron jobs listed in the UI.

---

## Step 8 — Keep cron_api.py running after reboot (optional)

Add a cron entry on the Linux box to auto-restart the API:

```bash
crontab -e
```

Add this line:

```
@reboot nohup python /home/your_username/cron_api.py > /home/your_username/cron_api.log 2>&1 &
```

---

## Fallback — SSH Tunnel (if Step 4 firewall doesn't work)

If the firewall can't be opened (no sudo/root), use an SSH tunnel instead.
This runs in the background on Windows and forwards a local port through SSH to the Linux box.

**Option A — Windows OpenSSH (PowerShell):**

```powershell
ssh -N -L 8765:localhost:8765 your_username@192.168.1.50
```

Leave this terminal open. Now the React app can reach the Linux API at `http://localhost:8765`.

Update `CronVisualizer.jsx`:

```js
const API_URL = "http://localhost:8765";
```

**Option B — PuTTY (GUI):**

1. Open PuTTY → enter hostname: `192.168.1.50`, port `22`
2. Go to Connection → SSH → Tunnels
3. Source port: `8765`, Destination: `localhost:8765`, click Add
4. Go back to Session, click Open
5. Log in — leave the window open

Same result: React hits `http://localhost:8765` which tunnels to Linux.

---

## Quick Reference

| What | Where |
|------|-------|
| API server script | `~/cron_api.py` on Linux |
| API logs | `~/cron_api.log` on Linux |
| React app | `C:\...\cron-visualizer\` on Windows |
| Default port | 8765 |
| Health check | `http://LINUX_IP:8765/health` (no token needed) |
| Stop the API | `pkill -f cron_api.py` on Linux |

---

*DEPLOYMENT_v2.md · Sprint 4 · 2026-04-22*
