#!/usr/bin/env bash
# Back up the camp's live data (scores, students, sessions, timer, problems, tests, uploads).
# The loading GIFs (data/gif, ~90 MB) are skipped: they don't change and are on the PC.
# Runs hourly from /etc/cron.d/bjkit-backup; keeps 7 days. Run by hand any time:
#   sudo /opt/bjkit/deploy/backup.sh
# Restore one:  sudo systemctl stop bjkit
#               sudo tar -xzf /opt/bjkit-backups/<file>.tar.gz -C /opt/bjkit
#               sudo chown -R camp:camp /opt/bjkit/data && sudo systemctl start bjkit
set -euo pipefail
BACKUPS=/opt/bjkit-backups
mkdir -p "$BACKUPS"
OUT="$BACKUPS/data_$(date +%F_%H%M).tar.gz"
tar -czf "$OUT" -C /opt/bjkit --exclude=data/gif data
find "$BACKUPS" -name 'data_2*.tar.gz' -mtime +7 -delete
echo "$OUT"
