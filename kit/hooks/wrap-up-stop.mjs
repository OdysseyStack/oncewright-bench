// Stop hook for sessions the launcher started (scripts/launch.mjs sets ODYSSEY_LAUNCH to the base
// of its flag files); in any other session it does nothing.
// - After /odyssey:wrap-up's last step left <base>.quit: rename it to <base>.restart, so the
//   launcher ends this session and starts the next with /odyssey:handoff. While Claude Code's
//   background_tasks lists work the relaunch would kill, the flag stays, marked held, and the
//   user is told what holds it. A flag older than 15 minutes that no stop held is from a wrap-up
//   cut off before its turn ended (Esc, an API error): it is dropped.
// - Past the wrap-up mark (the status bar writes "<session id> <percent>" to <base>.ctx): block
//   the stop, telling Claude to run wrap-up. Never twice in a row: a stop a Stop hook already
//   blocked passes, so it can't loop.
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { markOf } from "../scripts/statusline.mjs";

const PLUGIN = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKILL = path.join(PLUGIN, "skills", "wrap-up", "SKILL.md");
const FRESH_MS = 15 * 60 * 1000;
const HOLDS = new Set(["subagent", "workflow", "teammate", "shell"]);

export function decide(data, env) {
  const base = env.ODYSSEY_LAUNCH;
  if (!base) return null;
  const quit = `${base}.quit`;
  if (existsSync(quit)) {
    if (readFileSync(quit, "utf8").startsWith("held") || Date.now() - statSync(quit).mtimeMs < FRESH_MS) {
      const busy = (data.background_tasks ?? []).filter((task) => HOLDS.has(task?.type));
      if (!busy.length) {
        renameSync(quit, `${base}.restart`);
        return null;
      }
      writeFileSync(quit, "held\n");
      const names = busy.map((task) => String(task.description || task.agent_type || task.type).slice(0, 80));
      return { systemMessage: `Wrap-up is done; the next session starts once ${busy.length} background task(s) finish: ${names.join("; ")}.` };
    }
    rmSync(quit, { force: true });
  }
  if (data.stop_hook_active) return null;
  let sid, pct;
  try {
    [sid, pct] = readFileSync(`${base}.ctx`, "utf8").trim().split(/\s+/);
  } catch {
    return null; // no status bar: the mark is unknown, and wrap-up waits to be asked for
  }
  const mark = markOf(env);
  if (sid !== data.session_id || !(Number(pct) >= mark)) return null;
  return {
    decision: "block",
    reason:
      `Context is at ${Math.round(Number(pct))}%, past the ${mark}% wrap-up mark, and the launcher will start the ` +
      `next session. Run /odyssey:wrap-up now: read ${SKILL} and follow it.`,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const out = decide(JSON.parse(readFileSync(0, "utf8")), process.env);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`wrap-up-stop: ${err.message}\n`); // a broken hook never traps the session
  }
}
