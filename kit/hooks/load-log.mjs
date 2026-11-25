// InstructionsLoaded: with hooks.loadLog on, one line for each instruction file Claude Code loads
// (a CLAUDE.md, a rule, a file one of them imports), naming the file, the session and why it
// loaded, in the repo's load log under ~/.claude/odyssey-loads/. `odyssey.mjs docs check` sets
// the log beside the files that should load. Claude Code runs this event in the background and
// ignores its output and exit code, so the hook can't block or change a load, and it swallows
// every error of its own. It shows no notice either: one shown here would be dropped, and would
// use up the once-per-session notice the guards give for an invalid config.
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "../lib/config.mjs";
import { LOAD_LOG_CAP, loadLogFile } from "../lib/docs.mjs";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const { root, config } = resolveConfig();
  if (config.hooks?.loadLog === true) {
    const file = loadLogFile(root, os.homedir());
    const line = `${JSON.stringify({
      time: new Date().toISOString(),
      session: payload.session_id,
      file: payload.file_path,
      reason: payload.load_reason,
    })}\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      // No log yet.
    }
    // ponytail: past the cap the log starts over, losing the older sessions; keep a rolling
    // window if they ever matter.
    if (size > LOAD_LOG_CAP) writeFileSync(file, line);
    else appendFileSync(file, line);
  }
} catch {
  // A missing line in a log is never worth an error.
}
