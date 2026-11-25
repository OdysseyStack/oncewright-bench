// Checks for the Odyssey status bar (scripts/statusline.mjs) and the setup script's `bar`,
// `tips`, `mod` and doctor lines that install and check what goes in the user's settings: the
// rows and what each part shows, the cost's labels, the wrap-up mark, ponytail's default badge
// giving way, the handoff tag, the limits row and its reset times, each row
// fitted to the room Claude Code gives it, the helper-agent rows, the install that keeps a status
// line already set and saves the settings first, the tips, peek's copy with the secrets guard
// beside it and its place in the settings' plugin folders, and the optional theme shipped byte
// for byte.
//
// Each install check runs the setup script as a process with HOME at its own scratch home, so
// the real ~/.claude is never read or written. Offline and deterministic.
//
// Run: node --test scripts/statusline.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { costLabel, modelName, render, row, shellFor, width } from "./statusline.mjs";

const BAR = fileURLToPath(new URL("./statusline.mjs", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./odyssey.mjs", import.meta.url));
const PLUGIN = path.dirname(path.dirname(SCRIPT));
delete process.env.CLAUDE_CONFIG_DIR; // the machine extras follow it; every test here sets its own HOME
const scratch = realpathSync.native(mkdtempSync(path.join(tmpdir(), "odyssey-bar-")));

after(() => {
  assert.ok(scratch.startsWith(realpathSync.native(tmpdir()) + path.sep), "scratch dir is under tmpdir");
  assert.ok(path.basename(scratch).startsWith("odyssey-bar-"), "scratch dir is ours");
  rmSync(scratch, { recursive: true, force: true });
});

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const GOLD = "\x1b[38;2;244;184;96m";
const CYAN = "\x1b[38;2;11;197;253m";
const INF = "\u267e\ufe0f";
const cells = "█".repeat(20);
const withMark = "█".repeat(7) + "│" + "█".repeat(13); // the default mark, 35%
const NOENV = {};

let homes = 0;
// A scratch home with an optional settings file: an object is written as JSON, a string as is.
function home(settings) {
  const at = path.join(scratch, `home-${++homes}`);
  mkdirSync(path.join(at, ".claude"), { recursive: true });
  if (settings !== undefined) {
    const text = typeof settings === "string" ? settings : `${JSON.stringify(settings, null, 2)}\n`;
    writeFileSync(path.join(at, ".claude", "settings.json"), text);
  }
  return at;
}
const odyssey = (at, ...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: at, env: { ...process.env, HOME: at, USERPROFILE: at }, encoding: "utf8" });
const settingsOf = (at) => JSON.parse(readFileSync(path.join(at, ".claude", "settings.json"), "utf8"));

test("row 1 shows the badge, the context bar with its mark, the model and effort, and the cost; the limits take a row of their own", () => {
  assert.equal(strip(render({ context_window: { used_percentage: 42 } }, "[P]", NOENV)), `[P]  [ODYSSEY]  ${INF}  ctx ${withMark} 42%`);
  assert.equal(
    strip(render({ context_window: { used_percentage: null }, rate_limits: { five_hour: { used_percentage: 23.5 } } }, "", NOENV)),
    `[ODYSSEY]  ${INF}  ctx ${withMark} 0%\n5h ${cells} 24%`,
  );
  assert.ok(strip(render({ context_window: { used_percentage: 130 } }, "", NOENV)).includes(" 100%"), "clamped at 100");
  const full = { model: { display_name: "Opus 5.5" }, effort: { level: "max" }, context_window: { used_percentage: 42 }, cost: { total_cost_usd: 2 } };
  assert.equal(strip(render(full, "", NOENV)), `[ODYSSEY]  ${INF}  ctx ${withMark} 42%  Opus 5.5 · max  ≈ $2.00 est.`, "no limits, no messages: one row");
  const plain = render({ context_window: { used_percentage: 30 } }, "", NOENV);
  assert.ok(plain.includes(`${CYAN}█`) && !plain.includes(`${GOLD}█`), "cyan below the mark");
});

test("past the wrap-up mark the fill turns gold and, in a repo setup fitted, the row says how to wrap up; ODYSSEY_WRAPUP_PCT moves the mark", () => {
  const root = path.join(scratch, "repo-hint");
  mkdirSync(path.join(root, "directives", "handoff"), { recursive: true });
  const at65 = { workspace: { project_dir: root }, context_window: { used_percentage: 65 } };
  const over = render(at65, "", NOENV);
  assert.ok(over.includes(`${GOLD}█`));
  assert.equal(strip(over), `[ODYSSEY]  ${INF}  ctx ${withMark} 65% · wrap up: /odyssey:wrap-up`);
  const bare = render({ ...at65, workspace: { project_dir: path.join(scratch, "never-set-up") } }, "", NOENV);
  assert.ok(bare.includes(`${GOLD}█`) && !bare.includes("wrap up"), "no handoff folder: no hint, since wrap-up would write an unignored file");
  const moved = render(at65, "", { ODYSSEY_WRAPUP_PCT: "70" });
  assert.ok(!moved.includes("wrap up") && !moved.includes(`${GOLD}█`), "below a mark moved to 70");
  assert.ok(strip(moved).includes(`ctx ${"█".repeat(14)}│${"█".repeat(6)} 65%`), "the mark drawn at 70");
  assert.ok(render(at65, "", { ODYSSEY_WRAPUP_PCT: "abc" }).includes("wrap up"), "a value that isn't a percentage keeps 35");
});

test("the cost says plan or API, and is an estimate either way; a narrow terminal gets the short form", () => {
  const plan = { cost: { total_cost_usd: 1.837 }, rate_limits: { five_hour: { used_percentage: 3 } } };
  assert.equal(costLabel(plan, {}), "plan ≈ $1.84 at API rates");
  assert.equal(costLabel({ cost: { total_cost_usd: 1.837 }, rate_limits: { seven_day: { used_percentage: 3 } } }, {}), "plan ≈ $1.84 at API rates");
  assert.equal(costLabel(plan, {}, true), "plan ≈ $1.84");
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) {
    const label = costLabel({ cost: { total_cost_usd: 1.837 } }, { [key]: "1" });
    assert.equal(strip(label), "API ≈ $1.84 billed", key);
    assert.ok(label.startsWith(GOLD), `${key}: gold`);
    const short = costLabel({ cost: { total_cost_usd: 1.837 } }, { [key]: "1" }, true);
    assert.equal(strip(short), "API ≈ $1.84", `${key}: short`);
    assert.ok(short.startsWith(GOLD), `${key}: short and gold`);
  }
  assert.equal(costLabel({ cost: { total_cost_usd: 0 } }, {}), "≈ $0.00 est.");
  assert.equal(costLabel({ cost: { total_cost_usd: 0 } }, {}, true), "≈ $0.00 est.", "nothing to shorten");
  assert.equal(costLabel({}, {}), "", "no figure, no label");
});

