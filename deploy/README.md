# Putting the camp site on a Hostinger VPS

Needs a **VPS** (KVM 1 or 2, Ubuntu 24.04). Shared web hosting can't run gcc for students' code.
No `.bat` on the server: systemd keeps `node server.js` running and restarts it on boot or crash.

## First time

1. **On this PC**, build the upload file:
   `powershell -ExecutionPolicy Bypass -File deploy\make-package.ps1`
   This creates `..\bjkit-upload.tar.gz` (about 110 MB, without Game/ and gcc/).
2. **(Optional, for HTTPS)** In hPanel → Domains → DNS, add an **A record** such as `camp` pointing to the VPS IP.
3. **Upload** the file to the VPS with WinSCP/FileZilla (SFTP, user `root`, VPS IP, root password from hPanel) into `/root/`,
   or from PowerShell: `scp ..\bjkit-upload.tar.gz root@VPS_IP:/root/`
4. **On the VPS** (hPanel → VPS → Browser terminal, or `ssh root@VPS_IP`):
   ```bash
   cd /root && tar -xzf bjkit-upload.tar.gz && cd bjkit
   bash deploy/setup.sh camp.yourdomain.com you@example.com    # or just: bash deploy/setup.sh
   ```
   It ends by printing the site address and the admin password (same as `data/admin-password.txt` on the PC).

## Updating code later
Build and upload the package again, then on the VPS:
```bash
cd /root && rm -rf bjkit && tar -xzf bjkit-upload.tar.gz && cd bjkit && bash deploy/setup.sh camp.yourdomain.com
```
The server's `data/` (live scores, logins, timer) is **kept**, and it is backed up first.
To replace the server data with the PC's copy: `REPLACE_DATA=1 bash deploy/setup.sh ...`

## Backups
- Hourly to `/opt/bjkit-backups/` (7 days kept, loading GIFs skipped). There is also one before every update.
- Download them to the PC: `scp root@VPS_IP:/opt/bjkit-backups/*.tar.gz .`
- Restore instructions are at the top of `deploy/backup.sh`.

## Everyday commands (on the VPS)
| What | Command |
|---|---|
| Live log | `journalctl -u bjkit -f` |
| Restart | `systemctl restart bjkit` |
| Backup now | `/opt/bjkit/deploy/backup.sh` |

Note: students' programs run as the locked-down `camp` user, which can only write to `/opt/bjkit/data`.
They can still *read* files in that folder, including the hidden tests. The same is true on the camp PC today.
