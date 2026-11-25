#!/usr/bin/env node
// The Odyssey status bar. /odyssey:setup copies this file to ~/.claude/odyssey-statusline.mjs and
// names it in two user settings: `statusLine`, for which it prints up to three rows, and
// `subagentStatusLine`, for which it prints one JSON line per helper agent's row. Claude Code
// passes each its JSON on stdin.
//
// Row 1: the status line that ran before (its command in odyssey-statusline.prev beside this
// file; ponytail's default [PONYTAIL] badge gives way to [ODYSSEY], its other badges stay), then
// [ODYSSEY], the infinity emoji, the context bar with its wrap-up mark, the model and effort, and
// the session's cost (plan or API, said plainly). The messages (a handoff waiting, the wrap-up
// hint) end row 1 when they fit there whole, and take a row of their own
// when they don't. The last row holds the usage limits Claude Code sends: the plan's five-hour
// and weekly windows, or a gateway's spend limit. One solid fill, the logo's cyan, gold past a
// mark. No animation: Claude Code redraws a status line on events, or on a timer of a second or
// more, so motion shows as jumps. Self-contained, since the copy in ~/.claude can't reach lib/.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CELLS = 20; // the bars on the bar's own rows
const ROW_CELLS = 10; // a helper agent's bar, and a limit's bar on a narrow terminal
const LIMIT_WARM = 80; // a limit's bar turns gold from here
export const markOf = (env = process.env) => {
  const pct = Number(env.ODYSSEY_WRAPUP_PCT);
  return pct > 0 && pct <= 100 ? pct : 35; // past it, /odyssey:wrap-up
};

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const CYAN = hex("#0bc5fd"); // the infinity logo's main color
const GOLD = hex("#f4b860");
const TRACK = hex("#14243a");
const WHITE = hex("#f4f1e8");
const RESET = "\x1b[0m";
const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// One solid fill: the logo's cyan, or gold from `warm` on. `mark` draws a │ before that cell.
// The figure stops at `cap`; the fill at 100.
const bar = (label, pct, { cells = CELLS, warm = 0, mark = false, cap = 100 } = {}) => {
  if (pct == null || Number.isNaN(Number(pct))) return "";
  const shown = Math.max(0, Math.min(cap, Math.round(Number(pct))));
  const p = Math.min(100, shown);
  const full = Math.round((p / 100) * cells);
  const at = mark ? Math.round((warm / 100) * cells) : -1;
  const fill = fg(warm && p >= warm ? GOLD : CYAN);
  let out = `${label} `;
  for (let i = 0; i < cells; i++) {
    if (i === at) out += `${fg(WHITE)}│`;
    out += i < full ? `${fill}█` : `${fg(TRACK)}█`;
  }
  return `${out}${RESET} ${shown}%`;
};

// What the session costs, and whose money it is. rate_limits reaches the status line only for
// claude.ai Pro and Max plans, so its presence means the plan covers it and the figure is what the
// same work would cost at API prices; an API key or a cloud provider means real, billed spend.
// Claude Code's figure is an estimate at list price either way, hence the ≈. `short` is the form
// a narrow terminal gets.
const API_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
export const costLabel = (data, env = process.env, short = false) => {
  const usd = Number(data?.cost?.total_cost_usd);
  if (data?.cost?.total_cost_usd == null || !Number.isFinite(usd)) return "";
  const amount = `≈ $${usd.toFixed(2)}`;
  if (data?.rate_limits?.five_hour || data?.rate_limits?.seven_day) return `plan ${amount}${short ? "" : " at API rates"}`;
  if (API_ENV.some((k) => env[k])) return `${fg(GOLD)}API ${amount}${short ? "" : " billed"}${RESET}`;
  return `${amount} est.`;
};

// When a limit's window starts again, in this computer's local time: the five-hour window as a
// time of day, the others with their day, or as a date a week or more out. A clock time stays
// true between redraws, which come on events, not every minute. Claude Code sends resets_at in
// Unix epoch seconds, redraws the bar when that time comes, and then drops the window.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function resetLabel(resetsAt, now = Date.now(), style = "day") {
  const at = Number(resetsAt) * 1000;
  if (!(at > 0)) return "";
  const d = new Date(at);
  const time = `${d.getHours() % 12 || 12}${d.getMinutes() ? `:${String(d.getMinutes()).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "am" : "pm"}`;
  if (style === "time") return `resets ${time}`;
  return at - now < 7 * 86400000 ? `resets ${DAYS[d.getDay()]} ${time}` : `resets ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// The usage limits Claude Code sends: the five-hour and weekly windows on Pro and Max plans, and