test("ponytail's default badge gives way to [ODYSSEY]; its other badges and any other status line stay", () => {
  const data = { context_window: { used_percentage: 42 } };
  assert.ok(strip(render(data, "\x1b[38;5;108m[PONYTAIL]\x1b[0m", NOENV)).startsWith(`[ODYSSEY]  ${INF}`));
  assert.ok(strip(render(data, "\x1b[38;5;173m[PONYTAIL:ULTRA]\x1b[0m", NOENV)).startsWith("[PONYTAIL:ULTRA]  [ODYSSEY]"));
  assert.ok(strip(render(data, "\x1b[38;5;108m[PONYTAIL:LITE]\x1b[0m", NOENV)).startsWith("[PONYTAIL:LITE]  [ODYSSEY]"));
  assert.ok(strip(render(data, "main · 3 files", NOENV)).startsWith("main · 3 files  [ODYSSEY]"));
});

test("the row tags a waiting handoff, and nothing the file says", () => {
  const root = path.join(scratch, "repo");
  mkdirSync(path.join(root, "directives", "handoff"), { recursive: true });
  const handoff = path.join(root, "directives", "handoff", "current.md");
  const data = { workspace: { project_dir: root }, context_window: { used_percentage: 10 } };
  writeFileSync(handoff, "  \n<!-- Empty -->\n");
  assert.ok(!strip(render(data, "", NOENV)).includes("handoff waiting"), "the placeholder holds nothing");
  writeFileSync(handoff, "MESSAGE-TEXT\n");
  const tagged = render(data, "", NOENV);
  assert.ok(strip(tagged).endsWith("10% · handoff waiting"));
  assert.ok(tagged.includes(`${GOLD}handoff waiting`), "the handoff tag is gold");
  assert.doesNotMatch(tagged, /MESSAGE-TEXT/);
  assert.ok(!strip(render({ cwd: path.join(scratch, "nowhere") }, "", NOENV)).includes("handoff"), "no folder, no tag");
});

test("each row fits the room Claude Code gives it, COLUMNS less four, shortening in order; the badge and the context bar always stay", () => {
  const data = {
    context_window: { used_percentage: 42 },
    model: { display_name: "Opus 5.5" },
    effort: { level: "max" },
    cost: { total_cost_usd: 1.84 },
    rate_limits: { five_hour: { used_percentage: 24 } },
  };
  const row1 = (columns) => strip(render(data, "", { COLUMNS: String(columns) })).split("\n")[0];
  const head = `[ODYSSEY]  ${INF}  ctx ${withMark} 42%`;
  const narrow = `[ODYSSEY]  ${INF}  ctx ${"█".repeat(4)}│${"█".repeat(6)} 42%`;
  for (const [columns, expected] of [
    [91, `${head}  Opus 5.5 · max  plan ≈ $1.84 at API rates`],
    [90, `${head}  Opus 5.5 · max  plan ≈ $1.84`],
    [78, `${head}  Opus 5.5 · max  plan ≈ $1.84`],
    [77, `${head}  plan ≈ $1.84`],
    [62, `${head}  plan ≈ $1.84`],
    [61, `${narrow}  plan ≈ $1.84`],
    [52, `${narrow}  plan ≈ $1.84`],
    [51, narrow],
    [10, narrow],
  ]) {
    assert.equal(row1(columns), expected, `${columns} columns`);
    if (columns >= 50) assert.ok(width(expected) <= columns - 4, `${columns}: fits its room`);
  }
  assert.equal(row1(300), `${head}  Opus 5.5 · max  plan ≈ $1.84 at API rates`, "wide: everything");
  assert.equal(strip(render(data, "", {})).split("\n")[0], row1(300), "no COLUMNS: everything");
  const limits = (columns) => strip(render(data, "", { COLUMNS: String(columns) })).split("\n")[1];
  assert.equal(limits(300), `5h ${cells} 24%`);
  assert.equal(width(`a${INF}b`), 4, "the emoji takes two cells");
  assert.equal(width("\x1b]8;;https://example.com\x07main\x1b]8;;\x07"), 4, "a link's address takes no cells");
  assert.equal(width("\x1b]8;;https://example.com\x1b\\main\x1b]8;;\x1b\\"), 4, "either terminator");
  assert.equal(width("分支"), 4, "a wide character takes two cells");
  assert.equal(width("e\u0301"), 1, "a combining mark takes none");
});

