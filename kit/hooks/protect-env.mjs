#!/usr/bin/env node
// PreToolUse hook: the secrets guard. It blocks writes to secret files through
// Edit/Write/MultiEdit/NotebookEdit, the MCP file tools, Bash and PowerShell, and keeps
// Claude's tools off the Odyssey trust file and its approve command.
//
// Secret files hold live credentials and are git-ignored. This is a deterministic
// backstop for a rule otherwise enforced only by discipline: Claude must
// never write or commit secrets. Templates (.example, .sample, .template, .dist)
// and public keys (.pub) are allowed — they are the documented, secret-free forms.
// Exit code 2 signals "block" to Claude Code; the stderr text is shown back.
//
// Two branches, two different guarantees. The file_path
// branch (Edit/Write/MultiEdit) is exact — it resolves the path to its canonical
// target and reads the name of the file that will actually be written, so a
// symlinked leaf or a symlinked parent directory cannot present an innocuous
// basename for a real .env. A dangling symlink is followed by hand rather than
// treated as a not-yet-created file, because writing through one creates its
// target: reading only the link's own name is precisely the case the exactness
// claim cannot cover. Creating a genuinely new file, including under a directory
// tree that does not exist yet, stays allowed — the ancestor walk exists for
// that, and blocking it would stop ordinary source work. The command branch
// (Bash) is pattern
// matching on a shell string, and it is best-effort by construction: it closes
// the named vectors (redirection, tee, cp/mv destination, sed -i, dd, truncate)
// and cannot close an arbitrary interpreter one-liner that opens the file
// itself. It narrows the hole rather than sealing it, so the discipline this
// hook backs up still applies. Read-only access is deliberately left alone; the
// rule is about writing secrets, not about looking at them.
//
// One pattern list serves both branches: the defaults below plus `protect.secrets`
// from .claude/odyssey.json, which adds patterns and never removes one. A pattern
// without a slash matches a file name, one with a slash matches the end of the path,
// * matches within one name, and **/ matches any number of folders, none included.
// Matching ignores letter case, because the macOS and Windows file systems do: a write
// to .ENV lands on .env there. The exact branch also checks the MCP file tools' `path`,
// `filePath` and `destination`. The command branch also reads a tool's own output flag
// (openssl -out and -keyout, curl -o, ssh-keygen -f and the like), a copy, link or rename
// into a directory, and PowerShell's write cmdlets, their aliases and its .NET file writes.
//
// Trust: only the user approves a command a hook may run. The exact branch blocks the
// trust file itself, and the command branch blocks any command that names it or runs
// `odyssey.mjs trust approve` — best-effort, like the rest of that branch.
//
// Fails closed: an uncaught error exits 1, which Claude Code treats as allow, so
// everything runs inside one try/catch that exits 2. An unreadable payload, a built-in
// tool's payload without its field, and a path that cannot be resolved all block. A start
// folder that can't be read does not: the guard then keeps its default patterns. The
// config and trust modules load by dynamic import inside that try, because a static
// import that throws fails before any of this code runs. An invalid config keeps the
// defaults.
//
// `hooks/protect-env.test.mjs` covers both branches — run it with
// `node --test hooks/protect-env.test.mjs`.
//
// It errs toward blocking, which is the correct direction for a secrets guard
// but has a visible cost: a Bash command that merely *quotes* one of these
// writes — a test fixture, a docs example, a script that echoes the pattern —
// is blocked along with a real one, because the hook sees a command string and
// not the shell's intent. When that happens, make the edit through
// Edit/Write/MultiEdit, whose branch above matches on the real path.
import { realpathSync, lstatSync, readlinkSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SECRETS = [
  ".env*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_ed25519*",
  "id_ecdsa*",
  ".aws/credentials",
  ".netrc",
  ".pypirc",
  "credentials.json",
  "secrets.yaml",
  "secrets.yml",
  "secrets.json",
];

// Templates and public keys, judged by the last suffix: .env.example is allowed,
// .env.example.local is not.
const TEMPLATE = /\.(?:example|sample|template|dist|pub)$/i;

const SCRIPT = fileURLToPath(new URL("../scripts/odyssey.mjs", import.meta.url));

function block(message) {
  process.stderr.write(`Blocked: ${message}\n`);
  process.exit(2);
}

function blockSecret(what) {
  block(
    `writing "${what}" is not allowed. It matches a secret-file pattern: secrets live in ` +
      `git-ignored files and must never be written or committed by Claude. Update a ` +
      `template such as .env.example instead, or change the value manually outside Claude. ` +
      `If Claude should write such files here, the user turns the Odyssey plugin off for this ` +
      `project with /plugin.`,
  );
}

function blockTrust(what) {
  block(
    `${what}. Only the user decides which commands the Odyssey hooks may run. To trust ` +
      `this repo's configured commands, run this yourself in the repo, from a terminal or ` +
      `with ! in the session: ` +
      `node "${SCRIPT}" trust approve`,
  );
}

// A pattern as a regex over a path with forward slashes, ignoring case: without a slash
// it matches the file name, with one the end of the path; * matches within one name and
// **/ any number of folders, none included. A leading / or ./ is dropped, so a
// root-relative pattern still matches.
function compile(pattern) {
  const body = pattern
    .replaceAll("\\", "/")
    .replace(/^(?:\.?\/)+/, "")
    .split("**/")
    .map((piece) =>
      piece
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join("(?:[^/]*/)*");
  return new RegExp(`(?:^|/)${body}$`, "i");
}

function isSecret(file, patterns) {
  const slashed = file.replaceAll("\\", "/");
  return !TEMPLATE.test(slashed) && patterns.some((re) => re.test(slashed));
}

// The canonical target of `p`: the file a write would actually land on.
//
// Resolves the deepest ancestor that exists and rejoins the segments below it, so
// a file about to be created still resolves — including through a directory tree
// that does not exist yet — while a symlinked leaf or a symlinked parent resolves
// to the real destination. A *dangling* symlink is followed by hand, because
// realpathSync refuses it and a write through one creates its target.
//
// Only a path that does not exist is walked past. Any other error (a NUL byte, a
// symlink loop, a permission error) propagates to the catch below, which blocks.
const MAX_HOPS = 32; // a symlink cycle terminates instead of looping
const missing = (err) => err.code === "ENOENT" || err.code === "ENOTDIR";

function canonicalize(p) {
  let abs = path.resolve(p);

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let link;
    try {
      link = lstatSync(abs).isSymbolicLink() ? readlinkSync(abs) : null;
    } catch (err) {
      if (!missing(err)) throw err;
      link = null; // does not exist — fall through to the ancestor walk
    }
    if (link === null) break;
    abs = path.resolve(path.dirname(abs), link);
  }

  const rest = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(realpathSync(cur), ...rest);
    } catch (err) {
      if (!missing(err)) throw err;
      const parent = path.dirname(cur);
      if (parent === cur) return abs; // reached the root
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

// --- Bash and PowerShell: best-effort command-string check ----------------
// A write target: a path up to whitespace, a quote or a shell metacharacter. The $
// admits Bash's ANSI-C quoting, as in $'.env'.
const TARGET = String.raw`\$?['"]?([^\s'"|;&<>()\`]+)`;
// > .env   >> .env   2> .env   *> .env   (heredocs land here too: cat <<EOF > .env).
// The lookbehind skips => and ->, which are arrows, not redirections.
const REDIRECT = new RegExp(String.raw`(?<![=-])>>?\|?[ \t]*${TARGET}`, "g");
// dd of=.env
const DD_OF = new RegExp(String.raw`\bof=${TARGET}`, "gi");
// A tool's own output flag: openssl -out and -keyout, mkcert -key-file, curl -o, wget -O,
// gpg --output, PowerShell's -OutFile. The flag may close a run of short flags, as in
// curl -sSLo and wget -qO. The value stops at =, so ssh -o IdentityFile=~/.ssh/id_rsa is an
// option.
const OUT = new RegExp(
  String.raw`(?:^|\s)(?:-[a-z]*o|--output(?:-document)?|-(?:key)?out|-outfile|-(?:key|cert)-file)(?:[ \t]+|=)['"]?([^\s'"|;&<>()\`=]+)`,
  "gi",
);
// The same flag with its value attached: curl -o.env.
const OUT_ATTACHED = new RegExp(String.raw`(?:^|\s)-o['"]?([^\s'"|;&<>()\`=-][^\s'"|;&<>()\`=]*)`, "gi");
// PowerShell's .NET file writes take the path first: [IO.File]::WriteAllText(".env", ...).
const DOTNET = /::(?:WriteAll\w+|AppendAll\w+|Create(?:Text)?)\(\s*['"]?([^'",)]+)/gi;
// A redirection with its target, removed before a copy's destination is read, so
// `cp secrets .env >/dev/null` still ends in .env.
const REDIRECTION = /(?<![=-])[\d*&]?[<>]+\|?[ \t]*['"]?[^\s'"|;&<>()`]*/g;
// Verbs whose every argument is a target: tee, touch, truncate, and PowerShell's
// Set-Content, Add-Content, Out-File, Tee-Object and New-Item.
const WRITERS = /^(?:tee|touch|truncate|set-content|add-content|out-file|tee-object|new-item)$/i;
// Verbs whose last operand, or the value after -Destination, is the target: the copy,
// move, link and rename commands.
const COPIERS = /^(?:cp|mv|install|ln|rsync|scp|copy-item|move-item|rename-item)$/i;
// PowerShell's aliases for those, read only in a PowerShell command: in a Bash command,
// "copy" or "move" is usually a word in a sentence.
const PS_WRITERS = /^(?:sc|ac|ni)$/i;
const PS_COPIERS = /^(?:copy|move|cpi|mi|ren|rni)$/i;
const IN_PLACE = /^(?:-[a-z]*i|--in-place)/i; // sed -i, -Ei, -i.bak, --in-place; perl -pi
const TRUST = /odyssey-trust\.json|odyssey\.mjs\s+trust\s+approve\b/i; // read with quotes removed

// Whether a copy's last operand is a folder that exists, read from the session's folder:
// `cp .env backup` then writes backup/.env. PowerShell takes a backslash as a separator on
// every system, so .\backup names the folder on macOS and Linux too. Anything it can't stat
// is not a folder.
function isFolder(operand, cwd, powershell) {
  const name = powershell ? operand.replaceAll("\\", "/") : operand;
  try {
    return statSync(path.resolve(cwd, name.replace(/^~(?=$|[\\/])/, homedir()))).isDirectory();
  } catch {
    return false;
  }
}

function commandTargets(command, powershell, cwd) {
  // A backslash before a newline continues a Bash line: bash drops both, so a name split
  // there is one name. In PowerShell a backslash there ends a path (Copy-Item .env .\dir\),
  // and the backtick continues the line, as a space between words.
  const text = (powershell ? command : command.replace(/\\\r?\n/g, "")).replace(/`\r?\n/g, " ");
  const targets = [REDIRECT, DD_OF, OUT, OUT_ATTACHED, DOTNET].flatMap((re) => [...text.matchAll(re)].map((m) => m[1]));
  // A segment never crosses a separator, a newline, a pipe or a subshell, so a verb in
  // one command never pairs with a path in another. A backtick does not split: in a
  // commit message or a PR body it quotes code, and in PowerShell it is the escape.
  // A separator inside quotes is part of an argument, as in sed -i 's|a|b|' .env, so it
  // is masked before the split.
  const masked = text.replace(/'[^'\n]*'|"(?:\\.|[^"\\\n])*"/g, (quoted) => quoted.replace(/[;&|()]/g, "_"));
  for (const segment of masked.split(/[;&|\n()]/)) {
    const words = segment
      .replace(/(?:^|\s)#.*/, "") // a trailing comment
      .replace(REDIRECTION, " ")
      .split(/\s+/)
      .map((word) => word.replace(/['"]/g, ""))
      .filter(Boolean);
    words.forEach((word, i) => {
      const verb = path.posix.basename(word.replaceAll("\\", "/")); // /bin/cp is cp
      const args = words.slice(i + 1);
      if (WRITERS.test(verb) || (powershell && PS_WRITERS.test(verb))) targets.push(...args);
      if (/^(?:sed|perl|ruby)$/i.test(verb) && args.some((arg) => IN_PLACE.test(arg))) targets.push(...args);
      // ssh-keygen -f writes the key, unless -l or -y only reads it.
      if (/^ssh-keygen$/i.test(verb) && args.includes("-f") && !args.some((arg) => /^-[a-z]*[ly]/i.test(arg))) {
        targets.push(args[args.indexOf("-f") + 1]);
      }
      if (COPIERS.test(verb) || (powershell && PS_COPIERS.test(verb))) {
        const operands = args.filter((arg) => !arg.startsWith("-"));
        targets.push(...operands.slice(-1));
        // Into a directory (., .., ~, a trailing slash, -t, or a folder that exists), each
        // source keeps its name. Not for scp and rsync, whose -i and -e values are keys they
        // only read.
        const last = operands.at(-1) ?? "";
        const into =
          /^(?:\.{1,2}|~)$|[\\/]$/.test(last) || args.some((arg) => /^(?:-t|--target)/.test(arg)) || (last !== "" && isFolder(last, cwd, powershell));
        if (into && !/^(?:scp|rsync)$/i.test(verb)) targets.push(...operands);
        const destination = args.findIndex((arg) => /^-des/i.test(arg));
        if (destination >= 0 && args[destination + 1]) targets.push(args[destination + 1]);
      }
    });
  }
  return targets.filter(Boolean);
}

// The field each built-in tool's payload carries. Without it the payload is not one
// this guard can read, so it blocks rather than guess.
const FIELD = {
  Edit: "file_path",
  Write: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
  Bash: "command",
  PowerShell: "command",
};

try {
  const { hookInput } = await import("../lib/config.mjs");
  const { trustFile } = await import("../lib/trust.mjs");
  const { payload, config } = hookInput();
  const input = payload?.tool_input ?? {};
  const field = FIELD[payload?.tool_name];
  if (field && typeof input[field] !== "string") {
    throw new Error(`the ${payload.tool_name} payload carries no ${field}`);
  }
  const patterns = [...DEFAULT_SECRETS, ...(config.protect?.secrets ?? [])].map(compile);

  // --- Edit/Write/MultiEdit and the MCP file tools: exact path check -------
  const files = [input.file_path, input.path, input.filePath, input.destination].filter(
    (file) => typeof file === "string" && file !== "",
  );
  if (files.length > 0) {
    const trust = canonicalize(trustFile()).toLowerCase();
    for (const file of files) {
      const target = canonicalize(file);
      if (target.toLowerCase() === trust) blockTrust(`"${target}" is the Odyssey trust file`);
      // The name Claude used counts as well as the canonical target: a write through a
      // .env symlink changes what the app reads as .env, whatever the target is called.
      const hit = [target, file].find((name) => isSecret(name, patterns));
      if (hit) blockSecret(hit);
    }
  }

  if (typeof input.command === "string") {
    if (TRUST.test(input.command.replace(/['"]/g, ""))) {
      blockTrust("this command names the Odyssey trust file or runs its approve command");
    }
    const cwd = typeof payload?.cwd === "string" ? payload.cwd : process.cwd();
    const hit = commandTargets(input.command, payload?.tool_name === "PowerShell", cwd).find((target) => isSecret(target, patterns));
    if (hit) blockSecret(hit);
  }
  process.exit(0);
} catch (err) {
  block(`the secrets guard could not check this call, so it fails closed: ${err.message}`);
}
