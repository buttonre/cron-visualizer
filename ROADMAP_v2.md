# Cron Visualizer — Brain Trust Review & Roadmap v2

**Date:** 2026-04-22
**Reviewers:** Tony (Systems & Tech Lead) · Lisa (Full-Stack Architect) · Laura (10x Growth)
**Context:** Goal has shifted from visualizing Cowork's internal scheduled-tasks MCP to remotely viewing and managing real Linux cron jobs on a Red Hat server from a Windows 11 notebook on the same LAN.

---

## The Core Question

> "Can I view and manage cron jobs on a remote Red Hat Linux server from a React UI on my Windows 11 laptop?"

**Answer: Yes. Decided architecture below.**

---

## Tony's Review — Architecture Blueprint

### What's Changing

The original TRD assumed the data source was Cowork's `scheduled-tasks` MCP. That was the wrong target. We're now talking about **real Linux cron jobs** (`crontab -l`, `/etc/cron.d/`, `/var/spool/cron/`) on a Red Hat box. The frontend prototype (CronVisualizer.jsx) is solid — the data layer is what needs to change completely.

### Decision: Python Mini-API on Linux + React on Windows

**Architecture (decided — no options needed):**

```
Windows 11 Laptop
┌──────────────────────────────┐
│  Browser → React SPA         │
│  (Vite dev server, port 3131)│
│  fetch() → http://LINUX_IP:8765 │
└──────────────────────────────┘
        ↕  LAN (same network)
Red Hat Linux Server
┌──────────────────────────────┐
│  cron_api.py                 │
│  (Python HTTP server, :8765) │
│  Wraps: crontab -l / -e      │
│  Auth: shared secret token   │
└──────────────────────────────┘
```

**Why this architecture:**
- No SSH tunnel needed at runtime — same LAN, direct HTTP
- Python is already on the box (no installs required)
- Zero new dependencies on either side
- Works on Python 2.6, 2.7, 3.x — we write compatible code once we know the version
- The React app already exists and just needs its data source swapped
- SSH is needed only once: to copy the API script onto the server and start it

### SSH — What's Needed

SSH is required for **setup only**, not runtime.

| Task | SSH Required? |
|------|--------------|
| Copy `cron_api.py` to the server | Yes (one time, via `scp`) |
| Start the API server | Yes (one time, via `ssh user@host`) |
| React app reading/writing cron | No — direct HTTP over LAN |
| Restart API after reboot | Yes (or set up a cron entry to auto-start it) |

**Windows SSH tools (all free):**
| Tool | Use | Recommendation |
|------|-----|---------------|
| Windows OpenSSH (built-in) | SSH + SCP from PowerShell/CMD | **Use this first** — already on Win 11 |
| PuTTY | SSH client GUI | Backup if OpenSSH gives you trouble |
| WinSCP | GUI file transfer (SCP/SFTP) | Best option for copying files visually |

**Check if you have it:** Open PowerShell → `ssh -V`. If it prints a version, you're done. No installs needed.

### Python Version Strategy

We write `cron_api.py` to be **Python 2.6+ and 3.x compatible** using a try/except import:

```python
try:
    from http.server import HTTPServer, BaseHTTPRequestHandler  # Python 3
except ImportError:
    from BaseHTTPServer import HTTPServer, BaseHTTPRequestHandler  # Python 2
```

This means we don't need to know the exact Python version to ship. Get the version tomorrow (`python --version` or `python3 --version`) so we can test locally, but the script will run either way.

### What the API Does (Minimum)

| Endpoint | Method | Action |
|----------|--------|--------|
| `/crons` | GET | Returns JSON list of all cron entries for the current user |
| `/crons` | POST | Adds a new cron entry |
| `/crons/delete` | POST | Removes a cron entry by index |
| `/crons/toggle` | POST | Comments/uncomments an entry (enable/disable) |
| `/health` | GET | Returns `{"status":"ok"}` — connection test |

**Auth:** All requests require header `X-Token: <shared_secret>`. The secret is set in the script. Simple, zero-dependency, good enough for LAN use.

### Firewall Note

The Linux server needs port 8765 open to LAN traffic. On older Red Hat this is `iptables`:

```bash
iptables -I INPUT -p tcp --dport 8765 -j ACCEPT
```

If you don't have sudo/root access to the server, we use an SSH tunnel instead (one PuTTY tunnel, always running in the background on Windows). That's the fallback. Prefer the direct HTTP path first.

### Tony's Blueprint — File Deliverables

```
cron-visualizer/
├── CronVisualizer.jsx         ← Modified: swap SEED_DATA for fetch() calls
├── server/
│   └── cron_api.py            ← NEW: Python API server for Linux
├── DEPLOYMENT_v2.md           ← NEW: Step-by-step setup guide
└── ROADMAP_v2.md              ← This file
```

---

## Lisa's Review — Build Scope & Execution Plan

### What the Prototype UI Already Has (Keep All Of It)

- Visual schedule picker (no cron syntax required) ✅
- Inline description editing ✅
- Enable/disable toggle ✅
- RUN NOW button ✅
- Next run / last run relative timestamps ✅
- Dark terminal aesthetic ✅

**None of this changes.** The only thing that changes is where the data comes from.

### What Changes in CronVisualizer.jsx