test("the limits row: the five-hour and weekly windows with when each starts again in local time, gold from 80%, and a gateway's spend limit, which can pass 100%", () => {
  // Times built in local time read back the same in any time zone.
  const now = new Date(2026, 9, 1, 14, 0).getTime(); // Thu 1 Oct 2026, 2:00pm
  const at = (...parts) => new Date(...parts).getTime() / 1000;
  const reset = (key, when) => strip(render({ rate_limits: { [key]: { used_percentage: 5, resets_at: when } } }, "", NOENV, now)).split("\n")[1].split(" · ")[1];
  assert.equal(reset("five_hour", at(2026, 9, 1, 16, 10)), "resets 4:10pm", "the five-hour window: a time of day");
  assert.equal(reset("five_hour", at(2026, 9, 2, 0, 5)), "resets 12:05am");
  assert.equal(reset("five_hour", at(2026, 9, 1, 18, 0)), "resets 6pm");
  assert.equal(reset("seven_day", at(2026, 9, 5, 9, 0)), "resets Mon 9am", "the weekly window: its day too");
  assert.equal(reset("seven_day", at(2026, 9, 5, 12, 30)), "resets Mon 12:30pm");
  assert.equal(reset("spend_limit", at(2026, 10, 1, 0, 0)), "resets Nov 1", "a week or more out: the date");
  assert.equal(reset("five_hour", undefined), undefined, "no time sent, none shown");
  const data = {
    context_window: { used_percentage: 10 },
    rate_limits: {
      five_hour: { used_percentage: 83, resets_at: at(2026, 9, 1, 16, 10) },
      seven_day: { used_percentage: 31, resets_at: at(2026, 9, 5, 9, 0) },
    },
  };
  const rows = render(data, "", NOENV, now).split("\n");
  assert.equal(rows.length, 2);
  assert.equal(strip(rows[1]), `5h ${cells} 83% · resets 4:10pm  1w ${cells} 31% · resets Mon 9am`);
  const [five, week] = rows[1].split("1w");
  assert.ok(five.includes(`${GOLD}█`) && !week.includes(`${GOLD}█`), "gold at 83%, cyan at 31%");
  const limit = (used) => render({ rate_limits: { five_hour: { used_percentage: used } } }, "", NOENV, now).split("\n")[1];
  assert.ok(limit(80).includes(`${GOLD}█`), "80% is gold");
  assert.ok(!limit(79).includes(`${GOLD}█`), "79% is not");
  const spend = render({ rate_limits: { spend_limit: { used_percentage: 112.4, resets_at: at(2026, 10, 1, 0, 0) } } }, "", NOENV, now).split("\n")[1];
  assert.equal(strip(spend), `spend ${cells} 112% · resets Nov 1`, "past 100%: the figure as sent, the bar full");
  assert.ok(spend.includes(`${GOLD}█`));
  const narrow = (columns) => strip(render(data, "", { COLUMNS: String(columns) }, now)).split("\n")[1];
  const short = "█".repeat(10);
  assert.equal(narrow(93), `5h ${cells} 83% · resets 4:10pm  1w ${cells} 31% · resets Mon 9am`);
  assert.equal(narrow(92), `5h ${cells} 83% · resets 4:10pm  1w ${cells} 31%`, "the last window's reset time goes first");
  assert.equal(narrow(76), `5h ${cells} 83% · resets 4:10pm  1w ${cells} 31%`);
  assert.equal(narrow(75), `5h ${cells} 83%  1w ${cells} 31%`, "then the others'");
  assert.equal(narrow(60), `5h ${cells} 83%  1w ${cells} 31%`);
  assert.equal(narrow(59), `5h ${short} 83%  1w ${short} 31%`, "then the bars shrink");
  assert.equal(narrow(40), `5h ${short} 83%  1w ${short} 31%`);
  assert.equal(narrow(39), `5h ${short} 83%`, "then only the first window stays");
  assert.equal(narrow(10), `5h ${short} 83%`);
});

test("the messages end row 1 when they fit there whole, else take a row of their own: the wrap-up hint shortens first, then the handoff's tag goes", () => {
  const root = path.join(scratch, "repo-messages");
  mkdirSync(path.join(root, "directives", "handoff"), { recursive: true });
  writeFileSync(path.join(root, "directives", "handoff", "current.md"), "MESSAGE\n");
  const data = { workspace: { project_dir: root }, context_window: { used_percentage: 64 } };
  const rows = (columns) => strip(render(data, "", { COLUMNS: String(columns) })).split("\n");
  const head = `[ODYSSEY]  ${INF}  ctx ${withMark} 64%`;
  const hint = "wrap up: /odyssey:wrap-up";
  assert.deepEqual(rows(300), [`${head} · handoff waiting · ${hint}`]);
  const narrow = `[ODYSSEY]  ${INF}  ctx ${"█".repeat(4)}│${"█".repeat(6)} 64%`;
  assert.deepEqual(rows(47), [narrow, `handoff waiting · ${hint}`]);
  assert.deepEqual(rows(46), [narrow, "handoff waiting · wrap up now"]);
  assert.deepEqual(rows(40), [narrow, "handoff waiting · wrap up now"]);
  assert.deepEqual(rows(20), [narrow, "wrap up now"]);
  const calm = strip(render({ ...data, context_window: { used_percentage: 10 } }, "", { COLUMNS: "30" })).split("\n");
  assert.equal(calm[1], "handoff waiting", "no hint: the handoff's tag stays");
  const both = render(data, "", { COLUMNS: "46" });
  assert.ok(both.includes(`${GOLD}handoff waiting`) && both.includes(`${GOLD}wrap up now`), "both stay gold");
});

