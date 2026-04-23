#!/bin/bash
# cronwrap.sh -- Cron Visualizer job wrapper
#
# Records status and run history for the Cron Visualizer UI.
#
# SETUP:
#   chmod +x ~/cronwrap.sh
#
# USAGE in crontab:
#   */5 * * * * /home/your_user/cronwrap.sh /path/to/your/script.sh
#
# Config (cron_api.conf — searched in order: same dir as script, $HOME, $HOME/.cron_api.conf):
#   ENABLE_EMAIL=true
#   EMAIL_RECIPIENT=you@example.com
#   SERVER_NAME=MyServer
#
# TIP: if cronwrap.sh is in ~ and cron_api.conf is in server/, symlink it:
#   ln -s ~/path/to/server/cron_api.conf ~/cron_api.conf

STATUS_DIR="$HOME/.cron_status"
HISTORY_DIR="$HOME/.cron_history"
mkdir -p "$STATUS_DIR" "$HISTORY_DIR"

# Load config — checks (in order): same dir as this script, $HOME, $HOME/.cron_api.conf
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_FILE=""
for _candidate in "$SCRIPT_DIR/cron_api.conf" "$HOME/cron_api.conf" "$HOME/.cron_api.conf"; do
    if [ -f "$_candidate" ]; then CONF_FILE="$_candidate"; break; fi
done
ENABLE_EMAIL="false"
EMAIL_RECIPIENT=""
SERVER_NAME=""
if [ -n "$CONF_FILE" ]; then
    ENABLE_EMAIL=$(grep -E "^ENABLE_EMAIL=" "$CONF_FILE" | cut -d= -f2 | tr -d '[:space:]')
    EMAIL_RECIPIENT=$(grep -E "^EMAIL_RECIPIENT=" "$CONF_FILE" | cut -d= -f2 | tr -d '[:space:]')
    SERVER_NAME=$(grep -E "^SERVER_NAME=" "$CONF_FILE" | cut -d= -f2 | tr -d '[:space:]')
fi

# Build command string and job ID
CMD="$*"
JOB_ID=$(echo -n "$CMD" | md5sum | cut -c1-8)
STATUS_FILE="$STATUS_DIR/$JOB_ID.json"
HISTORY_FILE="$HISTORY_DIR/$JOB_ID.jsonl"

# Record start time and epoch for duration
START_EPOCH=$(date +%s)
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Run the actual command
"$@"
EXIT_CODE=$?

# Record end time and duration
END_EPOCH=$(date +%s)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DUR=$((END_EPOCH - START_EPOCH))

# Write current status file (overwrites previous run)
printf '{"command":"%s","last_run":"%s","end_time":"%s","exit_code":%d,"duration":%d}\n' \
    "$CMD" "$START" "$END" "$EXIT_CODE" "$DUR" > "$STATUS_FILE"

# Append to history file, keep last 1000 entries (~7 days for per-minute jobs)
printf '{"ts":"%s","exit":%d,"dur":%d}\n' "$START" "$EXIT_CODE" "$DUR" >> "$HISTORY_FILE"
tail -n 1000 "$HISTORY_FILE" > "$HISTORY_FILE.tmp" && mv "$HISTORY_FILE.tmp" "$HISTORY_FILE"

# Send email alert on failure if enabled
if [ "$EXIT_CODE" -ne 0 ] && [ "$ENABLE_EMAIL" = "true" ] && [ -n "$EMAIL_RECIPIENT" ]; then
    LABEL="${SERVER_NAME:-$(hostname)}"
    echo "Job:       $CMD
Exit code: $EXIT_CODE
Duration:  ${DUR}s
Started:   $START
Finished:  $END
Server:    $LABEL" | mail -s "[CRON ALERT] Job failed on $LABEL" "$EMAIL_RECIPIENT"
fi

# Pass through exit code so cron sees failures
exit $EXIT_CODE
