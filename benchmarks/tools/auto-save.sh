#!/bin/bash
# Hourly auto-save of benchmark scores to ~/dsh-bench/snapshots, independent of any session.
# Usage: nohup benchmarks/tools/auto-save.sh >/tmp/auto-save.log 2>&1 &
while true; do
  sleep 1800
  node "$(dirname "$0")/save-snapshot.mjs" "$HOME/dsh-bench/snapshots/$(date +%H-%M)" >/dev/null 2>&1 || true
done
