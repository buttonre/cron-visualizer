#!/bin/bash
# cronwrap.sh -- Cron Visualizer job wrapper
#
# Records start time, exit code, and duration to ~/.cron_status/<job_id>.json
# so the Cron Visualizer UI can show last run status and success/failure.
#
# SETUP:
#   chmod +x ~/cronwrap.sh
#
# USAGE in crontab -- replace your command with:
#   */5 * * * * /home/your_user/cronwrap.sh /path/to/your/script.sh
#
# Email alerting: set ENABLE_EMAIL=true and EMAIL_RECIPIENT in cron_api.conf

STATUS_DIR="$HOME/.cron_status"
mkdir -p "$STATUS_DIR"

# Load config from same directory as this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_FILE="$SCRIPT_DIR/cron_api.conf"
ENABLE_EMAIL="false"
EMAIL_RECIPIENT=""
SERVER_NAME=""
if [ -f "$CONF_FILE" ]; then
    ENABLE_EMAIL=$(grep -E "^ENABLE_EMAIL=" "$CONF_FILE" | cut -d= -f2 | tr -d '[:space:]')
    EMAIL_RECIPIENT=$(grep -E "^EMAIL_RECIPIENT=" "$CONF_FILE" | cut -d= -f2 | tr -d '[:space:]')
    SERVER_NAME=$(grep -E "^SERVER_NAME=" "$CONF_FILE" | cut -d= -f2 | tr -d '[:space:]')
fi

# Build command string from all arguments
CMD="$*"

# Generate stable 8-char job ID from command (matches cron_api.py logic)
JOB_ID=$(echo -n "$CMD" | md5sum | cut -c1-8)
STATUS_FILE="$STATUS_DIR/$JOB_ID.json"

# Record start time in UTC ISO format
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Run the actual command
"$@"
EXIT_CODE=$?

# Record end time
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Write status file (overwrites previous run)
printf '{"command":"%s","last_run":"%s","end_time":"%s","exit_code":%d}\n' \
    "$CMD" "$START" "$END" "$EXIT_CODE" > "$STATUS_FILE"

# Send email alert on failure if enabled
if [ "$EXIT_CODE" -ne 0 ] && [ "$ENABLE_EMAIL" = "true" ] && [ -n "$EMAIL_RECIPIENT" ]; then
    LABEL="${SERVER_NAME:-$(hostname)}"
    printf "Subject: [CRON ALERT] Job failed on %s\nFrom: cron@%s\n\nJob: %s\nExit code: %d\nStarted: %s\nFinished: %s\n" \
        "$LABEL" "$(hostname)" "$CMD" "$EXIT_CODE" "$START" "$END" \
        | sendmail "$EMAIL_RECIPIENT" 2>/dev/null \
        || mail -s "[CRON ALERT] Job failed on $LABEL" "$EMAIL_RECIPIENT" <<EOF 2>/dev/null
Job: $CMD
Exit code: $EXIT_CODE
Started:  $START
Finished: $END
EOF
fi

# Pass through the original exit code so cron sees failures
exit $EXIT_CODE
