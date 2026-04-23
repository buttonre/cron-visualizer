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
# The job ID is derived from the full command string (md5 hash).
# This must match the job_id() function in cron_api.py.

STATUS_DIR="$HOME/.cron_status"
mkdir -p "$STATUS_DIR"

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

# Pass through the original exit code so cron sees failures
exit $EXIT_CODE