test("a status line kept in front keeps its upper lines above the bar and shares row 1 with its last line, or gives that line a row of its own when it leaves the bar no room; before Claude's first reply there is no limits row", () => {
  const data = { context_window: { used_percentage: 42 }, model: { display_name: "Opus 5.5" }, effort: { level: "max" }, cost: { total_cost_usd: 1.84 } };
  const row = `main · 3 files  [ODYSSEY]  ${INF}  ctx ${withMark} 42%  Opus 5.5 · max  ≈ $1.84 est.`;
  const top = "x".repeat(120);
  assert.deepEqual(strip(render(data, `${top}\nmain · 3 files`, { COLUMNS: String(width(row) + 4) })).split("\n"), [top, row]);
  const long = "y".repeat(60);
  const alone = strip(render({ context_window: { used_percentage: 42 } }, long, { COLUMNS: "80" })).split("\n");
  assert.deepEqual(alone, [long, `[ODYSSEY]  ${INF}  ctx ${withMark} 42%`], "a 60-cell line in an 80-column terminal: a row of its own");
  assert.ok(alone.every((r) => width(r) <= 76), "each row within its room");
  const ultra = "\x1b[38;5;173m[PONYTAIL:ULTRA]\x1b[0m";
  const narrow = `[ODYSSEY]  ${INF}  ctx ${"█".repeat(4)}│${"█".repeat(6)} 42%`;
  assert.deepEqual(strip(render({ context_window: { used_percentage: 42 } }, ultra, { COLUMNS: "56" })).split("\n"), [`[PONYTAIL:ULTRA]  ${narrow}`], "it shares row 1 while both fit");
  assert.deepEqual(strip(render({ context_window: { used_percentage: 42 } }, ultra, { COLUMNS: "55" })).split("\n"), ["[PONYTAIL:ULTRA]", `[ODYSSEY]  ${INF}  ctx ${withMark} 42%`], "one column less: a row of its own");
});

test("a helper agent's row: its name, its task, its model, its effort when set, and its context; other tasks keep Claude Code's row", () => {
  assert.equal(modelName("claude-opus-5-5"), "Opus 5.5");
  assert.equal(modelName("claude-fable-5-1"), "Fable 5.1");
  assert.equal(modelName("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(modelName("claude-opus-4-20250514"), "Opus 4");
  assert.equal(modelName("us.anthropic.claude-sonnet-5-v1:0"), "Sonnet 5");
  assert.equal(modelName("custom-model"), "custom-model");
  const agent = { id: "a1", type: "local_agent", description: "Draft order 10", label: "Draft order 10", model: "claude-opus-5-5", contextWindowSize: 1000000, tokenCount: 310000 };
  assert.equal(strip(row(agent, NOENV).content), `Draft order 10 · Opus 5.5 · ctx ${"█".repeat(10)} 31%`);
  assert.equal(row(agent, NOENV).id, "a1");
  assert.ok(row(agent, NOENV).content.includes(CYAN) && !row(agent, NOENV).content.includes(GOLD));
  const named = row({ ...agent, name: "reviewer", effort: "high", tokenCount: 700000 }, NOENV);
  assert.equal(strip(named.content), `reviewer · Draft order 10 · Opus 5.5 · high · ctx ${"█".repeat(10)} 70%`);
  assert.ok(named.content.includes(GOLD), "gold from the wrap-up mark");
  assert.equal(strip(row({ ...agent, contextWindowSize: undefined }, NOENV).content), "Draft order 10 · Opus 5.5", "no window size, no bar");
  assert.equal(row({ id: "b2", type: "local_bash", description: "npm test" }, NOENV), null);
});

test("run as a command, the bar prints the row, or one JSON line per helper agent", () => {
  const run = (data) => spawnSync(process.execPath, [BAR], { input: JSON.stringify(data), env: { PATH: process.env.PATH }, encoding: "utf8" });
  const main = run({ context_window: { used_percentage: 5 } });
  assert.equal(main.status, 0);
  assert.equal(strip(main.stdout), `[ODYSSEY]  ${INF}  ctx ${withMark} 5%`);
  const rows = run({ columns: 100, tasks: [{ id: "x", model: "claude-opus-5-5", description: "Review", contextWindowSize: 100, tokenCount: 50 }, { id: "y" }] });
  const lines = rows.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.id), ["x"]);
  assert.equal(strip(lines[0].content), `Review · Opus 5.5 · ctx ${"█".repeat(10)} 50%`);
  assert.equal(run("not json").status, 0, "a payload it can't read draws an empty bar");
});

test("the status line kept in front runs in the shell Claude Code uses for status lines, Git Bash on Windows", () => {
  const at = path.join(scratch, "prev");
  mkdirSync(at);
  const copy = path.join(at, "odyssey-statusline.mjs");
  writeFileSync(copy, readFileSync(BAR));
  // POSIX shell arithmetic: cmd.exe, Node's default shell on Windows, would print it as written.
  writeFileSync(path.join(at, "odyssey-statusline.prev"), `printf '%s' "PREV-$((40+2))"\n`);
  // Git Bash's first start on a fresh Windows runner can take longer than the bar's 5 seconds;
  // one run first, so the bar's own run meets it warm, as it does from its second draw on.
  spawnSync("exit 0", { shell: shellFor() });
  const result = spawnSync(process.execPath, [copy], { input: "{}", env: process.env, encoding: "utf8" });
  assert.ok(strip(result.stdout).startsWith(`PREV-42  [ODYSSEY]  ${INF}`), result.stdout);
  assert.equal(shellFor({}, "darwin"), true, "the system shell off Windows");
  assert.equal(shellFor({}, "linux"), true);
});

