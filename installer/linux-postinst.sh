#!/usr/bin/env bash
# installer/linux-postinst.sh
# Installs a systemd service so print-agent starts on boot and runs as its own user.
set -e

if ! command -v systemctl >/dev/null; then
  echo "systemd not found — skipping service install"
  exit 0
fi

# Create a dedicated service user (idempotent)
id -u printagent >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin printagent

# Allow the service user to print via CUPS
if command -v usermod >/dev/null; then
  usermod -aG lp printagent 2>/dev/null || true
  usermod -aG lpadmin printagent 2>/dev/null || true
fi

cat > /etc/systemd/system/print-agent.service <<'EOF'
[Unit]
Description=Silent Print & Display Agent
After=network-online.target cups.service
Wants=network-online.target

[Service]
Type=simple
User=printagent
Group=printagent
ExecStart=/usr/local/bin/print-agent
Restart=on-failure
RestartSec=3
Environment=PORT=4444

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/tmp /var/spool/cups

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable print-agent.service
systemctl restart print-agent.service || true