# Deployment Guide v2 — Cron Visualizer

**Setup:** Windows laptop → React UI → Red Hat Linux (Python 2.7.5) on same LAN via SSH tunnel
**Time:** ~20 minutes

---

## What You Need

- SSH access to the Red Hat Linux box (username + password)
- The Linux box IP address (e.g. `192.168.1.50`)
- Node.js installed on Windows
- The cron-visualizer repo cloned on Windows

---

## One-Time Setup

### Step 1 — Clone the repo (skip if already done)

```powershell
git clone https://github.com/buttonre/cron-visualizer.git
cd cron-visualizer
npm install
```

### Step 2 — Copy cron_api.py to the Linux box

```powershell
scp server\cron_api.py your_username@YOUR_LINUX_IP:~/cron_api.py
```

Or use WinSCP (free GUI) to drag the file over.

### Step 3 — Set your secret token on Linux

SSH in and edit the file:

```bash
ssh your_username@YOUR_LINUX_IP
nano ~/cron_api.py
```

Change line 19:

```python
TOKEN = "CHANGE_ME_BEFORE_DEPLOY"
```

to something only you know:

```python
TOKEN = "richcron2026"
```

Save (Ctrl+X, Y, Enter).

### Step 4 — Set the same token in CronVisualizer.jsx on Windows

Open `CronVisualizer.jsx` and update lines 4–5:

```js
const API_URL   = "http://localhost:8765";  // leave as localhost — tunnel handles it
const API_TOKEN = "richcron2026";           // must match TOKEN in cron_api.py
```

### Step 5 — Start cron_api.py on Linux

```bash
nohup python ~/cron_api.py > /dev/null 2>&1 &
```

Confirm it's running:

```bash
ps aux | grep cron_api
```

### Step 6 — Auto-start cron_api.py on reboot (silent)

Add a cron entry so it starts automatically with no output:

```bash
crontab -e
```

Add this line:

```
@reboot nohup python /home/your_username/cron_api.py > /dev/null 2>&1 &
```

Save and exit. The API will now start silently on every reboot with no logs or output.

---

## Every Day — Run Order

Run these steps in order each time you want to use the visualizer.

**Step 1 — Open an SSH tunnel** (Terminal/PowerShell window #1 — leave it open)

```powershell
ssh -N -L 8765:127.0.0.1:8765 your_username@YOUR_LINUX_IP
```

Type your password and hit Enter. It will sit there silently — that's correct. Do not close this window.

**Step 2 — Start the React app** (Terminal/PowerShell window #2)

```powershell
cd C:\users\your_username\workspace\cron-visualizer
npm run dev
```

**Step 3 — Open the browser**

```
http://localhost:3131
```

---

## Quick Reference

| What | Value |
|------|-------|
| React app URL | http://localhost:3131 |
| API health check | http://localhost:8765/health |
| API port | 8765 |
| Token config | Top of CronVisualizer.jsx + line 19 of cron_api.py |
| Stop the API on Linux | `pkill -f cron_api.py` |
| Check API logs | `ps aux \| grep cron_api` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Cannot reach server — Failed to fetch" | SSH tunnel not running — run Step 1 |
| Browser shows nothing at localhost:3131 | npm run dev not running — run Step 2 |
| Tunnel connects but /health times out | cron_api.py not running on Linux — run Step 5 |
| "Connection refused" on /health | cron_api.py stopped — run `nohup python ~/cron_api.py > /dev/null 2>&1 &` |
| Wrong token error (401) | TOKEN in cron_api.py doesn't match API_TOKEN in CronVisualizer.jsx |

---

*DEPLOYMENT_v2.md · Sprint 5 · 2026-04-23*
