#!/usr/bin/env bash
# BJKIT2026: install or update the camp site on an Ubuntu VPS (e.g. Hostinger KVM).
#
#   First install:  sudo bash deploy/setup.sh camp.yourdomain.com you@example.com
#   Update code:    sudo bash deploy/setup.sh camp.yourdomain.com
#   No domain yet:  sudo bash deploy/setup.sh          (site on http://<server-ip>/)
#
# Run it from the unpacked upload folder (NOT from /opt/bjkit).
# Updates keep the server's data/ (scores, sessions, timer). To overwrite it with the
# data/ from the upload instead:  sudo REPLACE_DATA=1 bash deploy/setup.sh ...
# The server's data/ is always backed up to /opt/bjkit-backups first.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/bjkit
BACKUPS=/opt/bjkit-backups

[ "$(id -u)" = 0 ] || { echo "Run as root:  sudo bash $0 $*"; exit 1; }
[ -f "$SRC/server.js" ] || { echo "server.js not found in $SRC"; exit 1; }
[ "$SRC" != "$APP" ] || { echo "Run this from the upload folder, not from $APP"; exit 1; }

echo "== 1/6 packages (gcc, nginx, node)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q build-essential nginx curl ufw
NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
gcc --version | head -1
node --version

echo "== 2/6 user + backup of current data"
id camp >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin camp
mkdir -p "$APP" "$BACKUPS"
FIRST=1
if [ -d "$APP/data" ]; then
  FIRST=0
  B="$BACKUPS/data_before-update_$(date +%F_%H%M%S).tar.gz"
  tar -czf "$B" -C "$APP" data
  echo "backed up server data -> $B"
fi

echo "== 3/6 copy files to $APP"
systemctl stop bjkit 2>/dev/null || true
cp -f "$SRC/server.js" "$SRC/clans.js" "$SRC/students.js" "$APP/"
rm -rf "$APP/public" "$APP/deploy"
cp -r "$SRC/public" "$APP/public"
cp -r "$SRC/deploy" "$APP/deploy"
if [ "$FIRST" = 1 ] || [ "${REPLACE_DATA:-0}" = 1 ]; then
  rm -rf "$APP/data"
  cp -r "$SRC/data" "$APP/data"
  echo "data/ copied from the upload"
else
  echo "data/ kept (server copy)"
fi
sed -i 's/\r$//' "$APP"/deploy/*.sh "$APP"/deploy/*.service "$APP"/deploy/*.conf
chmod +x "$APP"/deploy/*.sh
chown -R root:root "$APP"
chown -R camp:camp "$APP/data"     # the site may only write to data/

echo "== 4/6 service"
cp "$APP/deploy/bjkit.service" /etc/systemd/system/bjkit.service
systemctl daemon-reload
systemctl enable --now bjkit
sleep 2
systemctl is-active --quiet bjkit || { journalctl -u bjkit -n 40 --no-pager; echo "bjkit failed to start"; exit 1; }
curl -fsS -o /dev/null http://127.0.0.1:3000/ && echo "site answers on 127.0.0.1:3000"

echo "== 5/6 nginx + firewall"
NAME="${DOMAIN:-_}"
sed "s/__DOMAIN__/$NAME/" "$APP/deploy/nginx-bjkit.conf" > /etc/nginx/sites-available/bjkit
ln -sf /etc/nginx/sites-available/bjkit /etc/nginx/sites-enabled/bjkit
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

if [ -n "$DOMAIN" ]; then
  apt-get install -y -q certbot python3-certbot-nginx
  if [ -n "$EMAIL" ]; then MAIL=(-m "$EMAIL"); else MAIL=(--register-unsafely-without-email); fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${MAIL[@]}" \
    || echo "!! HTTPS not set up yet (is the domain's A record pointing here?). Re-run this script later."
fi

echo "== 6/6 hourly backups"
cat > /etc/cron.d/bjkit-backup <<'EOF'
# BJKIT2026: back up scores/sessions/timer every hour (keeps 7 days)
15 * * * * root /opt/bjkit/deploy/backup.sh >/dev/null 2>&1
EOF
"$APP/deploy/backup.sh"

echo
echo "Done."
if [ -n "$DOMAIN" ]; then echo "Site:  https://$DOMAIN/"; else echo "Site:  http://$(hostname -I | awk '{print $1}')/"; fi
echo "Admin password: $(cat "$APP/data/admin-password.txt")"
echo "Log:   journalctl -u bjkit -f      Restart: systemctl restart bjkit"
echo "Backups in $BACKUPS"
