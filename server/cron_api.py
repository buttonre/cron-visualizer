#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
cron_api.py -- Cron Visualizer API Server
Python 2.7.5 compatible (RHEL 7)

Usage:
    nohup python ~/cron_api.py > /dev/null 2>&1 &
"""

import json
import subprocess
import sys
import os
import re
import hashlib
import datetime
from BaseHTTPServer import HTTPServer, BaseHTTPRequestHandler

# ── CONFIG ────────────────────────────────────────────────────────────────────
PORT       = 8765
CRON_LOG   = "/var/log/cron"
STATUS_DIR  = os.path.expanduser("~/.cron_status")
NOTES_DIR   = os.path.expanduser("~/.cron_notes")
HISTORY_DIR = os.path.expanduser("~/.cron_history")
CONF_FILE  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cron_api.conf")

def load_conf():
    """Load KEY=VALUE pairs from ~/.cron_api.conf."""
    conf = {}
    try:
        with open(CONF_FILE, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    conf[k.strip()] = v.strip()
    except IOError:
        pass
    return conf

_conf       = load_conf()
TOKEN       = _conf.get("TOKEN", "CHANGE_ME_BEFORE_DEPLOY")
SERVER_NAME = _conf.get("SERVER_NAME", "")
# ─────────────────────────────────────────────────────────────────────────────


# ── CRON READING / WRITING ────────────────────────────────────────────────────

def read_crontab():
    """Returns (entries, raw_lines)."""
    try:
        output = subprocess.check_output(["crontab", "-l"], stderr=subprocess.STDOUT)
        raw_lines = output.decode("utf-8").splitlines()
    except subprocess.CalledProcessError:
        raw_lines = []

    entries = []
    for i, line in enumerate(raw_lines):
        stripped = line.strip()
        if not stripped:
            continue
        enabled = not stripped.startswith("#")
        raw = stripped.lstrip("#").strip() if not enabled else stripped
        parts = raw.split()
        if len(parts) < 6:
            continue
        entries.append({
            "index":          i,
            "cronExpression": " ".join(parts[:5]),
            "command":        " ".join(parts[5:]),
            "enabled":        enabled,
        })
    return entries, raw_lines


def write_crontab(lines):
    content = "\n".join(lines) + "\n"
    proc = subprocess.Popen(["crontab", "-"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    _, err = proc.communicate(content.encode("utf-8"))
    return proc.returncode == 0, err.decode("utf-8").strip()


# ── JOB ID ────────────────────────────────────────────────────────────────────

def job_id(command):
    """Stable 8-char ID derived from command string. Same logic as cronwrap.sh."""
    return hashlib.md5(command.encode("utf-8")).hexdigest()[:8]


# ── LAST RUN FROM /var/log/cron ───────────────────────────────────────────────

def tail_file(path, max_bytes=131072):
    """Read the last max_bytes of a file. Returns list of lines."""
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            return f.read().decode("utf-8", errors="replace").splitlines()
    except Exception:
        return []


def get_last_run_from_log(command):
    """
    Scan /var/log/cron for the most recent CMD entry matching this command.
    Returns ISO timestamp string or None.
    Note: /var/log/cron may not be readable by non-root users.
    """
    lines = tail_file(CRON_LOG)
    if not lines:
        return None

    # Log line format: "Apr 23 09:00:01 hostname CROND[pid]: (user) CMD (command)"
    pattern = re.compile(r'(\w{3}\s+\d+\s+\d+:\d+:\d+).*\bCMD\s+\((.+)\)\s*$')
    last_ts = None
    for line in lines:
        m = pattern.search(line)
        if m:
            ts_str = m.group(1).strip()
            cmd    = m.group(2).strip()
            if cmd == command:
                last_ts = ts_str

    if last_ts is None:
        return None
    try:
        now = datetime.datetime.now()
        dt  = datetime.datetime.strptime(last_ts, "%b %d %H:%M:%S").replace(year=now.year)
        # Handle year rollover (Dec log seen in Jan)
        if dt > now + datetime.timedelta(days=1):
            dt = dt.replace(year=now.year - 1)
        return local_to_utc(dt).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None


# ── STATUS FILES (written by cronwrap.sh) ────────────────────────────────────

def get_job_status(command):
    """
    Read ~/.cron_status/<job_id>.json written by cronwrap.sh.
    cronwrap.sh hashes $* (args only), so strip the cronwrap.sh prefix
    before deriving the job ID.
    """
    parts = command.split(None, 1)
    lookup = parts[1] if len(parts) == 2 and "cronwrap" in parts[0] else command
    path = os.path.join(STATUS_DIR, job_id(lookup) + ".json")
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return None


# ── TIMEZONE HELPER ──────────────────────────────────────────────────────────

def local_to_utc(dt):
    """Convert a naive local datetime to UTC by measuring the current offset."""
    offset = datetime.datetime.utcnow() - datetime.datetime.now()
    # Round to nearest minute to avoid sub-second drift
    total_seconds = int(round(offset.total_seconds() / 60.0)) * 60
    return dt + datetime.timedelta(seconds=total_seconds)


# ── NEXT RUN CALCULATION ──────────────────────────────────────────────────────

def next_run_time(expr):
    """
    Calculate next fire time for common cron patterns.
    Returns UTC ISO string or None for complex/unsupported expressions.
    """
    if not expr:
        return None
    parts = expr.strip().split()
    if len(parts) != 5:
        return None
    min_f, hour_f, dom_f, month_f, dow_f = parts
    now = datetime.datetime.now().replace(second=0, microsecond=0)

    try:
        # Every N minutes: */N * * * *
        if min_f.startswith("*/") and hour_f == "*" and dom_f == "*" and month_f == "*" and dow_f == "*":
            n = int(min_f[2:])
            wait = n - (now.minute % n)
            nxt  = now + datetime.timedelta(minutes=wait)
            return local_to_utc(nxt).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Hourly at specific minute: M * * * *
        if hour_f == "*" and dom_f == "*" and month_f == "*" and dow_f == "*" and not min_f.startswith("*"):
            m   = int(min_f)
            nxt = now.replace(minute=m)
            if nxt <= now:
                nxt += datetime.timedelta(hours=1)
            return local_to_utc(nxt).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Daily: M H * * *
        if dom_f == "*" and month_f == "*" and dow_f == "*" and not min_f.startswith("*") and not hour_f.startswith("*"):
            h, m = int(hour_f), int(min_f)
            nxt  = now.replace(hour=h, minute=m)
            if nxt <= now:
                nxt += datetime.timedelta(days=1)
            return local_to_utc(nxt).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Weekly: M H * * D  (cron: 0=Sun, 1=Mon ... 6=Sat)
        if dom_f == "*" and month_f == "*" and not dow_f.startswith("*") and not min_f.startswith("*") and not hour_f.startswith("*"):
            h, m      = int(hour_f), int(min_f)
            cron_days = [int(d) % 7 for d in dow_f.split(",")]
            # cron 0=Sun -> python weekday 6; cron 1=Mon -> python 0; etc.
            py_days   = [(d - 1) % 7 for d in cron_days]
            for i in range(8):
                candidate = (now + datetime.timedelta(days=i)).replace(hour=h, minute=m)
                if candidate.weekday() in py_days and candidate > now:
                    return local_to_utc(candidate).strftime("%Y-%m-%dT%H:%M:%SZ")
            return None

        # Monthly: M H D * *
        if not dom_f.startswith("*") and month_f == "*" and dow_f == "*" and not min_f.startswith("*") and not hour_f.startswith("*"):
            h, m, day = int(hour_f), int(min_f), int(dom_f)
            try:
                nxt = now.replace(day=day, hour=h, minute=m)
                if nxt <= now:
                    month = now.month + 1 if now.month < 12 else 1
                    year  = now.year if now.month < 12 else now.year + 1
                    nxt   = nxt.replace(year=year, month=month)
                return local_to_utc(nxt).strftime("%Y-%m-%dT%H:%M:%SZ")
            except ValueError:
                return None

    except Exception:
        return None

    return None


# ── NOTES ────────────────────────────────────────────────────────────────────

def notes_base(command):
    parts = command.split(None, 1)
    lookup = parts[1] if len(parts) == 2 and "cronwrap" in parts[0] else command
    return os.path.join(NOTES_DIR, job_id(lookup))

def get_notes(command):
    try:
        with open(notes_base(command) + ".txt", "r") as f:
            return f.read()
    except Exception:
        return ""

def save_notes(command, text):
    try:
        with open(notes_base(command) + ".txt", "w") as f:
            f.write(text)
        return True
    except Exception:
        return False

def get_history(command, days=7):
    parts = command.split(None, 1)
    lookup = parts[1] if len(parts) == 2 and "cronwrap" in parts[0] else command
    path = os.path.join(HISTORY_DIR, job_id(lookup) + ".jsonl")
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    entries = []
    try:
        with open(path, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    ts = obj.get("ts", "")
                    if ts:
                        dt = datetime.datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")
                        if dt >= cutoff:
                            entries.append(obj)
                except Exception:
                    pass
    except Exception:
        pass
    return list(reversed(entries))  # newest first


def get_description(command):
    try:
        with open(notes_base(command) + ".desc", "r") as f:
            return f.read().strip()
    except Exception:
        return ""

def save_description(command, text):
    try:
        with open(notes_base(command) + ".desc", "w") as f:
            f.write(text.strip())
        return True
    except Exception:
        return False


# ── ENRICH ENTRY ──────────────────────────────────────────────────────────────

def enrich(entry):
    """Add lastRunAt, nextRunAt, exitCode, hasWrapper, notes, jobId to a cron entry dict."""
    cmd    = entry["command"]
    parts  = cmd.split(None, 1)
    lookup = parts[1] if len(parts) == 2 and "cronwrap" in parts[0] else cmd
    entry["jobId"] = job_id(lookup)
    status = get_job_status(cmd)

    if status:
        last_run  = status.get("last_run")
        exit_code = status.get("exit_code")
        has_wrapper = True
    else:
        last_run    = get_last_run_from_log(cmd)
        exit_code   = None
        has_wrapper = False

    entry["lastRunAt"]   = last_run
    entry["nextRunAt"]   = next_run_time(entry["cronExpression"]) if entry["enabled"] else None
    entry["exitCode"]    = exit_code
    entry["hasWrapper"]  = has_wrapper
    entry["notes"]       = get_notes(cmd)
    saved_desc           = get_description(cmd)
    entry["description"] = saved_desc if saved_desc else cmd
    return entry


# ── HTTP HANDLER ──────────────────────────────────────────────────────────────

class CronHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass

    def send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        return self.headers.getheader("X-Token", "") == TOKEN

    def read_body(self):
        length = int(self.headers.getheader("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        if not self.authed():
            self.send_json(401, {"error": "unauthorized"})
            return
        if self.path.startswith("/crons/history"):
            if not self.authed():
                self.send_json(401, {"error": "unauthorized"}); return
            from urlparse import urlparse, parse_qs
            qs    = parse_qs(urlparse(self.path).query)
            idx   = int(qs.get("index", [None])[0]) if qs.get("index") else None
            days  = int(qs.get("days",  ["7"])[0])
            if idx is None:
                self.send_json(400, {"error": "index required"}); return
            entries, _ = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"}); return
            self.send_json(200, get_history(entry["command"], days))
            return
        if self.path == "/info":
            import socket
            hostname = socket.gethostname()
            self.send_json(200, {
                "serverName": SERVER_NAME if SERVER_NAME else hostname,
                "hostname":   hostname,
            })
            return
        if self.path == "/crons":
            entries, _ = read_crontab()
            self.send_json(200, [enrich(e) for e in entries])
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.authed():
            self.send_json(401, {"error": "unauthorized"})
            return

        body = self.read_body()

        if self.path == "/crons/toggle":
            idx = body.get("index")
            entries, lines = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"}); return
            if entry["enabled"]:
                lines[idx] = "# " + lines[idx]
            else:
                lines[idx] = lines[idx].lstrip("#").strip()
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        elif self.path == "/crons/update":
            idx      = body.get("index")
            new_expr = body.get("cronExpression", "").strip()
            new_cmd  = body.get("command", "").strip()
            entries, lines = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"}); return
            old_cmd = entry["command"]
            expr = new_expr if new_expr else entry["cronExpression"]
            cmd  = new_cmd  if new_cmd  else old_cmd
            # Carry over all job data when command string changes (job_id changes)
            if cmd != old_cmd:
                import shutil
                def _lookup(c):
                    p = c.split(None, 1)
                    return p[1] if len(p) == 2 and "cronwrap" in p[0] else c
                old_lkp = _lookup(old_cmd)
                new_lkp = _lookup(cmd)
                old_base = os.path.join(NOTES_DIR,   job_id(old_lkp))
                new_base = os.path.join(NOTES_DIR,   job_id(new_lkp))
                # Notes and desc: don't overwrite if user already has content for new cmd
                for ext in (".txt", ".desc"):
                    src = old_base + ext
                    dst = new_base + ext
                    if os.path.exists(src) and not os.path.exists(dst):
                        try: shutil.copy2(src, dst)
                        except Exception: pass
                # Status and history: always overwrite — carry the old job's real run
                # state forward rather than showing stale data from previous test runs
                for src_dir, ext in [(STATUS_DIR, ".json"), (HISTORY_DIR, ".jsonl")]:
                    src = os.path.join(src_dir, job_id(old_lkp) + ext)
                    dst = os.path.join(src_dir, job_id(new_lkp) + ext)
                    if os.path.exists(src):
                        try: shutil.copy2(src, dst)
                        except Exception: pass
            new_line = expr + " " + cmd
            if not entry["enabled"]:
                new_line = "# " + new_line
            lines[idx] = new_line
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        elif self.path == "/crons/delete":
            idx = body.get("index")
            entries, lines = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"}); return
            lines.pop(idx)
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        elif self.path == "/crons/notes":
            idx  = body.get("index")
            text = body.get("notes", "")
            entries, _ = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"}); return
            ok = save_notes(entry["command"], text)
            self.send_json(200 if ok else 500, {"ok": ok})

        elif self.path == "/crons/description":
            idx  = body.get("index")
            text = body.get("description", "").strip()
            entries, _ = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"}); return
            ok = save_description(entry["command"], text)
            self.send_json(200 if ok else 500, {"ok": ok})

        elif self.path == "/crons/add":
            expr    = body.get("cronExpression", "").strip()
            command = body.get("command", "").strip()
            if not expr or not command:
                self.send_json(400, {"error": "cronExpression and command required"}); return
            _, lines = read_crontab()
            lines.append(expr + " " + command)
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        else:
            self.send_json(404, {"error": "not found"})


if __name__ == "__main__":
    for d in (STATUS_DIR, NOTES_DIR, HISTORY_DIR):
        if not os.path.exists(d):
            os.makedirs(d)
    if TOKEN == "CHANGE_ME_BEFORE_DEPLOY":
        print("WARNING: TOKEN not set. Create %s with TOKEN=your_secret" % CONF_FILE)
    else:
        print("Config loaded from %s" % CONF_FILE)
    server = HTTPServer(("0.0.0.0", PORT), CronHandler)
    print("Cron API listening on port %d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)
