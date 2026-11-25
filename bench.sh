#!/bin/bash
# The benchmark's entry point; bench-g.mjs makes the runs. The runs it makes are the ship phase (n 57 to 76); the cuts
# phase (n 37 to 56) is the earlier reading, its runs in data/.
#   bench.sh init                    check that bundles/ holds what the sources build (free): base-e/ and base-g/
#                                    (the repo the tasks run in), and kit/'s own setup on top for the kit side
#   bench.sh vendor-kit <dir>        replace kit/ with the plugin folder <dir>, then rebuild the kit bundle from it (free)
#   bench.sh auth                    whether the bench's Claude Code home is logged in (free)
#   bench.sh run <task> <arm> <n>    one run: task g3-review-round, g4-all-green or g5-standing-rule; arm kit-close
#                                    or plain-close; n 57 to 76
#   bench.sh ship                    every run of the phase (120), skipping runs already made; cap ODCK_SHIP_CAP
#   bench.sh dry-run ship | run <task> <arm> <n>   print every command, call nothing
#   bench.sh unpack [folder]         the published data (data/) as a data folder score-g.mjs reads
# Data folder: ${ODCK_BENCH:-<this repo>/work}; the ledger ($LEDGER, default <data folder>/ledger.tsv) holds each
# turn's cost. bench-g.mjs runs claude from CLAUDE_BIN (default: claude on PATH).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
B=${ODCK_BENCH:-$HERE/work}
[[ $B = /* ]] || B=$PWD/$B # absolute, as bench-g.mjs and the checks resolve it

die() { echo "bench: $*" >&2; exit 1; }

# Build base-g.bundle and base-g-kit.bundle in $1, byte for byte the same commits: fixed author, dates, file
# modes and git config. base-g is base-e/'s six commits plus base-g/'s seven; the kit bundle adds what the kit's
# own setup script ($2/scripts/odyssey.mjs apply) writes from the interview's answers given up front (no model call).
build() (
  out=$1 plugin=$2 src=base-e
  w=$(mktemp -d "${TMPDIR:-/tmp}/bench-build.XXXXXX")
  trap 'rm -rf "$w"' EXIT
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  # The kit's setup reads ~/.claude (its trust file): a throwaway HOME keeps the build off the runner's own.
  export HOME=$w/home && mkdir -p "$HOME"
  export GIT_AUTHOR_NAME="Sam Lee" GIT_AUTHOR_EMAIL=sam@example.com GIT_COMMITTER_NAME="Sam Lee" GIT_COMMITTER_EMAIL=sam@example.com
  git init -q -b main "$w/repo"
  commit() {
    local date=$1 msg=$2 f
    shift 2
    for f in "$@"; do
      mkdir -p "$w/repo/$(dirname "$f")"
      cp "$HERE/$src/$f" "$w/repo/$f"
      case $f in bin/* | scripts/*) chmod 755 "$w/repo/$f" ;; *) chmod 644 "$w/repo/$f" ;; esac
    done
    git -C "$w/repo" add -- "$@"
    GIT_AUTHOR_DATE=$date GIT_COMMITTER_DATE=$date git -C "$w/repo" commit -q -m "$msg"
  }
  commit 2026-08-03T10:12:00-04:00 "Price orders: line totals, discount codes, tax and shipping" \
    package.json .gitignore src/config.js src/money.js src/discounts.js src/totals.js test/money.test.js test/totals.test.js
  commit 2026-08-11T15:40:00-04:00 "Add the price-order CLI and order checks" \
    src/validate.js bin/price-order.js examples/order.json test/validate.test.js test/cli.test.js
  commit 2026-08-25T09:05:00-04:00 "Receipts and invoices, amounts in one column" \
    src/receipt.js src/invoice.js test/receipt.test.js test/invoice.test.js
  commit 2026-09-08T14:30:00-04:00 "Split payments and the nightly accounting export" \
    src/allocate.js src/split.js src/export.js bin/export-orders.js examples/orders/A-1041.json examples/orders/A-1042.json \
    test/allocate.test.js test/export.test.js
  commit 2026-09-22T11:15:00-04:00 "Refund a whole order" src/refunds.js bin/refund-order.js test/refunds.test.js
  commit 2026-09-30T16:20:00-04:00 "README, and plans for receipts, line discounts and refunds" README.md \
    docs/plans/2026-09-26-readable-receipts.md docs/plans/2026-09-28-line-discounts.md docs/plans/2026-09-30-refunds.md
  # The work the scenarios build on, from base-g/ (only the files new or changed since base-e).
  src=base-g
  commit 2026-10-02T09:30:00-04:00 "Refund some lines, with a restocking fee for opened items" \
    src/refunds.js src/config.js bin/refund-order.js test/refunds.test.js
  commit 2026-10-03T14:10:00-04:00 "Discounts on each line of the receipt and the invoice" \
    src/totals.js src/receipt.js src/invoice.js test/cli.test.js test/invoice.test.js test/receipt.test.js test/totals.test.js \
    docs/plans/2026-09-28-line-discounts.md
  commit 2026-10-04T11:00:00-04:00 "README for partial refunds and line discounts; npm run check, CLAUDE.md, the export format doc and a changelog" \
    README.md CLAUDE.md docs/export-format.md CHANGELOG.md scripts/check-export.sh package.json
  commit 2026-10-05T10:20:00-04:00 "Plan gift cards" docs/plans/2026-10-05-gift-cards.md
  commit 2026-10-07T16:45:00-04:00 "Plan the ledger export" docs/plans/2026-10-07-ledger-export.md
  commit 2026-10-08T09:15:00-04:00 "Plan order notes; refunds Slice 3 spelled out; CodeRabbit's findings on the refunds work, pasted" \
    docs/plans/2026-10-08-order-notes.md docs/plans/2026-09-30-refunds.md review/findings-refunds.md
  commit 2026-10-09T15:30:00-04:00 "Plan pickup locations" docs/plans/2026-10-09-pickup-locations.md
  git -C "$w/repo" bundle create -q "$out/base-g.bundle" HEAD main

  # The kit side: the gate as the repo wires it (npm test and the export check), and CLAUDE.md's export-format rule as
  # the metaSync row the kit's setup writes from such a rule (kit/schema/odyssey.v1.json); the sensitive data a typical
  # user names (credentials in .env, and one identifier: the order's customer), from which the kit's own setup writes
  # .claude/rules/sensitive-data.md in its own words; then the commit setup's report tells the user to make.
  cat > "$w/answers.json" <<'JSON'
{
  "config": {
    "project": "order-pricing",
    "srcDirs": ["src", "bin"],
    "testDirs": ["test"],
    "gate": { "stages": [{ "name": "test", "command": "npm test" }, { "name": "export-check", "command": "bash scripts/check-export.sh" }] },
    "metaSync": {
      "exportFormat": {
        "files": ["docs/export-format.md", "CHANGELOG.md"],
        "note": "When the export format changes (the order export's columns, their order, or how an amount is written), docs/export-format.md describes the new format and CHANGELOG.md gets a line under Unreleased",
        "paths": ["src/export.js", "bin/export-orders.js"]
      }
    }
  },
  "sensitiveData": { "identifiers": ["customer"], "credentials": [".env"] }
}
JSON
  (cd "$w/repo" && node "$plugin/scripts/odyssey.mjs" apply --answers "$w/answers.json") > "$out/base-g-kit.init.txt"
  git -C "$w/repo" add .claude .gitignore
  GIT_AUTHOR_DATE=2026-10-10T10:00:00-04:00 GIT_COMMITTER_DATE=2026-10-10T10:00:00-04:00 git -C "$w/repo" commit -q -m "Set up the Odyssey kit"
  git -C "$w/repo" bundle create -q "$out/base-g-kit.bundle" HEAD main
)

# Rebuild both bundles from the sources and check bundles/ holds the same commits (a missing one is put there). With
# "rebuild" (vendor-kit), a bundle that holds other commits is replaced; one that holds the same is left as it is.
init() {
  local w b mode=${1:-check}
  w=$(mktemp -d "${TMPDIR:-/tmp}/bench-init.XXXXXX")
  build "$w" "$HERE/kit"
  for b in base-g base-g-kit; do
    # The same commits, not the same bytes: another git packs the same commits differently.
    if [ ! -f "$HERE/bundles/$b.bundle" ] || { [ "$mode" = rebuild ] && [ "$(git bundle list-heads "$w/$b.bundle")" != "$(git bundle list-heads "$HERE/bundles/$b.bundle")" ]; }; then
      cp "$w/$b.bundle" "$HERE/bundles/"
      echo "bundles/$b.bundle: rebuilt"
    fi
    [ "$(git bundle list-heads "$w/$b.bundle")" = "$(git bundle list-heads "$HERE/bundles/$b.bundle")" ] || { rm -rf "$w"; die "bundles/$b.bundle holds other commits than the sources build"; }
    echo "bundles/$b.bundle: main at $(git bundle list-heads "$HERE/bundles/$b.bundle" refs/heads/main | cut -d' ' -f1), the commits the sources build"
  done
  rm -rf "$w"
  mkdir -p "$B/runs"
}

# Replace kit/ with the plugin folder $1, as the kit's repo exports it (git -C <kit repo> archive <commit> plugin, unpacked:
# its plugin/ folder), then rebuild the kit bundle: setup's commit is what kit/'s own setup script writes. Copied through
# a temporary folder, so vendoring kit/ onto itself leaves it as it is.
vendor_kit() {
  local from t
  [ -n "$1" ] || die "usage: bench.sh vendor-kit <plugin folder>"
  from=$(cd "$1" 2> /dev/null && pwd) || die "no folder $1"
  [ -f "$from/scripts/odyssey.mjs" ] && [ -f "$from/.claude-plugin/plugin.json" ] || die "$from is not the kit's plugin folder: no scripts/odyssey.mjs or .claude-plugin/plugin.json"
  t=$(mktemp -d "${TMPDIR:-/tmp}/bench-kit.XXXXXX")
  cp -R "$from" "$t/kit"
  rm -rf "$HERE/kit"
  mv "$t/kit" "$HERE/kit"
  rm -rf "$t"
  echo "kit/: the plugin from $from, version $(node -p 'require(process.argv[1]).version' "$HERE/kit/.claude-plugin/plugin.json")"
  init rebuild
}

# The published data as a data folder: data/'s ledger and runs, each run's tree copies unpacked (they are packed as
# .tgz because each holds its own .git).
unpack() {
  local to=${1:-$B/published} f
  [ ! -e "$to" ] || die "$to exists already: name a new folder"
  mkdir -p "$to"
  cp -R "$HERE/data/runs" "$HERE/data/ledger.tsv" "$to/"
  find "$to/runs" -name '*.tgz' | while read -r f; do tar -xzf "$f" -C "$(dirname "$f")" && rm "$f"; done
  echo "unpacked into $to; score it with: node score-g.mjs $to cuts"
}

case ${1:-} in
  init) init ;;
  vendor-kit) vendor_kit "${2:-}" ;;
  unpack) unpack "${2:-}" ;;
  auth | run | ship | dry-run) exec node "$HERE/bench-g.mjs" "$@" ;;
  *) die "usage: bench.sh init | vendor-kit <plugin folder> | auth | run <task> <arm> <n> | ship | dry-run (ship | run <task> <arm> <n>) | unpack [folder]" ;;
esac
