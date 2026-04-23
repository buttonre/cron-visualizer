#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
cron_api.py -- Cron Visualizer API Server
Python 2.7.5 compatible (RHEL 7)

Usage:
    nohup python cron_api.py &

Runs as the user whose crontab you want to manage.
"""

import json
import subprocess
import sys
from BaseHTTPServer import HTTPServer, BaseHTTPRequestHandler

# ── CONFIG ────────────────────────────────────────────────────────────────────
PORT  = 8765
TOKEN = "CHANGE_ME_BEFORE_DEPLOY"   # set this to anything secret, match in React
# ─────────────────────────────────────────────────────────────────────────────


def read_crontab():
    """Returns (entries, raw_lines). Handles empty/missing crontab gracefully."""
    try:
        output = subprocess.check_output(
            ["crontab", "-l"], stderr=subprocess.STDOUT
        )
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
    """Writes lines list back to the current user's crontab. Returns (ok, err)."""
    content = "\n".join(lines) + "\n"
    proc = subprocess.Popen(
        ["crontab", "-"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    _, err = proc.communicate(content.encode("utf-8"))
    return proc.returncode == 0, err.decode("utf-8").strip()


class CronHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        pass  # silence default access log; errors still print

    def send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        return self.headers.getheader("X-Token", "") == TOKEN

    def read_body(self):
        length = int(self.headers.getheader("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # ── OPTIONS (CORS preflight) ──────────────────────────────────────────────

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Token, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    # ── GET ───────────────────────────────────────────────────────────────────

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
            return
        if not self.authed():
            self.send_json(401, {"error": "unauthorized"})
            return
        if self.path == "/crons":
            entries, _ = read_crontab()
            self.send_json(200, entries)
        else:
            self.send_json(404, {"error": "not found"})

    # ── POST ──────────────────────────────────────────────────────────────────

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
                self.send_json(404, {"error": "entry not found"})
                return
            if entry["enabled"]:
                lines[idx] = "# " + lines[idx]
            else:
                lines[idx] = lines[idx].lstrip("#").strip()
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        elif self.path == "/crons/update":
            idx     = body.get("index")
            new_expr = body.get("cronExpression", "").strip()
            entries, lines = read_crontab()
            entry = next((e for e in entries if e["index"] == idx), None)
            if entry is None:
                self.send_json(404, {"error": "entry not found"})
                return
            new_line = new_expr + " " + entry["command"]
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
                self.send_json(404, {"error": "entry not found"})
                return
            lines.pop(idx)
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        elif self.path == "/crons/add":
            expr    = body.get("cronExpression", "").strip()
            command = body.get("command", "").strip()
            if not expr or not command:
                self.send_json(400, {"error": "cronExpression and command required"})
                return
            _, lines = read_crontab()
            lines.append(expr + " " + command)
            ok, err = write_crontab(lines)
            self.send_json(200 if ok else 500, {"ok": ok, "error": err})

        else:
            self.send_json(404, {"error": "not found"})


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), CronHandler)
    print("Cron API listening on port %d  (token auth required)" % PORT)
    print("Hit Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)
