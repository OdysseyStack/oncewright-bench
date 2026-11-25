#!/bin/bash
# The export import check: runs the example orders through ledger-check, the bookkeeper's import
# checker, which rejects an export its import would reject. Part of `npm run check`.
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v ledger-check > /dev/null 2>&1; then
  echo "check-export: warning: ledger-check is not installed, so the export import check did not run"
  exit 0
fi
node bin/export-orders.js examples/orders | ledger-check --format harbor-csv -
echo "check-export: the export passes the import check"
