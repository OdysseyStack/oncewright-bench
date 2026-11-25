// The handoff file and the kit's working files, shared by scripts/odyssey.mjs (setup, status),
// lib/threads.mjs and hooks/session-start.mjs.
import { readFileSync } from "node:fs";

export const HANDOFF = "directives/handoff/current.md";

// The kit's working files: the handoff and the review findings. /odyssey:setup has git ignore
// them, and the repo-state readers leave them out.
export const WORKING = ["directives/handoff/", "references/CR reviews/"];
export const isWorking = (file) => WORKING.some((dir) => file.startsWith(dir));

// A slot holds a message once it has more than whitespace and HTML comments, the form every
// placeholder takes. -> "missing" | "unreadable" | "empty" | "held"
export function slotState(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    return err.code === "ENOENT" ? "missing" : "unreadable";
  }
  return text.replace(/<!--[\s\S]*?-->/g, "").trim() ? "held" : "empty";
}
