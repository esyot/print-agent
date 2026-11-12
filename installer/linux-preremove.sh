#!/usr/bin/env bash
# installer/linux-preremove.sh
set -e
if command -v systemctl >/dev/null; then
  systemctl stop print-agent.service || true
  systemctl disable print-agent.service || true
  rm -f /etc/systemd/system/print-agent.service
  systemctl daemon-reload
fi