1. Remove `SEED_TASKS` constant
2. Add `API_URL` config constant at the top (points to Linux IP:port)
3. Add `API_TOKEN` config constant
4. Replace `useState(SEED_TASKS)` with `useState([])`
5. Add `useEffect` fetch on mount that calls `GET /crons` and populates state
6. Wire `handleToggle` → `POST /crons/toggle`
7. Wire `handleEdit` (schedule changes) → `POST /crons` + `DELETE`
8. Wire `handleRun` → for now, log to console (cron doesn't have a manual trigger — this becomes a "run script now" feature in v2)
9. Add loading state and connection error state

**Scope of change: ~50 lines added, ~10 lines removed.** The visual components stay 100% intact.

### Lisa's Execution Phases

#### Phase 1 — Prove the Connection (1–2 hours once Python version is known)
- Write `cron_api.py` (Python 2/3 compatible, read-only first)
- Copy to Linux via SCP, start it
- Hit `/health` from Windows browser — confirm you see `{"status":"ok"}`
- That's the proof of concept

#### Phase 2 — Read-Only UI (2–3 hours)
- Update `CronVisualizer.jsx` to fetch from the real API
- Display real cron entries from the server
- No writes yet — just prove you can read them in the UI
- **This is the demo moment.** If you can see your real cron jobs in the React UI, the concept is proven.

#### Phase 3 — Write Operations (3–4 hours)
- Wire toggle (enable/disable via comment/uncomment)
- Wire schedule editor (edit cron expression in UI → saves to crontab)
- Add delete button
- Test end-to-end

#### Phase 4 — Hardening (optional, before showing anyone)
- Auto-restart `cron_api.py` on server reboot (cron entry or systemd service)
- Better error messages in UI when server is unreachable
- CORS config locked down to Windows laptop IP only

**Total time to working prototype: ~1 day, gated on getting Python version.**

### Linux Fallback (if LAN HTTP is blocked and SSH tunnel also fails)

If nothing works remotely, the fallback is a **self-contained HTML file served by Python on the Linux box itself**, accessed via browser on Windows at `http://LINUX_IP:8765`. Same React app, same Python server, but you're hitting the Linux box's IP in your browser instead of localhost. This is functionally identical — the React code runs in your browser, the Python API is on Linux. The only difference is where the Vite dev server runs (it would move to Linux, or you build a static bundle). This is almost certainly not necessary — same-LAN HTTP should work.

---

## Laura's Review — Strategic Framing

### What This Actually Is

You said "I have plans for this." I hear you. Let me name what you're building:

> **A no-code cron management layer** — a UI that lets anyone on your team read and manage scheduled Linux jobs without knowing cron syntax.

That's the product. Right now you're proving the technical core: *Can a browser-based UI read and write real cron jobs on a remote Linux server?* If yes, this becomes a tool you can hand to teammates, clients, or eventually package.

### Why the Architecture Decision Is Right

The Python mini-API approach is not just the fastest path — it's the right foundation:
- The API is language-agnostic. The React frontend could be replaced with anything.
- The shared-secret token is a stub for real auth (OAuth, API keys) later.
- Serving over HTTP instead of SSH means it can eventually move behind a reverse proxy (nginx), get a domain, and serve multiple users.

### Laura's 10x Vision (Gated — don't build this now)

Once the LAN prototype works:
- **VPN access** → same tool, now accessible from anywhere
- **Multi-user** → each user manages their own crontab, or admin manages all
- **Multi-server** → one UI, multiple Linux hosts registered
- **Audit log** → who changed what cron job and when
- **Templates** → "add a daily backup job" wizard

None of this needs to be built now. The seed is in the architecture.

### Laura's Flag

The "not to monetize yet" framing is fine. But **build the API with auth from day one**. A cron management API with no auth on a LAN is fine now. It becomes a liability the moment you show it to anyone else or put it behind a VPN. The token auth Tony designed is one line of code — don't skip it.

---

## Roadmap Summary

| Phase | What | Gating Condition | Effort |
|-------|------|-----------------|--------|
| **0 — Recon** | Get Python version from Red Hat box | You do this manually | 5 min |
| **1 — Prove Connection** | Write + deploy `cron_api.py`, hit `/health` from Windows | Python version known | 1–2 hrs |
| **2 — Read-Only UI** | Update React to fetch real cron data from API | Phase 1 done | 2–3 hrs |
| **3 — Write Operations** | Toggle, edit schedule, delete from UI | Phase 2 working | 3–4 hrs |
| **4 — Hardening** | Auto-restart, CORS lockdown, error states | Phase 3 working | 2 hrs |

**Total: ~1 day of build time. One blocker: Python version on the Red Hat box.**

---

## Open Questions (for Rich to answer)

| Question | Why It Matters |
|----------|---------------|
| What Python version is on the Red Hat box? | Determines exact import syntax and available stdlib modules |
| Do you have SSH access to the Red Hat box? | Required to copy the API script and start it |
| Do you have sudo/root on that box? | Needed if iptables rules need updating; not needed if port is already open |
| Which user's crontab do you want to manage? | The API runs as that user — determines which `crontab -l` it sees |
| Is the Red Hat box IP static on your LAN? | Affects how we configure the `API_URL` in the React app |

---

## Next Action (waiting on Rich)

> **"python --version && python3 --version"** — run this on the Red Hat box tomorrow and paste the output. That's the one gate before we write a single line of code for Phase 1.

---

*Review by Tony · Lisa · Laura — 2026-04-22*
*Sprint Log: Update to Sprint 4 when Phase 1 begins*
