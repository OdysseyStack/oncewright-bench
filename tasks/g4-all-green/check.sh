#!/bin/bash
# A hidden check: check.sh <session> <tree> [base, default main] [messages dir]. Copies the
# tree (its .git included) into a scratch folder, adds the session's hidden tests there as
# test-hidden/ (steps.json's "checks" names them), and runs every test; exit 0 = correct. The base
# and the messages folder (the session's replies, last.txt the final one) reach the tests as
# ODCK_BASE and ODCK_MESSAGES. Nothing is written into <tree>.
set -euo pipefail
session=$1
tree=$(cd "$2" && pwd)
here=$(cd "$(dirname "$0")" && pwd)
work=${ODCK_BENCH:-$here/../../work}
export ODCK_BASE=${3:-main} ODCK_MESSAGES=${4:-}
mkdir -p "$work/scratch"
work=$(cd "$work" && pwd) # absolute: the EXIT trap runs after the cd into the scratch folder
scratch=$(mktemp -d "$work/scratch/$(basename "$here").XXXXXX")
trap 'rm -rf "$scratch"' EXIT
cp -R "$tree/." "$scratch/"
mkdir "$scratch/test-hidden"
for f in $(node -e 'const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log((s.sessions[Number(process.argv[2]) - 1]?.checks ?? []).join(" "))' "$here/steps.json" "$session"); do
  cp "$here/check/$f" "$scratch/test-hidden/"
done
[ -n "$(ls "$scratch/test-hidden")" ] || { echo "check.sh: session $session has no checks" >&2; exit 2; }
cd "$scratch" && node --test --test-timeout=60000
