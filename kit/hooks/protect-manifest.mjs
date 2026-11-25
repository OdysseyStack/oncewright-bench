#!/usr/bin/env node
// PreToolUse hook: block hand-edits to dependency manifests.
//
// A dependency change is an architectural decision, not an incidental edit:
// it changes the supply chain, the lockfile, and often the runtime contract.
// This hook makes it wait for the user's explicit approval instead of
// happening as a side effect. Lockfiles must only change as a byproduct of an
// approved install, never by hand.
//
// An authorized dependency change is applied outside Claude (or with this
// hook temporarily disabled).
// Exit code 2 signals "block" to Claude Code; the stderr text is shown back.
//
// Opt-in: it runs only when `hooks.protectManifest` is true in .claude/odyssey.json,
// where `protect.manifests` adds file names for other ecosystems ("pyproject.toml",
// "poetry.lock", "Cargo.toml", "go.mod"...) to the defaults below.
import path from "node:path";
import { hookInput } from "../lib/config.mjs";

const DEFAULT_MANIFESTS = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];

let input;
try {
  input = hookInput();
} catch {
  process.exit(0);
}
const { payload, config } = input;
if (config.hooks?.protectManifest !== true) process.exit(0);

const filePath = payload?.tool_input?.file_path;
if (!filePath) process.exit(0);

const base = path.basename(filePath).toLowerCase();
const MANIFESTS = new Set(
  [...DEFAULT_MANIFESTS, ...(config.protect?.manifests ?? [])].map((name) => name.toLowerCase()),
);

if (MANIFESTS.has(base)) {
  process.stderr.write(
    `Blocked: editing "${base}" is a dependency change and must not happen without the ` +
      `user's explicit approval. The manifest may also hold load-bearing pins and ` +
      `rationale comments that an unscoped edit can silently drop. If the user approves ` +
      `this, apply it outside Claude (or temporarily disable this hook). ` +
      `Never hand-edit a lockfile - let an approved install regenerate it.\n`,
  );
  process.exit(2);
}

process.exit(0);
