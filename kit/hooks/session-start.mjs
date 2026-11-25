// SessionStart: tells Claude, before its first turn, what the files on disk say about the
// session it is starting. After a compaction, that a summary replaced the earlier turns
// (`/odyssey:what-next` reads it as a cue to write the handoff). On every start,
// resume, clear or compaction, whether the handoff holds a message, without reading it to
// Claude: the handoff is read only when the user runs /odyssey:handoff, and nothing it says
// reaches Claude from here.
//
// Each fact is one plain line for Claude, stated as a fact, in the JSON output's
// `additionalContext`. The waiting handoff also goes to the user, in
// `systemMessage`, since nothing this hook tells Claude reaches the screen; not after a
// compaction, where the line would repeat in the middle of the work. Nothing to say, nothing
// printed. Each fact fails open on its own: one that can't be read is left out, never worth a
// failed start.
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "../lib/config.mjs";
import { HANDOFF, slotState } from "../lib/handoff.mjs";

let source;
try {
  ({ source } = JSON.parse(readFileSync(0, "utf8")));
} catch {
  // No payload: only the handoff is reported.
}
let root = null;
try {
  ({ root } = resolveConfig());
} catch {
  // The start folder can't be read, such as a worktree removed: nothing on disk to report.
}
const held = (file) => root !== null && slotState(path.join(root, file)) === "held";

const handoff = held(HANDOFF);
const lines = [];
if (source === "compact") lines.push("Odyssey: this session was compacted: a summary replaced its earlier turns.");
if (handoff) lines.push(`Odyssey: a handoff message is waiting in ${HANDOFF}; /odyssey:handoff reads it.`);
const shown = [];
if (handoff) shown.push("a handoff message is waiting; run /odyssey:handoff to read it.");
if (lines.length) {
  const out = { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } };
  if (shown.length && source !== "compact") out.systemMessage = `Odyssey: ${shown.join(" ")}`;
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
