#!/usr/bin/env node
// The launcher. /odyssey:setup copies this file to ~/.claude/odyssey-launch.mjs and writes a command
// the user names (odyssey.mjs launcher install) that opens their repo and runs it. It runs Claude
// Code there, and each time /odyssey:wrap-up ends a session it starts the next one with
// /odyssey:handoff, so memory, the index and the handoff are taken care of between sessions. The
// first session opens with /odyssey:handoff too when a message or a timer waits, else plain.
//
// It shares three files, under ~/.claude/odyssey-launch/, with the kit's Stop hook
// (hooks/wrap-up-stop.mjs), named by ODYSSEY_LAUNCH, which it sets for the session. The name is
// the repo's path and this launcher's process id, so two launchers in one repo keep apart, and
// the files go when the launcher ends:
//   <base>.ctx      the status bar writes "<session id> <percent>" there, for the wrap-up mark;
//   <base>.quit     wrap-up's last step leaves it;
//   <base>.restart  the Stop hook renames .quit to this once that turn has ended; the launcher
//                   then ends the session and starts the next.
// Self-contained, since the copy in ~/.claude can't reach the kit's other files.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HANDOFF = "/odyssey:handoff";
const QUICK_MS = 5 * 60 * 1000; // a session that wraps up this soon likely started past the mark
const QUICK_RUNS = 3;
export const flagBase = (root, home = os.homedir()) =>
  path.join(home, ".claude", "odyssey-launch", root.replace(/[\\/:]+/g, "-").replace(/^-+/, ""));

// The handoff has work: a message (more than whitespace and HTML comments, the bar's held() test)
// or a timer entry (`## <id>`) in timers.md.
function waiting(root) {
  const read = (name) => {
    try {
      return readFileSync(path.join(root, "directives", "handoff", name), "utf8");
    } catch {
      return "";
    }
  };
  return read("current.md").replace(/<!--[\s\S]*?-->/g, "").trim() !== "" || /^## /m.test(read("timers.md"));
}

// One session: start claude, and end it a moment after the restart flag appears, so the turn that
// left it finishes printing. -> the exit code.
function session({ claude, prompt, root, env, base, pollMs, graceMs }) {
  return new Promise((resolve) => {
    // Windows runs claude through its .cmd shim, so the prompt goes as one quoted argument.
    const win = process.platform === "win32";
    const child = spawn(claude, prompt ? [win ? JSON.stringify(prompt) : prompt] : [], { cwd: root, stdio: "inherit", env, shell: win });
    let done = false;
    const poll = setInterval(() => {
      if (!existsSync(`${base}.restart`)) return;
      clearInterval(poll);
      // On Windows the child is the shell around claude, so end the whole tree.
      const stop = () => (win ? spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }) : child.kill("SIGTERM"));
      setTimeout(() => done || stop(), graceMs);
    }, pollMs);
    const end = (code) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      resolve(code);
    };
    child.on("exit", (code) => end(code ?? 0));
    child.on("error", (err) => {
      process.stderr.write(`Couldn't start ${claude}: ${err.message}\n`);
      end(127);
    });
  });
}

export async function launch({
  root,
  prompt = "",
  claude = "claude",
  env = process.env,
  home = os.homedir(),
  id = process.pid,
  pollMs = 1000,
  graceMs = 10000, // time for the session's other Stop hooks, which run beside wrap-up-stop
  log = (line) => process.stderr.write(`${line}\n`),
}) {
  const base = `${flagBase(root, home)}-${id}`;
  const clear = (ends) => ends.forEach((end) => rmSync(`${base}${end}`, { force: true }));
  mkdirSync(path.dirname(base), { recursive: true });
  let next = prompt || (waiting(root) ? HANDOFF : "");
  let quick = 0;
  try {
    for (let runs = 1; ; runs++) {
      clear([".quit", ".restart"]);
      const started = Date.now();
      const code = await session({ claude, prompt: next, root, env: { ...env, ODYSSEY_LAUNCH: base }, base, pollMs, graceMs });
      if (!existsSync(`${base}.restart`)) return { code, runs };
      rmSync(`${base}.restart`, { force: true });
      quick = Date.now() - started < QUICK_MS ? quick + 1 : 0;
      if (quick === QUICK_RUNS) {
        const pct = Number(env.ODYSSEY_WRAPUP_PCT); // statusline.mjs's markOf, which this copy can't import
        const mark = pct > 0 && pct <= 100 ? pct : 35;
        log(
          `Stopped: ${quick} sessions in a row wrapped up within 5 minutes of starting, likely because each started ` +
            `past the ${mark}% wrap-up mark (ODYSSEY_WRAPUP_PCT) or in a small context window. Raise the mark, or ` +
            "have the handoff ask for fewer reads, then run the launcher again.",
        );
        return { code, runs };
      }
      next = HANDOFF;
      log(`Wrap-up finished: starting the next session with ${HANDOFF}.`);
    }
  } finally {
    clear([".ctx", ".quit", ".restart"]);
  }
}

const isMain = (() => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

const args = process.argv.slice(2);
// Any argument, not only the first: `ma "fix" --model x` would fold the flag into the prompt.
const flag = args.find((arg) => arg.startsWith("-"));
if (isMain && flag) {
  process.stderr.write(
    `\`${flag}\` is claude's own flag, and the sessions after a wrap-up would start without it, so the launcher ` +
      "takes only a first prompt. To cover every session, set it in ~/.claude/settings.json (`permissions.defaultMode`, " +
      "`model`, `remoteControlAtStartup`), or export CLAUDE_CONFIG_DIR in your shell.\n",
  );
  process.exitCode = 2;
} else if (isMain) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout?.trim();
  // Ctrl+C belongs to Claude Code; the launcher stops when a session ends without wrap-up.
  process.on("SIGINT", () => {});
  const { code } = await launch({ root: top || process.cwd(), prompt: args.join(" ") });
  process.exitCode = code;
}