// behind a Claude apps gateway the spend limit, whose use can pass 100%. Any of them may be
// missing, and none comes before Claude's first reply in a session.
const LIMITS = [
  ["five_hour", "5h", "time"],
  ["seven_day", "1w", "day"],
  ["spend_limit", "spend", "day"],
];
const limitsOf = (data, now) =>
  LIMITS.flatMap(([key, label, style]) => {
    const used = data?.rate_limits?.[key]?.used_percentage;
    if (used == null || Number.isNaN(Number(used))) return [];
    return [{ label, used, reset: resetLabel(data.rate_limits[key].resets_at, now, style), cap: key === "spend_limit" ? Infinity : 100 }];
  });

const modelLabel = (data) => [data?.model?.display_name, data?.effort?.level].filter(Boolean).join(" · ");

// A slot holds a message once it has more than whitespace and HTML comments, the form every
// placeholder takes (lib/handoff.mjs's slotState, which this copy can't import).
const held = (file) => {
  try {
    return readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim() !== "";
  } catch {
    return false;
  }
};
export function tags(root) {
  if (!root) return [];
  return held(path.join(root, "directives", "handoff", "current.md")) ? [`${fg(GOLD)}handoff waiting${RESET}`] : [];
}

// [ODYSSEY] takes the place of ponytail's default badge; a changed level ([PONYTAIL:ULTRA]) stays.
const BADGE = `\x1b[1m${fg(CYAN)}[ODYSSEY]${RESET}`;
const PONYTAIL_DEFAULT = /(?:\x1b\[[0-9;]*m)*\[PONYTAIL\](?:\x1b\[0m)?/g;
const INFINITY = "\u267e\ufe0f "; // two cells wide; one extra space so it never crowds what follows
const GAP = "  "; // between the parts of a row
const SEP = " · "; // before the messages, and between them

// Cells a row takes in the terminal: a link's address (OSC 8) none, a combining mark or a
// variation selector none, an emoji or an East Asian wide character two, anything else one.
// ponytail: a range check, not the full Unicode width table; a rare character can be off by one.
const LINK = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const WIDE = /[\p{Extended_Pictographic}\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u;
export const width = (s) => {
  let cells = 0;
  for (const ch of strip(s.replace(LINK, ""))) {
    if (/[\p{M}\u200d\ufe00-\ufe0f]/u.test(ch)) continue;
    cells += WIDE.test(ch) ? 2 : 1;
  }
  return cells;
};

// Claude Code prints each line of the output as a row, and cuts a row short at its end when it
// runs past the room the footer leaves it: COLUMNS, the terminal's width, less two columns on
// each side (Claude Code 2.1.287).
// ponytail: the four columns are read from Claude Code's footer, not its docs; a notification it
// shows at the row's right end takes room this can't see.
const FOOTER = 4;

export function render(data, prev = "", env = process.env, now = Date.now()) {
  const mark = markOf(env);
  const ctx = data?.context_window?.used_percentage ?? 0;
  const columns = Number(env.COLUMNS);
  const fits = (row) => !(columns > 0) || width(row) <= columns - FOOTER;
  const fitted = (rows) => rows.find(fits) ?? rows.at(-1); // the fullest form that fits, else the barest
  const join = (parts) => parts.filter(Boolean).join(GAP);

  // A status line kept in front: its last line leads row 1, any lines above it print as they are,
  // and a last line that leaves the badge and the shortest context bar no room takes a row of its own.
  const above = prev.replace(PONYTAIL_DEFAULT, "").trim().split(/\r?\n/);
  let lead = above.pop();
  const head = (cells) => `${BADGE}${GAP}${INFINITY} ${bar("ctx", ctx, { cells, warm: mark, mark: true })}`;
  if (lead && !fits(join([lead, head(ROW_CELLS)]))) {
    above.push(lead);
    lead = "";
  }
  const model = modelLabel(data);
  const cost = costLabel(data, env);
  const short = costLabel(data, env, true);
  // Too wide: the short cost first, then no model, then a ten-cell bar, then no cost. The badge
  // and the context bar always stay.
  const row1 = fitted([
    join([lead, head(CELLS), model, cost]),
    join([lead, head(CELLS), model, short]),
    join([lead, head(CELLS), short]),
    join([lead, head(ROW_CELLS), short]),
    join([lead, head(ROW_CELLS)]),
  ]);

  // The messages end row 1 when they fit there whole, else take a row of their own, never one cut
  // in two: on a terminal too narrow for them all, the wrap-up hint shortens first, then the
  // handoff's tag goes.
  const root = data?.workspace?.project_dir ?? data?.cwd;
  const tagged = tags(root);
  // Only where setup made the handoff folder, which it has git ignore.
  const setUp = Boolean(root) && existsSync(path.join(root, "directives", "handoff"));
  const hint = (text) => (setUp && Number(ctx) >= mark ? [`${fg(GOLD)}${text}${RESET}`] : []);
  const full = [...tagged, ...hint("wrap up: /odyssey:wrap-up")];
  const rows = above.filter(Boolean);
  if (full.length && fits(row1 + SEP + full.join(SEP))) rows.push(row1 + SEP + full.join(SEP));
  else {
    rows.push(row1);
    const own = [full];
    for (let i = 0; i <= tagged.length; i++) own.push([...tagged.slice(i), ...hint("wrap up now")]);
    const said = fitted(own.filter((list) => list.length).map((list) => list.join(SEP)));
    if (said) rows.push(said);
  }

  // Too wide: the reset times go from the last window back, then the bars shrink to ten cells,
  // then only the first window stays.
  const limits = limitsOf(data, now);
  const limitRow = (shown, cells, resets) =>
    join(shown.map((w, i) => bar(w.label, w.used, { cells, warm: LIMIT_WARM, cap: w.cap }) + (i < resets && w.reset ? SEP + w.reset : "")));
  if (limits.length) {
    const forms = limits.map((_, i) => limitRow(limits, CELLS, limits.length - i));
    rows.push(fitted([...forms, limitRow(limits, CELLS, 0), limitRow(limits, ROW_CELLS, 0), limitRow(limits.slice(0, 1), ROW_CELLS, 0)]));
  }
  return rows.join("\n");
}

// A model ID as people say it: claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5.
export function modelName(id) {
  const m = String(id ?? "").match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : String(id ?? "");
}

// A helper agent's row: its name when it has one, what it was asked to do, its model, its effort
// when the agent or the call sets one, and how full its context is. A task with no model yet
// (a background shell, an agent still starting) keeps Claude Code's own row.
export function row(task, env = process.env) {
  if (!task?.model) return null;
  const pct = task.contextWindowSize > 0 ? ((task.tokenCount ?? 0) / task.contextWindowSize) * 100 : null;
  const content = [
    task.name,
    task.label || task.description,
    modelName(task.model),
    task.effort == null ? "" : String(task.effort),
    bar("ctx", pct, { cells: ROW_CELLS, warm: markOf(env) }),
  ]
    .filter(Boolean)
    .join(" · ");
  return { id: task.id, content };
}

// The status line that ran before runs in the shell Claude Code runs status lines in (statusline.md,
// Windows configuration): on Windows, Git Bash (CLAUDE_CODE_GIT_BASH_PATH, else the bash.exe of the
// Git on the PATH), or PowerShell without it; the system shell elsewhere.
export function shellFor(env = process.env, platform = process.platform) {
  if (platform !== "win32") return true;
  const named = env.CLAUDE_CODE_GIT_BASH_PATH;
  if (named && /^(bash|sh)(\.exe)?$/i.test(path.win32.basename(named)) && existsSync(named)) return named;
  const git = spawnSync("where", ["git"], { encoding: "utf8" }).stdout?.split(/\r?\n/)[0]?.trim();
  if (git) {
    const bash = path.win32.join(path.win32.dirname(path.win32.dirname(git)), "bin", "bash.exe");
    if (existsSync(bash)) return bash;
  }
  return "powershell.exe";
}

// In a session the launcher started, leave the context percent where its Stop hook reads it
// (scripts/launch.mjs, hooks/wrap-up-stop.mjs).
export function tap(data, env = process.env) {
  const pct = data?.context_window?.used_percentage;
  if (!env.ODYSSEY_LAUNCH || !data?.session_id || typeof pct !== "number") return;
  try {
    writeFileSync(`${env.ODYSSEY_LAUNCH}.ctx`, `${data.session_id} ${pct}\n`);
  } catch {
    // The bar draws either way.
  }
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const input = readFileSync(0, "utf8");
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // Not JSON: draw from nothing.
  }
  if (Array.isArray(data?.tasks)) {
    for (const task of data.tasks) {
      const out = row(task);
      if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
    }
  } else {
    tap(data); // first: the Stop hook reads it the moment the turn ends, and the line in front may be slow
    let prev = "";
    try {
      const cmd = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "odyssey-statusline.prev"), "utf8").trim();
      // 5 seconds, the limit Claude Code gives a helper-agent row's command: Git Bash can take
      // seconds to start on Windows.
      if (cmd) prev = spawnSync(cmd, { shell: shellFor(), input, encoding: "utf8", timeout: 5000 }).stdout ?? "";
    } catch {
      // No status line ran before this one.
    }
    process.stdout.write(render(data, prev));
  }
}
