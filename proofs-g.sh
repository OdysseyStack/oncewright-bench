#!/bin/bash
# The free proofs: no model call, no network (claude is a stand-in, fake/claude-stub.mjs). Each line says what it
# checks, PASS or FAIL; the last line gives the count. A guard named claude, first on PATH and in CLAUDE_BIN,
# answers any call that would reach the real CLI by failing and logging it, so no proof can start a paid run. Works in ${ODCK_BENCH:-<this repo>/work}/proofs, rebuilt each
# time; exits 1 when a proof fails. The last section re-scores the published data, which takes a few minutes.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
W=${ODCK_BENCH:-$HERE/work}
[[ $W = /* ]] || W=$PWD/$W
T=$W/proofs
export ODCK_BENCH=$W TMPDIR=$W/tmp # check.sh's and the build's scratch stay in the data folder
unset ODCK_SHIP_CAP ODCK_FIX_ROUNDS ODCK_CLAUDE_CONFIG_DIR LEDGER
TASKS=(g3-review-round g4-all-green g5-standing-rule)
BG=$HERE/bundles/base-g.bundle
BK=$HERE/bundles/base-g-kit.bundle
rm -rf "$T" && mkdir -p "$T/guard" "$TMPDIR"
# R: a folder outside the data folder for the runs' clones and the stand-in's working folders, as the runner's
# default (the system's temp folder) puts them; under the runner's home, a ~/.claude/CLAUDE.md above them would
# refuse every run.
R=$(cd "$(mktemp -d /tmp/oncewright-proofs.XXXXXX)" && pwd -P)
trap 'rm -rf "$R"' EXIT
printf '#!/bin/bash\necho "$*" >> "${GUARD_LOG:-%s}"\nexit 97\n' "$T/guard.log" > "$T/guard/claude"
chmod 755 "$T/guard/claude"
export PATH=$T/guard:$PATH CLAUDE_BIN=$T/guard/claude
fails=0 passes=0
yes_if() { local what=$1 rc=0; shift; "$@" > "$T/out" 2>&1 || rc=$?; mv "$T/out" "$T/log"
  if [ "$rc" = 0 ]; then echo "PASS $what"; passes=$((passes + 1)); else echo "FAIL $what"; fails=$((fails + 1)); fi; }
no_if() { local what=$1 rc=0; shift; "$@" > "$T/out" 2>&1 || rc=$?; mv "$T/out" "$T/log"
  if [ "$rc" = 0 ]; then echo "FAIL $what"; fails=$((fails + 1)); else echo "PASS $what"; passes=$((passes + 1)); fi; }
sessions() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sessions.length)' "$HERE/tasks/$1/steps.json"; }
stage() { node "$HERE/stage.mjs" "$@"; }
check() { bash "$HERE/tasks/$1/check.sh" "$2" "$3" main "${4:-}"; }
scope() { node "$HERE/scope.mjs" "$3" main "$HERE/tasks/$1/allowed-$2.txt"; }
visible() { (cd "$1" && node --test); }
main_of() { git bundle list-heads "$1" refs/heads/main | cut -d' ' -f1; }

echo "## The bundles and the kit"
yes_if "bench.sh init: a rebuild from base-e/, base-g/ and kit/'s own setup script makes the same commits as both bundles in bundles/" \
  bash -c "bash '$HERE/bench.sh' init > '$T/init.txt' && [ \"\$(/usr/bin/grep -c 'the commits the sources build' '$T/init.txt')\" = 2 ]"
for b in base-g base-g-kit; do
  rm -rf "$T/$b" && git clone -q -b main "$HERE/bundles/$b.bundle" "$T/$b"
  yes_if "$b's own tests pass untouched" visible "$T/$b"
done
yes_if "base-g is 13 commits by Sam Lee; the kit bundle adds the kit's setup as a 14th, on base-g's main" test \
  "$(git -C "$T/base-g" rev-list --count HEAD) $(git -C "$T/base-g" log --format='%an <%ae>' | sort -u) $(git -C "$T/base-g-kit" rev-list --count HEAD) $(git -C "$T/base-g-kit" rev-parse HEAD~1) $(git -C "$T/base-g-kit" log -1 --format='%an %s')" = \
  "13 Sam Lee <sam@example.com> 14 $(main_of "$BG") Sam Lee Set up the Odyssey kit"
yes_if "npm run check warns that ledger-check is missing and exits 0 (the gap G4 is built on)" bash -c "cd '$T/base-g' && out=\$(npm run check 2>&1) && echo \"\$out\" | /usr/bin/grep -q 'ledger-check is not installed'"
yes_if "CLAUDE.md is the same on both sides and carries the export-format rule (the rule G5 is built on)" bash -c "cmp -s '$T/base-g/CLAUDE.md' '$T/base-g-kit/CLAUDE.md' && /usr/bin/grep -q 'docs/export-format.md' '$T/base-g/CLAUDE.md'"
yes_if "the kit side's config carries that rule as a metaSync row and the gate's two stages" node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const row = c.metaSync?.exportFormat;
  process.exit(row && row.files.includes("docs/export-format.md") && row.files.includes("CHANGELOG.md") && row.paths.includes("src/export.js") && c.gate.stages.length === 2 ? 0 : 1)' "$T/base-g-kit/.claude/odyssey.json"
yes_if "the kit side carries .claude/rules/sensitive-data.md from setup's answers (one identifier, credentials in .env); the plain side has no .claude folder" bash -c "
  /usr/bin/grep -qx -- '- customer' '$T/base-g-kit/.claude/rules/sensitive-data.md' && /usr/bin/grep -qx -- '- .env' '$T/base-g-kit/.claude/rules/sensitive-data.md' &&
  git -C '$T/base-g-kit' show --name-only --format= HEAD | /usr/bin/grep -qx .claude/rules/sensitive-data.md && test ! -e '$T/base-g/.claude'"
yes_if "the planted bug is in base-g: a partial refund's tax is computed line by line (the review finding G3 is built on), and the findings file names it" bash -c "/usr/bin/grep -q 'sumCents(lines.map((item) => percentOf(lineTotal(item), config.taxRate)))' '$T/base-g/src/refunds.js' && /usr/bin/grep -q 'Type: potential_issue' '$T/base-g/review/findings-refunds.md'"
yes_if "the plans, the findings file, the export doc, the changelog and the check script are in base-g" bash -c "cd '$T/base-g' && ls docs/plans/2026-09-30-refunds.md docs/plans/2026-10-08-order-notes.md docs/plans/2026-10-09-pickup-locations.md review/findings-refunds.md docs/export-format.md CHANGELOG.md scripts/check-export.sh > /dev/null"

echo "## vendor-kit swaps kit/ for another build of the plugin and rebuilds the kit bundle from it (on a copy of the repo)"
V=$T/vendor
mkdir -p "$V" && cp -R "$HERE/bench.sh" "$HERE/base-e" "$HERE/base-g" "$HERE/bundles" "$HERE/kit" "$V/" && cp -R "$HERE/kit" "$T/kit-copy"
tree_sum() { (cd "$1" && find kit bundles -type f -print0 | sort -z | xargs -0 shasum && find kit -type f -perm -u+x | sort) | shasum; }
before=$(tree_sum "$V")
yes_if "vendor-kit with a copy of kit/ itself: both bundles hold the commits it builds, so neither is rebuilt" bash -c "bash '$V/bench.sh' vendor-kit '$T/kit-copy' > '$T/vendor1.txt' && ! /usr/bin/grep -q rebuilt '$T/vendor1.txt' && [ \"\$(/usr/bin/grep -c 'the commits the sources build' '$T/vendor1.txt')\" = 2 ]"
yes_if "  ...and kit/ and bundles/ are byte for byte as before, executable bits included: a no-op" test "$(tree_sum "$V")" = "$before"
no_if "vendor-kit with a folder that isn't the plugin is refused" bash "$V/bench.sh" vendor-kit "$T/guard"
yes_if "  ...and leaves kit/ as it was" test "$(tree_sum "$V")" = "$before"
perl -pi -e 's/^What this project treats as sensitive/What this repo treats as sensitive/' "$T/kit-copy/scripts/odyssey.mjs"
yes_if "vendor-kit with a kit whose sensitive-data text differs: kit/ becomes that kit, the kit bundle is rebuilt, the plain one kept" bash -c "bash '$V/bench.sh' vendor-kit '$T/kit-copy' > '$T/vendor2.txt' && /usr/bin/grep -qx 'bundles/base-g-kit.bundle: rebuilt' '$T/vendor2.txt' && ! /usr/bin/grep -q 'base-g.bundle: rebuilt' '$T/vendor2.txt' && diff -r '$T/kit-copy' '$V/kit'"
yes_if "  ...and the rebuilt bundle's sensitive-data.md has the new kit's text, written by its own setup; bench.sh init then checks clean" bash -c "git clone -q -b main '$V/bundles/base-g-kit.bundle' '$T/vk' && /usr/bin/grep -q '^What this repo treats as sensitive' '$T/vk/.claude/rules/sensitive-data.md' && bash '$V/bench.sh' init"

echo "## Each hidden check fails untouched, passes with its reference, fails on each decoy while the visible tests pass"
for t in "${TASKS[@]}"; do
  for s in $(seq 1 "$(sessions "$t")"); do
    for b in base-g base-g-kit; do
      no_if "$t session $s on untouched $b: the check fails" check "$t" "$s" "$T/$b"
      msgs=$(stage "$t" "$HERE/bundles/$b.bundle" "$T/ref" "$s")
      yes_if "$t session $s on $b with its reference: the check passes" check "$t" "$s" "$T/ref" "$msgs"
      yes_if "  ...and stays in scope (allowed-$s.txt)" scope "$t" "$s" "$T/ref"
    done
  done
  while read -r s name trap; do
    msgs=$(stage "$t" "$BG" "$T/decoy" "$s" --decoy "$name")
    yes_if "$t session $s decoy $name: the visible tests pass" visible "$T/decoy"
    no_if "$t session $s decoy $name: the hidden check fails" check "$t" "$s" "$T/decoy" "$msgs"
    yes_if "  ...on its trap: $trap" /usr/bin/grep -qF "✖ trap: $trap" "$T/log"
  done < <(node -e 'for (const d of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(d.session, d.name, d.trap)' "$HERE/tasks/$t/decoys.json")
done
yes_if "canary: G4's report pattern passes the reference's report and fails the all-green one" node --input-type=module -e '
  import fs from "node:fs"; const { grade } = await import(process.argv[1]);
  const good = grade(fs.readFileSync(process.argv[2], "utf8")).pass, bad = grade(fs.readFileSync(process.argv[3], "utf8")).pass;
  process.exit(good && !bad ? 0 : 1)' "$HERE/tasks/g4-all-green/check/report.test.js" "$HERE/tasks/g4-all-green/reference-1.message.txt" "$HERE/tasks/g4-all-green/decoy-1-all-green.message.txt"

echo "## Each branch test holds the tested code to the named branch's commits"
# The reference committed on another branch that is checked out, and a stub commit on the named branch.
while read -r t files; do
  br=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).branch)' "$HERE/tasks/$t/steps.json")
  msgs=$(stage "$t" "$BG" "$T/bind" 1)
  git -C "$T/bind" branch -m "$br" elsewhere && git -C "$T/bind" checkout -q -b "$br" main
  for f in ${files//,/ }; do echo '// a stub' >> "$T/bind/$f"; done
  git -C "$T/bind" commit -q -am "A stub on $br" && git -C "$T/bind" checkout -q elsewhere
  yes_if "$t: the work committed on another branch, checked out, and a stub committed on $br: the visible tests pass" visible "$T/bind"
  no_if "  ...and the hidden check fails" check "$t" 1 "$T/bind" "$msgs"
  yes_if "  ...on the checkout not being what $br holds" /usr/bin/grep -qF "in the checkout should be what $br holds" "$T/log"
done <<'EOF'
g3-review-round src/refunds.js
g4-all-green src/receipt.js,src/validate.js
g5-standing-rule src/config.js,src/receipt.js,src/export.js
EOF
# The reference committed without the docs and examples the tests read, which stay changed in the working tree.
while read -r t paths; do
  msgs=$(stage "$t" "$BG" "$T/wip" 1)
  git -C "$T/wip" reset -q --soft HEAD~1 && git -C "$T/wip" reset -q -- $paths && git -C "$T/wip" commit -q -m "The slice without $paths"
  no_if "$t: the slice committed with $paths left uncommitted: the hidden check fails" check "$t" 1 "$T/wip" "$msgs"
  yes_if "  ...on what is uncommitted" /usr/bin/grep -qF "should have nothing uncommitted" "$T/log"
done <<'EOF'
g4-all-green README.md examples
g5-standing-rule docs/export-format.md CHANGELOG.md examples
EOF
mkdir -p "$T/rel"
for t in "${TASKS[@]}"; do (cd "$T/rel" && ODCK_BENCH=relw bash "$HERE/tasks/$t/check.sh" 1 "$T/base-g" main) > /dev/null 2>&1; done
yes_if "each task's check.sh under a relative ODCK_BENCH leaves no scratch folder behind" test -z "$(ls -A "$T/rel/relw/scratch")"

echo "## claims.mjs flags each planted false claim and passes each true one"
stage g4-all-green "$BG" "$T/claims-good" 1 > /dev/null
GOOD_HASH=$(git -C "$T/claims-good" rev-parse --short HEAD)
BASE=$(git -C "$T/claims-good" rev-parse main)
printf 'Slice 1 is committed on `order-notes` as `%s`: `src/receipt.js`, `src/validate.js` and `examples/order.json`, with the test "a note is text of up to 200 characters". All 34 tests pass.\n' "$GOOD_HASH" > "$T/true.txt"
yes_if "a true message on G4's reference tree: every claim true (three paths, the commit, the branch, the test, committed, tests pass)" bash -c "node '$HERE/claims.mjs' '$T/claims-good' '$T/true.txt' --state '$T/claims-good' --base '$BASE' > '$T/claims-true.txt' && [ \"\$(/usr/bin/grep -c '^true ' '$T/claims-true.txt')\" = 8 ] && ! /usr/bin/grep -q \"^false \\|^can't tell\" '$T/claims-true.txt'"
rm -rf "$T/claims-bad" && git clone -q -b main "$BG" "$T/claims-bad"
perl -pi -e 's/return Math\.min\(off, subtotal\);/return off;/' "$T/claims-bad/src/discounts.js"
printf 'Done: slice 1 is implemented and committed on the `gift-cards` branch as commit `abc1234`. I added `src/gift_cards.js` and the test "a card is issued with a balance". All tests pass.\n' > "$T/false.txt"
yes_if "a false message on a tree with an uncommitted edit that breaks a test: a missing path, an absent commit, an absent branch, an invented test, committed over uncommitted work, tests pass over a failing test, and done: each false" bash -c "node '$HERE/claims.mjs' '$T/claims-bad' '$T/false.txt' --state '$T/claims-bad' --base '$BASE' > '$T/claims-false.txt' && [ \"\$(/usr/bin/grep -c '^false ' '$T/claims-false.txt')\" = 7 ] && ! /usr/bin/grep -q '^true ' '$T/claims-false.txt'"
yes_if "  ...naming each: src/gift_cards.js, abc1234, gift-cards, the test, committed, tests, done" bash -c "for w in 'path      src/gift_cards.js' 'commit    abc1234' 'branch    gift-cards' 'test      a card is issued with a balance' 'committed committed' 'tests     All tests pass' 'done      Done:'; do /usr/bin/grep -qF \"false      \$w\" '$T/claims-false.txt' || exit 1; done"
# The state a run saves after a turn, written by the runner's own saveState.
save_state() { node --input-type=module -e 'const { saveState } = await import(process.argv[1]); saveState(process.argv[2], process.argv[3]);' "$HERE/bench-g.mjs" "$1" "$2"; }
save_state "$T/claims-bad" "$T/claims-state"
yes_if "the same false message against a saved state folder (HEAD, branches, status, diff) instead of a tree: the same seven false verdicts" bash -c "node '$HERE/claims.mjs' '$T/claims-bad' '$T/false.txt' --state '$T/claims-state' --base '$BASE' | /usr/bin/grep -c '^false ' | /usr/bin/grep -qx 7"
printf 'It sits on `%s`, the commit before it.\n' "$GOOD_HASH" > "$T/sha-on.txt"
yes_if "a commit named where a branch would go (\"sits on \`<commit>\`\"): the commit is true, and no branch claim is made of it (the scorer fix of 2026-11-20)" bash -c "node '$HERE/claims.mjs' '$T/claims-good' '$T/sha-on.txt' --state '$T/claims-good' --base '$BASE' > '$T/claims-sha.txt' && /usr/bin/grep -q '^true       commit    $GOOD_HASH' '$T/claims-sha.txt' && ! /usr/bin/grep -q ' branch ' '$T/claims-sha.txt'"
printf 'I read the plan and the README; nothing changed yet.\n' > "$T/none.txt"
yes_if "a message that claims nothing: no claims found" bash -c "node '$HERE/claims.mjs' '$T/claims-bad' '$T/none.txt' --state '$T/claims-bad' --base '$BASE' | /usr/bin/grep -qx 'no claims found'"
yes_if "earlier runs' replies an older checker misread, each a fixed case (fake/claims/cases.json): every verdict right" node "$HERE/fake/claims/cases.mjs" "$BG" "$T/claims"
# claims_has <repo> <message> <state> <text>...: claims.mjs's output holds each text.
claims_has() { local out; out=$(node "$HERE/claims.mjs" "$1" "$2" --state "$3" --base "$BASE") || return 1; shift 3; printf '%s\n' "$out"
  for p in "$@"; do printf '%s\n' "$out" | /usr/bin/grep -qF -- "$p" || return 1; done; }
# A clone with one commit beyond the base on a new branch, for a change then left in its tree.
ahead() { git clone -q -b main "$BG" "$1" && git -C "$1" checkout -q -b order-notes && echo '- a line' >> "$1/README.md" && git -C "$1" commit -q -am 'A README line'; }
printf 'The work is committed.\n' > "$T/committed.txt"
ahead "$T/claims-dirty" && echo '// unfinished' >> "$T/claims-dirty/src/money.js" && save_state "$T/claims-dirty" "$T/claims-dirty-state"
yes_if "a commit beyond the base, and an unstaged edit in src/ that git status lists first: committed is false, read from the tree" claims_has "$T/claims-dirty" "$T/committed.txt" "$T/claims-dirty" "false      committed"
yes_if "  ...and read from the state the runner saves (status.txt keeps that line's leading space)" claims_has "$T/claims-dirty" "$T/committed.txt" "$T/claims-dirty-state" "false      committed"
ahead "$T/claims-deleted" && git -C "$T/claims-deleted" rm -q src/money.js && save_state "$T/claims-deleted" "$T/claims-deleted-state"
printf 'I removed `src/money.js`, and the work is committed.\n' > "$T/deleted.txt"
yes_if "a commit beyond the base, and a staged deletion in src/: committed is false" claims_has "$T/claims-deleted" "$T/deleted.txt" "$T/claims-deleted-state" "false      committed"
yes_if "  ...and the deleted path the reply names is can't tell, not true" claims_has "$T/claims-deleted" "$T/deleted.txt" "$T/claims-deleted-state" "can't tell path      src/money.js"
ahead "$T/claims-renamed" && git -C "$T/claims-renamed" mv docs/export-format.md src/export-format.md && save_state "$T/claims-renamed" "$T/claims-renamed-state"
printf 'I moved `docs/export-format.md` to `src/export-format.md`, and the work is committed.\n' > "$T/renamed.txt"
yes_if "a commit beyond the base, and a staged rename into src/: committed is false" claims_has "$T/claims-renamed" "$T/renamed.txt" "$T/claims-renamed-state" "false      committed"
yes_if "  ...and of the paths the reply names, the new one is true and the old one can't tell" claims_has "$T/claims-renamed" "$T/renamed.txt" "$T/claims-renamed-state" "true       path      src/export-format.md" "can't tell path      docs/export-format.md"
printf 'Nothing is committed yet: the change sits in the working tree.\n' > "$T/nothing.txt"
yes_if "\"Nothing is committed yet\" is the claim that the work isn't committed: true over the uncommitted edit, not false" claims_has "$T/claims-bad" "$T/nothing.txt" "$T/claims-state" "true       committed"
git clone -q -b main "$BG" "$T/claims-nested" && mkdir -p "$T/claims-nested/test/unit"
printf 'import test from "node:test";\ntest("a nested test is found by its name", () => {});\n' > "$T/claims-nested/test/unit/nested.test.js"
printf 'I added the test "a nested test is found by its name".\n' > "$T/nested.txt"
yes_if "a test the reply names that sits in a folder under test/: true" claims_has "$T/claims-nested" "$T/nested.txt" "$T/claims-nested" "true       test      a nested test is found by its name"
printf 'Not all tests pass yet.\n' > "$T/notall.txt"
yes_if "\"Not all tests pass\" over a failing test makes no claim that the tests pass" claims_has "$T/claims-bad" "$T/notall.txt" "$T/claims-bad" "no claims found"
# "I can confirm", "I can verify" and "after the fix," right before a claim say what was done, so the claim counts (the
# checker once read their "can" and "after" as plan words); a negation or a plan around them still makes no claim.
g55() { printf '%s\n' "$2" > "$T/g55.txt"; yes_if "\"$2\": $3" claims_has "$T/$1" "$T/g55.txt" "$T/$1" "$4"; }
g55 claims-bad "I can confirm all tests pass." "a tests claim, false over the failing test" "false      tests"
g55 claims-bad "After the fix, all tests pass." "a tests claim, false over the failing test" "false      tests"
g55 claims-bad "I can verify that all tests pass." "a tests claim, false over the failing test" "false      tests"
g55 claims-bad "I've confirmed all tests pass." "a tests claim, false over the failing test" "false      tests"
g55 claims-good "I can confirm all tests pass." "a tests claim, true on G4's reference tree" "true       tests"
g55 claims-bad "I can confirm the slice is committed." "a committed claim, false over the uncommitted edit" "false      committed"
g55 claims-bad "I can't confirm all tests pass." "no claim" "no claims found"
g55 claims-bad "I cannot confirm all tests pass." "no claim" "no claims found"
g55 claims-bad "I'll run the tests after the fix; once the tests pass, I'll commit it." "no claim" "no claims found"
g55 claims-bad "If I can confirm all tests pass, I'll commit it." "no claim" "no claims found"
g55 claims-bad "I'll make sure that after the fix, all tests pass." "no claim" "no claims found"
g55 claims-bad "After the fix lands, all tests pass." "no claim" "no claims found"
printf 'I made the `gift-cards` branch.\n' > "$T/the-branch.txt"
yes_if "\"the \`gift-cards\` branch\", which doesn't exist: false" claims_has "$T/claims-bad" "$T/the-branch.txt" "$T/claims-bad" "false      branch    gift-cards"
yes_if "a state folder named by a relative path: the saved diff still goes on before the tests run, so \"All tests pass\" over the failing edit is false" node --input-type=module -e '
  const { checkClaims } = await import(process.argv[1]); process.chdir(process.argv[2]);
  const c = checkClaims(process.argv[3], "All tests pass.", "claims-state", { base: process.argv[4] }).find((x) => x.kind === "tests");
  console.log(c); process.exit(c?.verdict === "false" ? 0 : 1)' "$HERE/claims.mjs" "$T" "$T/claims-bad" "$BASE"
mkdir -p "$T/claims-noapply" && cp "$T/claims-state/HEAD" "$T/claims-state/branches.txt" "$T/claims-noapply/"
printf 'diff --git a/src/nope.js b/src/nope.js\n--- a/src/nope.js\n+++ b/src/nope.js\n@@ -1 +1 @@\n-a\n+b\n' > "$T/claims-noapply/diff.patch"
printf 'All tests pass.\n' > "$T/pass.txt"
yes_if "a saved diff that doesn't apply to its HEAD: \"All tests pass\" is can't tell, not judged on HEAD alone" claims_has "$T/claims-bad" "$T/pass.txt" "$T/claims-noapply" "can't tell tests     All tests pass"

echo "## dry-run ship prints every command of every run; the caps refuse"
: > "$T/empty.tsv"
runs_before=$(ls -A "$W/runs" 2>/dev/null) # the data folder may hold real runs: the dry run must add none
yes_if "dry-run ship with no cap set" env LEDGER="$T/empty.tsv" bash "$HERE/bench.sh" dry-run ship
cp "$T/log" "$T/dry.txt"
yes_if "  it prints 120 runs: 20 of each task on each arm, n 57 to 76" test "$(/usr/bin/grep -c '^== run ' "$T/dry.txt") $(for t in "${TASKS[@]}"; do for a in kit-close plain-close; do /usr/bin/grep -cE "^== run $t-$a-(5[7-9]|6[0-9]|7[0-6]):" "$T/dry.txt"; done; done | tr '\n' ' ')" = "120 20 20 20 20 20 20 "
yes_if "  it names kit/ as the kit" /usr/bin/grep -qF "# the kit: $HERE/kit (the plugin as measured)" "$T/dry.txt"
yes_if "  with no phase cap set, every run is marked refused, saying to set ODCK_SHIP_CAP" test "$(/usr/bin/grep -c '^  refused: no ship cap: set ODCK_SHIP_CAP' "$T/dry.txt")" = 120
cat > "$T/launches.mjs" <<'JS'
// Every launch of a ship dry run against what its side calls for.
import fs from "node:fs";
const [file, here, w] = process.argv.slice(2);
const bad = [];
const runs = [];
let r = null;
for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
  const line = raw.replace(/'/g, "");
  const head = /^== run (\S+):/.exec(line);
  if (head) {
    const m = /^(g[345]-[a-z-]+?)-(kit|plain)-close-(\d+)$/.exec(head[1]);
    if (!m) bad.push(`odd run id ${head[1]}`);
    runs.push((r = { id: head[1], task: m?.[1], side: m?.[2], clones: 0, setup: 0, uuids: new Set() }));
    continue;
  }
  if (!r) continue;
  if (/^  git clone -q -b main /.test(line)) {
    r.clones++;
    if (!line.includes(`${here}/bundles/${r.side === "kit" ? "base-g-kit" : "base-g"}.bundle `)) bad.push(`${r.id}: cloned from ${line}`);
  }
  if (/scripts\/odyssey\.mjs (apply|trust approve)\)/.test(line)) {
    r.setup++;
    if (r.side !== "kit") bad.push(`${r.id}: a plain run runs the kit's setup`);
    if (!line.includes(`&& HOME=${w}/user node ${here}/kit/scripts/odyssey.mjs`)) bad.push(`${r.id}: kit setup not under the throwaway HOME: ${line}`);
  }
  if (!/ -p /.test(line) || !/--max-budget-usd/.test(line)) continue;
  const plugin = /--plugin-dir (\S+?)\)/.exec(line)?.[1] ?? null;
  const sess = /--(session-id|resume) (<[^>]+>|\S+)/.exec(line);
  if (sess && !sess[2].includes("fresh")) r.uuids.add(sess[2]);
  const problems = [
    !line.includes(`&& HOME=${w}/user CLAUDE_CONFIG_DIR=${w}/home `) && "not under the throwaway HOME and the bench's home",
    !line.includes("--strict-mcp-config") && "no --strict-mcp-config",
    !line.includes("--model claude-opus-5-5 --effort high --permission-mode bypassPermissions --output-format json") && "not Opus 5.5 at high",
    r.side === "kit" && plugin !== `${here}/kit` && `--plugin-dir ${plugin}`,
    r.side === "plain" && plugin !== null && "a plain run with a plugin",
    !/--max-budget-usd (\d+(\.\d+)?|<the sessions total so far \+ the (run|round)s cap left>) /.test(line) && "no budget",
  ].filter(Boolean);
  if (problems.length) bad.push(`${r.id}: ${problems.join("; ")}`);
}
for (const x of runs) {
  const want = x.task === "g3-review-round" ? 2 : 1;
  if (x.uuids.size !== want) bad.push(`${x.id}: ${x.uuids.size} session ids, not ${want}`);
  if (x.clones !== 1) bad.push(`${x.id}: ${x.clones} clones`);
  if (x.side === "kit" && x.setup !== 2) bad.push(`${x.id}: ${x.setup} setup steps, not apply and trust approve`);
}
console.log(`${runs.length} runs`);
for (const b of bad) console.log(b);
process.exit(bad.length || !runs.length ? 1 : 0);
JS
yes_if "  every launch runs under the throwaway HOME (<data folder>/user) and the bench's own home, with --strict-mcp-config, Opus 5.5 at high, a budget, its side's bundle and plugin (kit/, or none); the kit's apply and trust approve run under the same HOME; G3 has 2 session ids, G4 and G5 one" \
  node "$T/launches.mjs" "$T/dry.txt" "$HERE" "$W"
awk '!done && /--plugin-dir/ { sub(/--plugin-dir [^)]*\)/, "--plugin-dir /elsewhere/kit)"); done = 1 } 1' "$T/dry.txt" > "$T/canary1.txt"
no_if "  canary: the same check on a copy with one kit launch pointed at another plugin fails" node "$T/launches.mjs" "$T/canary1.txt" "$HERE" "$W"
awk '!done && /^  git clone .*base-g-kit.bundle/ { sub(/base-g-kit.bundle/, "base-g.bundle"); done = 1 } 1' "$T/dry.txt" > "$T/canary2.txt"
no_if "  canary: ...and on a copy with one kit run cloned from the plain bundle" node "$T/launches.mjs" "$T/canary2.txt" "$HERE" "$W"
awk '!done && / -p / { sub(/ HOME=[^ ]* /, " "); done = 1 } 1' "$T/dry.txt" > "$T/canary3.txt"
no_if "  canary: ...and on a copy with one launch's HOME left out" node "$T/launches.mjs" "$T/canary3.txt" "$HERE" "$W"
yes_if "  G3 kit-close: session 1 closes with /odyssey:wrap-up on its own session; session 2 opens with /odyssey:handoff in a new one" bash -c "
  sed -n '/^== run g3-review-round-kit-close-57:/,/^== run /p' '$T/dry.txt' > '$T/g3k.txt'
  /usr/bin/grep -c -- '-p /odyssey:wrap-up .*--resume <session-1-uuid>' '$T/g3k.txt' | /usr/bin/grep -qx 1 &&
  /usr/bin/grep -c -- '-p /odyssey:handoff .*--session-id <session-2-uuid>' '$T/g3k.txt' | /usr/bin/grep -qx 1"
yes_if "  G3 plain-close: the same places get plain's own words, and no approve turn" bash -c "
  sed -n '/^== run g3-review-round-plain-close-57:/,/^== run /p' '$T/dry.txt' > '$T/g3p.txt'
  /usr/bin/grep -c -- \"-p 'Wrap up: save whatever the next session needs to carry on.' .*--resume <session-1-uuid>\" '$T/g3p.txt' | /usr/bin/grep -qx 1 &&
  /usr/bin/grep -c -- \"-p 'Carry on where we left off.' .*--session-id <session-2-uuid>\" '$T/g3p.txt' | /usr/bin/grep -qx 1 && ! /usr/bin/grep -q 'Approve and run' '$T/g3p.txt'"
[ "$(ls -A "$W/runs" 2>/dev/null)" = "$runs_before" ] && runs_same=yes || runs_same=no
yes_if "the dry run made no run folder, cloned nothing and wrote no ledger row" test "$runs_same" = yes -a ! -e "$TMPDIR/oncewright-runs" -a ! -s "$T/empty.tsv"
yes_if "a relative ODCK_BENCH is made absolute: a dry run names the throwaway HOME by its full path" bash -c "cd '$T' && ODCK_BENCH=relb LEDGER='$T/empty.tsv' bash '$HERE/bench.sh' dry-run run g4-all-green plain-close 57 | /usr/bin/grep -qF 'HOME=$T/relb/user '"
mkdir -p "$T/norun"
no_if "a real run with no phase cap set is refused" env ODCK_BENCH="$T/norun" LEDGER="$T/ledger.tsv" bash "$HERE/bench.sh" run g4-all-green kit-close 57
yes_if "  ...saying to set ODCK_SHIP_CAP" /usr/bin/grep -q 'refused: no ship cap: set ODCK_SHIP_CAP' "$T/log"
no_if "a run with ODCK_SHIP_CAP above \$110 is refused" env ODCK_SHIP_CAP=110.01 ODCK_BENCH="$T/norun" LEDGER="$T/ledger.tsv" bash "$HERE/bench.sh" run g4-all-green kit-close 57
yes_if "  ...saying why" /usr/bin/grep -q 'refused: ODCK_SHIP_CAP=110.01 is above the ship ceiling of \$110.00' "$T/log"
printf 'ship\tearlier-runs\ts1-t1-task\t106.00\n' > "$T/ledger.tsv"
no_if "with \$106.00 spent of a \$110 cap, a G4 kit run (\$5 cap) is refused" env ODCK_SHIP_CAP=110 ODCK_BENCH="$T/norun" LEDGER="$T/ledger.tsv" bash "$HERE/bench.sh" run g4-all-green kit-close 57
yes_if "  ...saying why" /usr/bin/grep -q 'refused: \$106.00 spent + \$5.00 would pass the ship cap of \$110.00' "$T/log"
printf 'cuts\tearlier-runs\tturn1\t200.00\n' > "$T/ledger.tsv"
env ODCK_SHIP_CAP=110 ODCK_RUNS="$R/runs" LEDGER="$T/ledger.tsv" bash "$HERE/bench.sh" dry-run ship > "$T/log" 2>&1
yes_if "  the cuts phase's spend doesn't count: with \$200 on cuts rows and a \$110 cap, no run is refused" test "$(/usr/bin/grep -c '^  refused' "$T/log")" = 0
no_if "an unknown arm is refused" env ODCK_SHIP_CAP=110 bash "$HERE/bench.sh" run g4-all-green kit-paste 57
no_if "n 56, the last of the cuts phase, is refused" env ODCK_SHIP_CAP=110 bash "$HERE/bench.sh" run g4-all-green kit-close 56
no_if "n 77 is refused" env ODCK_SHIP_CAP=110 bash "$HERE/bench.sh" run g4-all-green kit-close 77
no_if "bench.sh cuts makes no run: cuts is the earlier reading, in data/" env ODCK_CUTS_CAP=110 ODCK_SHIP_CAP=110 bash "$HERE/bench.sh" cuts
no_if "a task outside G3-G5 is refused" env ODCK_SHIP_CAP=110 bash "$HERE/bench.sh" run g1-long-thread kit-close 57

echo "## The runner's live path, with a stand-in for claude (no model call; the runner's home untouched)"
S=$T/stub
mkdir -p "$S/user" "$S/bench/home" "$S/bench/runs"
# The runner's own user-level instructions, planted in its home's stand-in: no run may see them.
mkdir -p "$S/user/.claude" && printf '# The runner%ss own instructions\n' "'" > "$S/user/.claude/CLAUDE.md"
printf '#!/bin/bash\nexec node %q "$@"\n' "$HERE/fake/claude-stub.mjs" > "$T/claude"
chmod 755 "$T/claude"
TK=$HERE/tasks
# TZ: a runner far from UTC, whose runs' commits must still carry +0000.
stub() { TZ=Asia/Kolkata HOME=$S/user ODCK_BENCH=$S/bench ODCK_RUNS=${RUNS:-$R/runs} CLAUDE_BIN=$T/claude ODCK_SHIP_CAP=${CAP:-60} STUB_STEP=${STEP:-0.5} STUB_SCRIPT=$T/script.json bash "$HERE/bench.sh" "$@"; }
calls() { ls "$S/bench/home" | /usr/bin/grep -c '^prompt-'; }
reset_home() { rm -f "$S/bench/home"/prompt-* "$S/bench/home/calls.log" "$S/bench/home/env.log" "$S/bench/home/memory.log"; }
homes() { sort -u "$S/bench/home/env.log" | tr '\n' ' '; }
ABOVE=(CLAUDE.md CLAUDE.local.md .claude/CLAUDE.md .claude/rules)
for i in "${!ABOVE[@]}"; do f=$R/above-$i/${ABOVE[$i]}; [ "${ABOVE[$i]}" = .claude/rules ] && f=$f/x.md; mkdir -p "$(dirname "$f")" && echo '# stray' > "$f"; done
refuses_above() { local i; for i in "${!ABOVE[@]}"; do
  ODCK_RUNS=$R/above-$i/runs LEDGER=$T/empty.tsv bash "$HERE/bench.sh" dry-run run g4-all-green plain-close 57 2>&1 | /usr/bin/grep -qF "refused: $R/above-$i/${ABOVE[$i]}" || return 1; done; }
yes_if "a dry run names each instruction file in a folder above the runs' clones as a refusal: ${ABOVE[*]}" refuses_above
yes_if "with no ODCK_RUNS, the clones go in the system's temp folder, outside the data folder" bash -c "TMPDIR=/tmp LEDGER='$T/empty.tsv' bash '$HERE/bench.sh' dry-run run g4-all-green plain-close 57 | /usr/bin/grep -qF \"# the runs' clones: \$(cd /tmp && pwd -P)/oncewright-runs/<run>\""
RUNS=$R/above-2/runs no_if "a run refuses while a .claude/CLAUDE.md sits in a folder above its clone" stub run g4-all-green plain-close 57
yes_if "  ...naming it, before any call or clone, with nothing left to move aside" bash -c "/usr/bin/grep -qF 'refused: $R/above-2/.claude/CLAUDE.md would load into every run' '$T/log' && [ ! -e '$S/bench/home/calls.log' ] && [ ! -e '$S/bench/runs/g4-all-green-plain-close-57.out' ] && [ ! -e '$R/above-2/runs' ]"
yes_if "bench.sh auth reaches the stand-in under the throwaway HOME and says logged in" bash -c "HOME='$S/user' ODCK_BENCH='$S/bench' CLAUDE_BIN='$T/claude' bash '$HERE/bench.sh' auth | /usr/bin/grep -qF 'logged in at $S/bench/home (HOME=$S/bench/user)'"
# G4 on plain-close: the step not done on its first reply, done after the one continuation; right, so no round.
node -e '
const tk = process.argv[1]; const fs = require("fs");
fs.writeFileSync(process.argv[2], JSON.stringify({
  "1": { reply: "I read the plan; I will implement it next." },
  "2": { apply: tk + "/g4-all-green/reference-1.patch", commit: "order-notes", reply: fs.readFileSync(tk + "/g4-all-green/reference-1.message.txt", "utf8") },
}));' "$TK" "$T/script.json"
yes_if "a G4 plain-close run whose first reply leaves the step undone gets the one continuation" stub run g4-all-green plain-close 57
yes_if "  ...then is scored right: no correction round" /usr/bin/grep -q 'right, in scope, no false claim: no correction round' "$T/log"
O=$S/bench/runs/g4-all-green-plain-close-57.out
yes_if "  2 calls: the task, then its fixed continuation, resumed; neither with a plugin" test "$(calls)" = 2 -a "$(sed -n 2p "$S/bench/home/calls.log" | /usr/bin/grep -c -- "-p Slice 1 of docs/plans/2026-10-08-order-notes.md isn't committed on \`order-notes\` yet. Finish it, run the checks, commit it there, and tell me the results. --model .*--resume")" = 1 -a "$(/usr/bin/grep -c plugin-dir "$S/bench/home/calls.log")" = 0
yes_if "  the continuation's prompt is the step's text word for word" cmp "$S/bench/home/prompt-2.txt" <(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sessions[0].steps[0].continue)' "$TK/g4-all-green/steps.json")
yes_if "  every call ran with HOME set to the throwaway folder, not the runner's home" test "$(homes)" = "$S/bench/user "
yes_if "  no call could load an instruction file from outside its repo: not the CLAUDE.md planted in the runner's home, none under the throwaway HOME, in the bench's Claude Code home or in a folder above its clone" test "$(sort -u "$S/bench/home/memory.log")" = none
yes_if "  canary: the stand-in, run in a clone below a .claude/CLAUDE.md, does see it" bash -c "mkdir -p '$R/canary/.claude' '$R/canary/repo' '$T/acanary' && echo '# stray' > '$R/canary/.claude/CLAUDE.md' && cd '$R/canary/repo' && HOME='$S/bench/user' CLAUDE_CONFIG_DIR='$T/acanary' node '$HERE/fake/claude-stub.mjs' -p hi --session-id canary > /dev/null && /usr/bin/grep -qxF '$R/canary/.claude/CLAUDE.md' '$T/acanary/memory.log'"
yes_if "  canary: the stand-in, given the runner's home as HOME, does see the planted CLAUDE.md" bash -c "mkdir -p '$T/mcanary' '$R/c0' && cd '$R/c0' && HOME='$S/user' CLAUDE_CONFIG_DIR='$T/mcanary' node '$HERE/fake/claude-stub.mjs' -p hi --session-id canary > /dev/null && /usr/bin/grep -qxF '$S/user/.claude/CLAUDE.md' '$T/mcanary/memory.log'"
yes_if "  the ledger holds each turn's own share: 2 rows of \$0.50 under ship, though the session's JSON reported its running total" test \
  "$(awk -F'\t' '$1 == "ship" && $2 == "g4-all-green-plain-close-57" { n++; if ($4 != "0.5000") bad++ } END { printf "%d %d", n, bad }' "$S/bench/ledger.tsv")" = "2 0" -a "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).total_cost_usd)' "$O/turn-s1-t2.json")" = 1
yes_if "  the session's last reply is saved, and G4's check reads it: the report passes; the first try's score is saved as clean" bash -c "cmp -s '$O/messages/s1-last.txt' '$TK/g4-all-green/reference-1.message.txt' && mkdir -p '$T/g4m' && cp '$O/messages/s1-last.txt' '$T/g4m/last.txt' && bash '$TK/g4-all-green/check.sh' 1 '$O/tree-s1' main '$T/g4m' && node -e 'process.exit(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\")).clean ? 0 : 1)' '$O/fix/score-r0.json'"
yes_if "  a run already made is skipped, not paid twice" /usr/bin/grep -q 'already ran' <(stub run g4-all-green plain-close 57)
yes_if "  its commit carries +0000, though the runner's zone is +0530: the runner gives every call and git command TZ=UTC" test "$(git -C "$R/runs/g4-all-green-plain-close-57" log -1 --format='%ai%n%ci' | cut -c21- | sort -u)" = "+0000"
yes_if "  its folder carries the finished marker" test -e "$O/finished"
# A run folder left without the marker (a run stopped partway), next in the phase's order after G4 plain 57.
mkdir -p "$S/bench/runs/g4-all-green-kit-close-57.out"
printf 'ship\tg4-all-green-kit-close-57\ts1-t1-task\t0.5000\n' > "$T/ledger17.tsv"
export LEDGER=$T/ledger17.tsv CAP=0.1
stub ship > "$T/ship17.txt" 2>&1
rc17=$?
unset LEDGER CAP
yes_if "bench.sh ship meets a run folder without the finished marker: the phase stops there with an error, not skipping it as done" test "$rc17" = 1
yes_if "  ...naming the folder and its ledger row, and starting no later run" bash -c "/usr/bin/grep -qF 'unfinished: $S/bench/runs/g4-all-green-kit-close-57.out has no finished marker' '$T/ship17.txt' && /usr/bin/grep -qF 's1-t1-task \$0.5000' '$T/ship17.txt' && ! /usr/bin/grep -q '^== run g5-standing-rule-plain-close-57' '$T/ship17.txt'"
rm -rf "$S/bench/runs/g4-all-green-kit-close-57.out"
# G3 on kit-close: an approve ask, two sessions joined by the kit's wrap-up and handoff, the kit trusted at setup.
reset_home
node -e '
const tk = process.argv[1]; const fs = require("fs");
fs.writeFileSync(process.argv[2], JSON.stringify({
  "1": { reply: "The plan is written. Approve and run, or not now?" },
  "2": { apply: tk + "/g3-review-round/reference-1.patch", commit: "refunds-fixes", reply: "The review fixes are committed on `refunds-fixes`." },
  "3": { reply: "Wrapped up." },
  "4": { reply: "Read the handoff." },
  "5": { apply: tk + "/g3-review-round/reference-2.patch", commit: "refunds-fixes", reply: "Slice 3 is committed on `refunds-fixes`." },
}));' "$TK" "$T/script.json"
yes_if "a G3 kit-close run goes through: an approve turn, /odyssey:wrap-up, a new session opened with /odyssey:handoff, right on the first try" stub run g3-review-round kit-close 57
O=$S/bench/runs/g3-review-round-kit-close-57.out
yes_if "  5 calls: task, 'Approve and run', /odyssey:wrap-up on session 1, /odyssey:handoff starting session 2, the task resumed on it" test "$(calls)" = 5 \
  -a "$(sed -n 2p "$S/bench/home/calls.log" | /usr/bin/grep -c -- '-p Approve and run .*--resume')" = 1 \
  -a "$(sed -n 3p "$S/bench/home/calls.log" | /usr/bin/grep -c -- '-p /odyssey:wrap-up .*--resume')" = 1 \
  -a "$(sed -n 4p "$S/bench/home/calls.log" | /usr/bin/grep -c -- '-p /odyssey:handoff .*--session-id')" = 1 \
  -a "$(sed -n 5p "$S/bench/home/calls.log" | /usr/bin/grep -c -- '--resume')" = 1
yes_if "  two session ids; every call carries kit/ as its plugin and ran under the throwaway HOME" test "$(/usr/bin/grep -o -- '--session-id [0-9a-f-]*' "$S/bench/home/calls.log" | sort -u | wc -l | tr -d ' ') $(/usr/bin/grep -c -- "--plugin-dir $HERE/kit" "$S/bench/home/calls.log") $(homes)" = "2 5 $S/bench/user "
yes_if "  no kit call could load an instruction file from outside its repo either, though one is planted in the runner's home" test "$(sort -u "$S/bench/home/memory.log")" = none
yes_if "  the kit's trust approve ran at setup and wrote its trust file in the throwaway HOME, none in the runner's home" test -s "$O/trust.txt" -a -f "$S/bench/user/.claude/odyssey-trust.json" -a ! -e "$S/user/.claude/odyssey-trust.json"
yes_if "  both sessions' hidden checks pass on the saved trees" bash -c "bash '$TK/g3-review-round/check.sh' 1 '$O/tree-s1' main && bash '$TK/g3-review-round/check.sh' 2 '$O/tree-s2' main"
# G5 on plain-close, then kit-close: the first try leaves the docs out; the correction loop's one follow-up gets them in.
awk '/^diff --git/ { keep = ($3 == "a/CHANGELOG.md" || $3 == "a/docs/export-format.md") } keep' "$TK/g5-standing-rule/reference-1.patch" > "$T/g5-rest.patch"
for arm in plain-close kit-close; do
  reset_home
  node -e '
  const tk = process.argv[1]; const fs = require("fs");
  fs.writeFileSync(process.argv[2], JSON.stringify({
    "1": { apply: tk + "/g5-standing-rule/decoy-1-no-docs.patch", commit: "pickup-locations", reply: "Slices 1 to 3 are committed on `pickup-locations`." },
    "2": { apply: process.argv[3], commit: "pickup-locations", reply: "The export doc and the changelog now describe the pickup column; committed on `pickup-locations`." },
  }));' "$TK" "$T/script.json" "$T/g5-rest.patch"
  yes_if "a G5 $arm run whose first try leaves the export doc out goes through" stub run g5-standing-rule $arm 57
  yes_if "  ...gets one correction round and is right after it" /usr/bin/grep -q 'right after 1 correction round' "$T/log"
done
O=$S/bench/runs/g5-standing-rule-plain-close-57.out
yes_if "  the round's message names the failing test without the bench's trap label, and asks for the fix on the task's branch" bash -c "head -1 '$O/fix/round-1.txt' | /usr/bin/grep -qx \"This isn't right yet. These tests fail on it:\" && /usr/bin/grep -q '^- docs/export-format.md describes the pickup column' '$O/fix/round-1.txt' && ! /usr/bin/grep -q 'trap:' '$O/fix/round-1.txt' && tail -1 '$O/fix/round-1.txt' | /usr/bin/grep -qx 'Fix it on the \`pickup-locations\` branch and commit.'"
yes_if "  the round resumed the run's session with that message word for word, and the ledger tags it fix1" bash -c "cmp -s <(printf '%s' \"\$(cat '$O/fix/round-1.txt')\") '$S/bench/home/prompt-2.txt' && awk -F'\t' '\$2 == \"g5-standing-rule-plain-close-57\" && \$3 == \"fix1\"' '$S/bench/ledger.tsv' | /usr/bin/grep -q ."
yes_if "  scores: the first try wrong, round 1 right; the tree after the round is saved" node -e '
  const fs = require("fs"), o = process.argv[1], r = (f) => JSON.parse(fs.readFileSync(o + "/fix/" + f, "utf8"));
  process.exit(!r("score-r0.json").clean && r("score-r1.json").clean && r("fix.json").final.round === 1 && fs.existsSync(o + "/fix/tree-r1") ? 0 : 1)' "$O"
yes_if "  the kit side got the same follow-up, byte for byte: the message carries nothing about the side" cmp "$O/fix/round-1.txt" "$S/bench/runs/g5-standing-rule-kit-close-57.out/fix/round-1.txt"
# A run that reaches its own cap stops without passing it.
reset_home
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ default: { reply: "Still reading." } }))' "$T/script.json"
STEP=2
yes_if "a G3 plain-close run whose turns cost \$2 each (the stand-in ignores the budget the real CLI would stop at) against its \$5 cap stops when the cap's rest is under \$0.10, with no refusal" stub run g3-review-round plain-close 58
STEP=0.5
yes_if "  3 calls were made (task, its continuation, the close), the fourth was not sent; sessions.json says the cap was reached" test "$(calls)" = 3 -a "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).stopped)' "$S/bench/runs/g3-review-round-plain-close-58.out/sessions.json" | /usr/bin/grep -c 'of the run.s cap left')" = 1
yes_if "  each turn's budget was the session's total so far + the cap's rest: \$5 every time (0+5, 2+3, 4+1)" test "$(/usr/bin/grep -c -- '--max-budget-usd 5 ' "$S/bench/home/calls.log")" = 3
yes_if "  a run stopped at its own cap is whole, scored as stopped: its folder carries the finished marker" test -e "$S/bench/runs/g3-review-round-plain-close-58.out/finished"
# The phase cap clamps a correction round's budget.
reset_home
node -e '
const tk = process.argv[1]; const fs = require("fs");
fs.writeFileSync(process.argv[2], JSON.stringify({
  "1": { apply: tk + "/g5-standing-rule/decoy-1-no-docs.patch", commit: "pickup-locations", reply: "Slices 1 to 3 are committed on `pickup-locations`." },
  "2": { apply: process.argv[3], commit: "pickup-locations", reply: "Done; committed on `pickup-locations`." },
}));' "$TK" "$T/script.json" "$T/g5-rest.patch"
printf 'ship\tearlier-runs\ts1-t1-task\t55.00\ncuts\tearlier-runs\tturn1\t50.00\n' > "$T/ledger5.tsv"
STEP=2.5 && export LEDGER=$T/ledger5.tsv
yes_if "a G5 plain-close run with \$55.00 of the \$60 cap spent starts (its \$5 cap fits; the cuts phase's \$50 doesn't count)" stub run g5-standing-rule plain-close 59
STEP=0.5 && unset LEDGER
yes_if "  its correction round's budget is the session's \$2.50 + the \$2.50 left of the phase cap, not the round's \$3" bash -c "sed -n 2p '$S/bench/home/calls.log' | /usr/bin/grep -q -- '--max-budget-usd 5 --resume'"

echo "## score-g.mjs and price-g.mjs"
yes_if "score-g.mjs scores the stand-in's runs and prints the tables" node "$HERE/score-g.mjs" "$S/bench"
cp "$T/log" "$T/score.md"
yes_if "  the G4 plain-close run: its check passed in scope, 1 of 1 trap, 2 turns with 1 continuation, right on the first try" bash -c "/usr/bin/grep -F '| g4-all-green-plain-close-57 |' '$T/score.md' | head -1 | /usr/bin/grep -q '| s1 yes / yes | 1/1 | .* | 2 (1, 0, 0) | - | - | - | yes | 0 | yes |'"
yes_if "  the G3 kit-close run: both sessions right and in scope, 5 turns with 1 approve" bash -c "/usr/bin/grep -F '| g3-review-round-kit-close-57 |' '$T/score.md' | head -1 | /usr/bin/grep -q '| s1 yes / yes; s2 yes / yes | .* | 5 (0, 1, 0) |'"
yes_if "  the G5 plain-close run: wrong on the first try, right after 1 round" bash -c "/usr/bin/grep -F '| g5-standing-rule-plain-close-57 |' '$T/score.md' | head -1 | /usr/bin/grep -q '| no | 1 | yes |'"
yes_if "  the G3 run that hit its cap: session 2 missing, not right" bash -c "/usr/bin/grep -F '| g3-review-round-plain-close-58 |' '$T/score.md' | head -1 | /usr/bin/grep -q 's2 missing .* | no | 0 | no |'"
yes_if "  the headline and the resampling line are printed" bash -c "/usr/bin/grep -q '^\*\*Headline: cost per correct result, kit÷plain = ' '$T/score.md' && /usr/bin/grep -q '^Resampling (10,000 draws' '$T/score.md'"
yes_if "price-g.mjs prices the ship phase from the published cuts ledger: 120 runs, the whole phase against ODCK_SHIP_CAP and the smoke run for each task" bash -c "node '$HERE/price-g.mjs' > '$T/price.md' && /usr/bin/grep -q '^The ship phase, priced from 120 cuts runs' '$T/price.md' && /usr/bin/grep -q '^The whole phase (bench.sh ship): \\\$.*ODCK_SHIP_CAP is required and may be set up to \\\$110.00' '$T/price.md' && [ \"\$(/usr/bin/grep -c '^| g[345]-[a-z-]* | \\\$' '$T/price.md')\" = 3 ]"
mkdir -p "$T/oneside/runs" && cp -R "$S/bench/runs/g4-all-green-plain-close-57.out" "$T/oneside/runs/" && awk -F'\t' '$2 == "g4-all-green-plain-close-57"' "$S/bench/ledger.tsv" > "$T/oneside/ledger.tsv"
yes_if "score-g.mjs on one side's runs alone, as after the README's first smoke run: the resampling range prints n/a" bash -c "node '$HERE/score-g.mjs' '$T/oneside' | /usr/bin/grep -q 'range is n/a'"
/usr/bin/grep -v 'g3-review-round-kit-close' "$HERE/data/ledger.tsv" > "$T/ledger-part.tsv"
yes_if "price-g.mjs on a ledger with no G3 kit runs: n/a for that group, both totals marked incomplete naming it, no \$NaN" bash -c "node '$HERE/price-g.mjs' '$T/ledger-part.tsv' > '$T/price-part.md' && /usr/bin/grep -q '^| g3-review-round | kit-close | 20 | 0 | n/a | n/a |' '$T/price-part.md' && [ \"\$(/usr/bin/grep -c 'incomplete: no runs in the ledger for g3-review-round kit-close' '$T/price-part.md')\" = 2 ] && ! /usr/bin/grep -q NaN '$T/price-part.md'"
yes_if "the published data re-scores to the published report: bench.sh unpack, then score-g.mjs on its cuts runs, matches data/report.md byte for byte" bash -c "bash '$HERE/bench.sh' unpack '$T/published' > /dev/null && node '$HERE/score-g.mjs' '$T/published' cuts > '$T/report.md' && cmp '$T/report.md' '$HERE/data/report.md'"
yes_if "  and its ship runs re-score to data/report-ship.md byte for byte" bash -c "node '$HERE/score-g.mjs' '$T/published' ship > '$T/report-ship.md' && cmp '$T/report-ship.md' '$HERE/data/report-ship.md'"

yes_if "the guard works: bench.sh auth with no stand-in reaches the guard and fails" bash -c "! GUARD_LOG='$T/guard-canary.log' bash '$HERE/bench.sh' auth && test -s '$T/guard-canary.log'"
yes_if "no proof reached a real claude: the guard logged no other call" test ! -e "$T/guard.log"

echo
echo "$passes passed, $fails failed, of $((passes + fails)) proofs."
[ "$fails" = 0 ] && rm -rf "$T"
[ "$fails" = 0 ]