test("the bar leaves the context percent for the Stop hook before it runs a slow status line kept in front", async () => {
  if (process.platform === "win32") return; // a POSIX shell feature; CI counts a skipped test as a failure
  const at = path.join(scratch, "slow-prev");
  mkdirSync(at);
  const copy = path.join(at, "odyssey-statusline.mjs");
  writeFileSync(copy, readFileSync(BAR));
  writeFileSync(path.join(at, "odyssey-statusline.prev"), "sleep 3\n");
  const base = path.join(at, "repo");
  const child = spawn(process.execPath, [copy], { env: { ...process.env, ODYSSEY_LAUNCH: base }, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify({ session_id: "s1", context_window: { used_percentage: 61 } }));
  const ended = new Promise((resolve) => child.on("exit", resolve));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const early = existsSync(`${base}.ctx`);
  await ended;
  assert.ok(early, "written while the previous status line still runs");
  assert.equal(readFileSync(`${base}.ctx`, "utf8"), "s1 61\n");
});

test("bar install copies the bar, names it for both rows, keeps a status line already set in front, and saves the settings first", () => {
  const at = home({ statusLine: { type: "command", command: 'bash "/x/ponytail-statusline.sh"' }, theme: "dark" });
  const before = readFileSync(path.join(at, ".claude", "settings.json"));
  assert.equal(odyssey(at, "bar", "status").stdout, "Status bar: off.\n");
  const first = odyssey(at, "bar", "install");
  assert.equal(first.status, 0);
  const bar = path.join(at, ".claude", "odyssey-statusline.mjs");
  const file = path.join(at, ".claude", "settings.json");
  assert.equal(
    first.stdout,
    [
      `Status bar: on. ${file} now runs ${bar} for the status line and for each helper agent's row.`,
      'Your previous status line runs in front of it: bash "/x/ponytail-statusline.sh".',
      `Saved your settings as they were to ${file}.before-odyssey.`,
      "",
    ].join("\n"),
  );
  assert.ok(readFileSync(bar).equals(readFileSync(BAR)), "the kit's script, byte for byte");
  assert.equal(readFileSync(path.join(at, ".claude", "odyssey-statusline.prev"), "utf8"), 'bash "/x/ponytail-statusline.sh"\n');
  assert.ok(readFileSync(`${file}.before-odyssey`).equals(before), "the settings as they were");
  const settings = settingsOf(at);
  const command = `node "${bar.split(path.sep).join("/")}"`;
  assert.deepEqual(settings.statusLine, { type: "command", command });
  assert.deepEqual(settings.subagentStatusLine, { type: "command", command });
  assert.equal(settings.theme, "dark", "everything else kept");
  assert.equal(odyssey(at, "bar", "status").stdout, "Status bar: on.\n");
  assert.equal(odyssey(at, "bar", "install").stdout, "Status bar: already on, and its script matches this kit version's.\n");
  writeFileSync(bar, "// an older bar\n");
  assert.equal(odyssey(at, "bar", "status").stdout, "Status bar: on; its script differs from this kit version's.\n");
  assert.equal(odyssey(at, "bar", "install").stdout, `Status bar: already on; replaced ${bar} with this kit version's.\n`);
  assert.ok(readFileSync(bar).equals(readFileSync(BAR)));
  assert.ok(readFileSync(`${file}.before-odyssey`).equals(before), "the first copy is never overwritten");
});

test("bar install on no settings at all, beside a user's own helper-agent rows, and never on a file that isn't JSON", () => {
  const fresh = home();
  const file = path.join(fresh, ".claude", "settings.json");
  const out = odyssey(fresh, "bar", "install").stdout;
  assert.match(out, /^Status bar: on\. .* for the status line and for each helper agent's row\.\n$/);
  assert.ok(!existsSync(`${file}.before-odyssey`), "nothing to save");
  assert.equal(readFileSync(path.join(fresh, ".claude", "odyssey-statusline.prev"), "utf8"), "", "no status line before");
  const own = home({ subagentStatusLine: { type: "command", command: "my-rows" } });
  const kept = odyssey(own, "bar", "install").stdout.split("\n");
  assert.match(kept[0], / for the status line\.$/);
  assert.equal(kept[1], "Your own subagentStatusLine is kept, so the helper-agent rows keep its look.");
  assert.deepEqual(settingsOf(own).subagentStatusLine, { type: "command", command: "my-rows" });
  const broken = home("{ not json");
  const result = odyssey(broken, "bar", "install");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^Status bar: not added\. .* isn't valid JSON, so it was left as it is; fix it, then run \/odyssey:setup again\.\n$/);
  assert.equal(readFileSync(path.join(broken, ".claude", "settings.json"), "utf8"), "{ not json", "left byte for byte");
  assert.ok(!existsSync(path.join(broken, ".claude", "odyssey-statusline.mjs")));
});

test("bar remove puts back the status line kept in front and deletes the bar's files; tips remove takes out only the kit's tips", () => {
  const at = home({ statusLine: { type: "command", command: "my-line" }, spinnerTipsOverride: { tips: ["Run the linter"] } });
  const file = path.join(at, ".claude", "settings.json");
  odyssey(at, "bar", "install");
  odyssey(at, "tips", "install");
  const bar = odyssey(at, "bar", "remove");
  assert.equal(bar.status, 0, bar.stdout + bar.stderr);
  assert.equal(bar.stdout, `Status bar: removed from ${file}; your previous status line is back: my-line.\n`);
  assert.deepEqual(settingsOf(at).statusLine, { type: "command", command: "my-line" });
  assert.equal(settingsOf(at).subagentStatusLine, undefined);
  assert.ok(!existsSync(path.join(at, ".claude", "odyssey-statusline.mjs")) && !existsSync(path.join(at, ".claude", "odyssey-statusline.prev")));
  assert.equal(odyssey(at, "bar", "remove").stdout, "Status bar: already off.\n");
  assert.equal(odyssey(at, "tips", "remove").stdout, `Spinner tips: removed the kit's tips from ${file}.\n`);
  assert.deepEqual(settingsOf(at).spinnerTipsOverride, { tips: ["Run the linter"] });
  const alone = home();
  odyssey(alone, "bar", "install");
  odyssey(alone, "tips", "install");
  odyssey(alone, "bar", "remove");
  odyssey(alone, "tips", "remove");
  assert.deepEqual(settingsOf(alone), {}, "nothing of the kit's left");
});

test("tips install adds the kit's tips beside the user's own, naming only kit skills that exist, and brings them up to date", () => {
  const at = home({ spinnerTipsOverride: { label: "Team tip", tips: ["Run the linter", { id: "mine", text: "Mine" }] } });
  const file = path.join(at, ".claude", "settings.json");
  assert.equal(odyssey(at, "tips", "status").stdout, "Spinner tips: off.\n");
  assert.equal(
    odyssey(at, "tips", "install").stdout,
    `Spinner tips: added the kit's tips to ${file}.\nSaved your settings as they were to ${file}.before-odyssey.\n`,
  );
  const override = settingsOf(at).spinnerTipsOverride;
  assert.equal(override.label, "Team tip", "other fields kept");
  assert.deepEqual(override.tips.slice(0, 2), ["Run the linter", { id: "mine", text: "Mine" }]);
  const ours = override.tips.slice(2);
  assert.deepEqual(ours.map((tip) => tip.id), [
    "odyssey-wrap-up", "odyssey-heal-me", "odyssey-status",
    "odyssey-cr-triage", "odyssey-create-directive", "odyssey-secrets-guard",
  ]);
  const skills = new Set(readdirSync(path.join(PLUGIN, "skills")));
  for (const tip of ours) {
    assert.ok(tip.text.length <= 500, `${tip.id}: one line Claude Code takes whole`);
    for (const [, name] of tip.text.matchAll(/\/odyssey:([a-z-]+)/g)) assert.ok(skills.has(name), `${tip.id} names /odyssey:${name}`);
  }
  assert.equal(odyssey(at, "tips", "status").stdout, "Spinner tips: on.\n");
  assert.equal(odyssey(at, "tips", "install").stdout, "Spinner tips: already on.\n");
  const settings = settingsOf(at);
  settings.spinnerTipsOverride.tips[2].text = "An older tip";
  writeFileSync(file, JSON.stringify(settings));
  assert.equal(odyssey(at, "tips", "install").stdout, "Spinner tips: updated the kit's tips to this kit version's.\n");
  assert.deepEqual(settingsOf(at).spinnerTipsOverride.tips.slice(2), ours);
  const odd = home({ spinnerTipsOverride: "tips" });
  const refused = odyssey(odd, "tips", "install");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /^Spinner tips: not added\. spinnerTipsOverride in .* isn't the object Claude Code documents, so it was left as it is\.\n$/);
});

test("bar install on a bar already on says when it adds the helper-agent rows", () => {
  const at = home({});
  odyssey(at, "bar", "install");
  const file = path.join(at, ".claude", "settings.json");
  const bar = path.join(at, ".claude", "odyssey-statusline.mjs");
  const settings = settingsOf(at);
  delete settings.subagentStatusLine;
  writeFileSync(file, JSON.stringify(settings));
  assert.equal(
    odyssey(at, "bar", "install").stdout,
    [
      "Status bar: already on, and its script matches this kit version's.",
      `Helper-agent rows: added. ${file} now runs ${bar} for each helper agent's row too.`,
      "",
    ].join("\n"),
  );
  assert.deepEqual(settingsOf(at).subagentStatusLine, { type: "command", command: `node "${bar.split(path.sep).join("/")}"` });
  assert.equal(odyssey(at, "bar", "install").stdout, "Status bar: already on, and its script matches this kit version's.\n", "nothing to add twice");
});

test("doctor checks the bar only when the settings run it: in place and current, a copy that differs, or missing", () => {
  const repo = (at) => {
    mkdirSync(path.join(at, "repo", ".git"), { recursive: true });
    return path.join(at, "repo");
  };
  const doctor = (at) =>
    spawnSync(process.execPath, [SCRIPT, "doctor"], { cwd: repo(at), env: { ...process.env, HOME: at, USERPROFILE: at, CLAUDE_PROJECT_DIR: repo(at) }, encoding: "utf8" });
  const none = home({});
  assert.doesNotMatch(doctor(none).stdout, /status bar/, "no bar, no line");
  const at = home({});
  odyssey(at, "bar", "install");
  const bar = path.join(at, ".claude", "odyssey-statusline.mjs");
  assert.match(doctor(at).stdout, new RegExp(`^PASS the status bar runs ${bar.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}, and it matches this kit version's script$`, "m"));
  writeFileSync(bar, "// an older bar\n");
  const differs = doctor(at);
  assert.match(differs.stdout, /^PASS the status bar runs .*, a copy that differs from this kit version's; \/odyssey:setup replaces it$/m);
  assert.equal(differs.status, 0);
  rmSync(bar);
  const missing = doctor(at);
  assert.match(missing.stdout, /^FAIL the status bar runs .*, but the file is missing; \/odyssey:setup puts it back$/m);
  assert.equal(missing.status, 1);
});

test("the Odyssey theme ships byte for byte as ruled: a dark theme named Odyssey", () => {
  const file = path.join(PLUGIN, "themes", "odyssey.json");
  assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), "c4a5205266f52e1d897c61892772f670081cbba2f1b5eb81e20599b35a206d04");
  const theme = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(theme.name, "Odyssey");
  assert.equal(theme.base, "dark");
  assert.equal(theme.overrides.error, "#ff5c8a");
  assert.equal(theme.overrides.subtle, "#3d5270");
});

// Peek: `mod` runs with CLAUDE_CODE_PLUGIN_DIRS empty in its environment unless a test sets it.
const PEEK = path.join(PLUGIN, "mods", "peek");
const GUARD = path.join(PLUGIN, "hooks", "protect-env.mjs");
const mod = (at, env, ...args) =>
  spawnSync(process.execPath, [SCRIPT, "mod", ...args], {
    cwd: at,
    env: { ...process.env, HOME: at, USERPROFILE: at, CLAUDE_CODE_PLUGIN_DIRS: "", ...env },
    encoding: "utf8",
  });
const filesOf = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();

test("mod install peek copies peek with the secrets guard beside it, adds its folder to the settings' plugin folders after the ones there, and saves the settings first", () => {
  const other = path.join(scratch, "my-mod");
  const at = home({ env: { CLAUDE_CODE_PLUGIN_DIRS: other, ODYSSEY_WRAPUP_PCT: "60" }, theme: "dark" });
  const file = path.join(at, ".claude", "settings.json");
  const before = readFileSync(file);
  const peek = path.join(at, ".claude", "odyssey-peek");
  assert.equal(mod(at, {}, "status", "peek").stdout, "Peek: off.\n");
  const first = mod(at, {}, "install", "peek");
  assert.equal(first.status, 0);
  assert.equal(
    first.stdout,
    [
      `Peek: on. Copied it to ${peek} with the kit's secret-file patterns, and ${file} now names that folder in CLAUDE_CODE_PLUGIN_DIRS, so Claude Code sessions started from now on load it; type /peek in one.`,
      `Saved your settings as they were to ${file}.before-odyssey.`,
      "",
    ].join("\n"),
  );
  assert.ok(readFileSync(`${file}.before-odyssey`).equals(before), "the settings as they were");
  const settings = settingsOf(at);
  assert.deepEqual(settings.env, { CLAUDE_CODE_PLUGIN_DIRS: [other, peek].join(path.delimiter), ODYSSEY_WRAPUP_PCT: "60" });
  assert.equal(settings.theme, "dark", "everything else kept");
  assert.deepEqual(filesOf(peek), [...filesOf(PEEK), "protect-env.mjs"].sort());
  for (const name of filesOf(PEEK)) assert.ok(readFileSync(path.join(peek, name)).equals(readFileSync(path.join(PEEK, name))), name);
  assert.ok(readFileSync(path.join(peek, "protect-env.mjs")).equals(readFileSync(GUARD)), "the guard peek reads its patterns from");
  assert.equal(mod(at, {}, "status", "peek").stdout, "Peek: on.\n");
  assert.equal(mod(at, {}, "install", "peek").stdout, "Peek: already on, and its copy matches this kit version's.\n");
  // The types Claude Code writes into a mod's folder when it loads it leave the copy current.
  mkdirSync(path.join(peek, ".claude-plugin", "types"), { recursive: true });
  writeFileSync(path.join(peek, ".claude-plugin", "types", "index.d.ts"), "");
  assert.equal(mod(at, {}, "status", "peek").stdout, "Peek: on.\n");
  for (const [change, undo] of [
    [() => writeFileSync(path.join(peek, "protect-env.mjs"), "// an older guard\n"), () => readFileSync(path.join(peek, "protect-env.mjs")).equals(readFileSync(GUARD))],
    [() => writeFileSync(path.join(peek, "hooks", "old.ts"), ""), () => !existsSync(path.join(peek, "hooks", "old.ts"))],
  ]) {
    change();
    assert.equal(mod(at, {}, "status", "peek").stdout, "Peek: on; its copy differs from this kit version's.\n");
    assert.equal(mod(at, {}, "install", "peek").stdout, `Peek: already on; replaced ${peek} with this kit version's, for sessions started from now on.\n`);
    assert.ok(undo(), "this kit version's copy, and nothing else");
  }
  assert.equal(settingsOf(at).env.CLAUDE_CODE_PLUGIN_DIRS, [other, peek].join(path.delimiter), "named once");
  assert.ok(readFileSync(`${file}.before-odyssey`).equals(before), "the first copy is never overwritten");
});

test("mod remove peek takes its folder out of the list, keeping the others, and deletes it; mod never edits settings that aren't JSON or a list that isn't one line", () => {
  const other = path.join(scratch, "my-mod");
  const at = home({ env: { CLAUDE_CODE_PLUGIN_DIRS: other } });
  const file = path.join(at, ".claude", "settings.json");
  const peek = path.join(at, ".claude", "odyssey-peek");
  mod(at, {}, "install", "peek");
  assert.equal(
    mod(at, {}, "remove", "peek").stdout,
    `Peek: off. Took ${peek} out of CLAUDE_CODE_PLUGIN_DIRS in ${file} and deleted ${peek}; Claude Code sessions started from now on start without it.\n`,
  );
  assert.deepEqual(settingsOf(at).env, { CLAUDE_CODE_PLUGIN_DIRS: other });
  assert.ok(!existsSync(peek));
  assert.equal(mod(at, {}, "status", "peek").stdout, "Peek: off.\n");
  assert.equal(mod(at, {}, "remove", "peek").stdout, "Peek: already off.\n");
  // The only folder in the list: the key goes with it.
  const alone = home({});
  mod(alone, {}, "install", "peek");
  mod(alone, {}, "remove", "peek");
  assert.deepEqual(settingsOf(alone), { env: {} });
  for (const [settings, verb, why] of [
    ["{ not json", "added", "isn't valid JSON, so it was left as it is; fix it, then run this again"],
    [{ env: { CLAUDE_CODE_PLUGIN_DIRS: ["/x"] } }, "added", "doesn't hold CLAUDE_CODE_PLUGIN_DIRS as one line of folders, so it was left as it is"],
    [{ env: "x" }, "removed", "doesn't hold CLAUDE_CODE_PLUGIN_DIRS as one line of folders, so it was left as it is"],
  ]) {
    const odd = home(settings);
    const before = readFileSync(path.join(odd, ".claude", "settings.json"));
    const result = mod(odd, {}, verb === "added" ? "install" : "remove", "peek");
    assert.equal(result.status, 1);
    assert.ok(result.stdout.startsWith(`Peek: not ${verb}. `) && result.stdout.endsWith(`${why}.\n`), result.stdout);
    assert.ok(readFileSync(path.join(odd, ".claude", "settings.json")).equals(before), "left byte for byte");
    assert.ok(!existsSync(path.join(odd, ".claude", "odyssey-peek")));
  }
});

test("mod install peek says which folders a list set only in its environment names, since the settings' list takes its place", () => {
  const at = home({});
  const outside = [path.join(scratch, "a"), path.join(scratch, "b")];
  const lines = mod(at, { CLAUDE_CODE_PLUGIN_DIRS: outside.join(path.delimiter) }, "install", "peek").stdout.split("\n");
  assert.equal(
    lines[1],
    `Your environment also sets CLAUDE_CODE_PLUGIN_DIRS, to ${outside.join(", ")}. The list in your settings now takes its place, so add those folders to it to keep them.`,
  );
  assert.equal(settingsOf(at).env.CLAUDE_CODE_PLUGIN_DIRS, path.join(at, ".claude", "odyssey-peek"), "only peek's: the folders are named, not copied");
});

test("doctor checks peek only when the settings load it: in place and current, a copy that differs, or missing", () => {
  const doctor = (at) => {
    mkdirSync(path.join(at, "repo", ".git"), { recursive: true });
    const repo = path.join(at, "repo");
    return spawnSync(process.execPath, [SCRIPT, "doctor"], { cwd: repo, env: { ...process.env, HOME: at, USERPROFILE: at, CLAUDE_PROJECT_DIR: repo }, encoding: "utf8" });
  };
  assert.doesNotMatch(doctor(home({})).stdout, /peek/, "no peek, no line");
  const at = home({});
  mod(at, {}, "install", "peek");
  const peek = path.join(at, ".claude", "odyssey-peek");
  const line = (rest) => new RegExp(`^${rest.replace("PEEK", peek).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&").replace("ANY", ".*")}$`, "m");
  assert.match(doctor(at).stdout, line("PASS your settings load peek from PEEK, and it matches this kit version's"));
  writeFileSync(path.join(peek, "protect-env.mjs"), "// an older guard\n");
  const differs = doctor(at);
  assert.match(differs.stdout, line("FAIL your settings load peek from PEEK, a copy that differs from this kit version's, so its secret-file patterns may be older; /odyssey:setup replaces it"));
  assert.equal(differs.status, 1);
  rmSync(peek, { recursive: true });
  assert.match(doctor(at).stdout, line("FAIL your settings load peek from PEEK, but the folder is missing; /odyssey:setup puts it back"));
});

test("peek's tests read the secrets guard's own patterns: the list and the template in their stand-in are the guard's, line for line", () => {
  const world = readFileSync(path.join(PEEK, "tests", "world.ts"), "utf8");
  const standIn = /export const GUARD = `([\s\S]*?)`/.exec(world)?.[1].replaceAll("\\\\", "\\");
  const guard = readFileSync(GUARD, "utf8");
  const list = /const DEFAULT_SECRETS = \[[\s\S]*?\];/.exec(guard)?.[0];
  const template = /^const TEMPLATE = .*;$/m.exec(guard)?.[0];
  assert.ok(list && template, "the guard declares both as peek parses them");
  assert.ok(standIn?.includes(list), "the list");
  assert.ok(standIn?.includes(template), "the template");
});

test("mod install wrap-up copies the wrap-up mod alone, and status, doctor and remove treat it as they treat peek", () => {
  const at = home({});
  const dir = path.join(at, ".claude", "odyssey-wrap-up");
  assert.equal(mod(at, {}, "status", "wrap-up").stdout, "Wrap-up: off.\n");
  const first = mod(at, {}, "install", "wrap-up");
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /^Wrap-up: on\. Copied it to .*odyssey-wrap-up, and .*settings\.json now names that folder in CLAUDE_CODE_PLUGIN_DIRS, so Claude Code sessions started from now on load it; its band shows once a session passes the wrap-up mark\.$/m);
  assert.deepEqual(filesOf(dir), filesOf(path.join(PLUGIN, "mods", "wrap-up")), "the mod's own files, and no guard beside them");
  assert.equal(settingsOf(at).env.CLAUDE_CODE_PLUGIN_DIRS, dir);
  assert.equal(mod(at, {}, "status", "wrap-up").stdout, "Wrap-up: on.\n");
  mkdirSync(path.join(at, "repo", ".git"), { recursive: true });
  const repo = path.join(at, "repo");
  const doctor = () => spawnSync(process.execPath, [SCRIPT, "doctor"], { cwd: repo, env: { ...process.env, HOME: at, USERPROFILE: at, CLAUDE_PROJECT_DIR: repo }, encoding: "utf8" }).stdout;
  assert.ok(doctor().includes(`PASS your settings load wrap-up from ${dir}, and it matches this kit version's\n`));
  assert.doesNotMatch(doctor(), /load peek/);
  const removed = mod(at, {}, "remove", "wrap-up");
  assert.match(removed.stdout, /^Wrap-up: off\. Took .* out of CLAUDE_CODE_PLUGIN_DIRS/m);
  assert.ok(!existsSync(dir));
  assert.equal(settingsOf(at).env.CLAUDE_CODE_PLUGIN_DIRS, undefined);
});
