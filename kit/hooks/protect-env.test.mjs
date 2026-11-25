// Checks for the secrets guard: both branches, the default and configured patterns,
// the trust guard, and failing closed.
//
// The hook is a process that reads a JSON payload on stdin
// and answers with an exit code, so the check exercises it as a process rather
// than importing it — that is the whole contract Claude Code relies on, and a
// unit test of the regexes would pass while the wiring was broken. Node's own
// test runner and assert module keep it dependency-free, so it runs in a repo
// with no test framework installed. Offline and
// deterministic: no network, no clock, no PII — the fixtures are paths and
// shell strings, and the assertions are exit codes.
//
// Run: node --test hooks/protect-env.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  mkdirSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("./protect-env.mjs", import.meta.url));
const BLOCKED = 2;
const ALLOWED = 0;

// Runs the hook the way Claude Code does. CLAUDE_PROJECT_DIR is a scratch repo with
// no config unless a check names one, HOME is a scratch home holding the trust file,
// and the temp dir the config notice marks is the scratch dir.
function spawn(input, { project = plain, hook = HOOK } = {}) {
  return spawnSync(process.execPath, [hook], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: project,
      HOME: home,
      USERPROFILE: home,
      TMPDIR: root,
      TEMP: root,
      TMP: root,
    },
  });
}

function run(payload, options) {
  return spawn(JSON.stringify(payload), options).status;
}

const edit = (file_path, options) => run({ tool_name: "Write", tool_input: { file_path } }, options);
const bash = (command, options) => run({ tool_name: "Bash", tool_input: { command } }, options);
const ps = (command) => run({ tool_name: "PowerShell", tool_input: { command } });
const mcp = (tool, tool_input) => run({ tool_name: `mcp__${tool}`, tool_input });

// A scratch tree the symlink cases need on disk. Removed on exit.
const root = mkdtempSync(path.join(tmpdir(), "protect-env-"));
const home = path.join(root, "home");
mkdirSync(path.join(home, ".claude"), { recursive: true });
const trustFile = path.join(home, ".claude", "odyssey-trust.json");
writeFileSync(trustFile, '{ "trusted": [] }\n');

// A scratch repo root (a .git directory is all the config resolver looks for), holding
// .claude/odyssey.json when `config` is given.
function repo(name, config) {
  const dir = path.join(root, name);
  mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (config !== undefined) {
    mkdirSync(path.join(dir, ".claude"));
    writeFileSync(path.join(dir, ".claude", "odyssey.json"), JSON.stringify(config));
  }
  return dir;
}
const plain = repo("plain");

test.after(() => {
  // Verify the location before anything destructive. `root` is
  // mkdtemp output today; this asserts the property the removal depends on
  // rather than trusting one call several lines up to stay that way.
  const real = realpathSync(root);
  assert.ok(real.startsWith(realpathSync(tmpdir()) + path.sep), "scratch dir is under tmpdir");
  assert.ok(path.basename(real).startsWith("protect-env-"), "scratch dir is ours");
  assert.notEqual(real, realpathSync(process.cwd()), "scratch dir is not the cwd");
  rmSync(real, { recursive: true, force: true });
});

const realEnv = path.join(root, ".env");
writeFileSync(realEnv, "SECRET=1\n");
mkdirSync(path.join(root, "real"));
writeFileSync(path.join(root, "real", ".env"), "SECRET=1\n");

test("file_path: plain .env paths are blocked", () => {
  assert.equal(edit(".env"), BLOCKED);
  assert.equal(edit("/srv/app/.env"), BLOCKED);
  assert.equal(edit(".env.production"), BLOCKED);
});

test("file_path: .env.example stays writable", () => {
  assert.equal(edit(".env.example"), ALLOWED);
});

test("file_path: ordinary files are untouched", () => {
  assert.equal(edit("src/config/env.ts"), ALLOWED);
  assert.equal(edit("README.md"), ALLOWED);
});

test("file_path: a file that does not exist yet is still writable", () => {
  // The canonical-target walk must resolve through directories that do not
  // exist, or creating new source files would be blocked.
  assert.equal(edit(path.join(root, "does/not/exist/yet/new-module.ts")), ALLOWED);
});

test("file_path: a symlinked leaf pointing at .env is blocked", () => {
  const link = path.join(root, "notes.txt");
  symlinkSync(realEnv, link);
  assert.equal(edit(link), BLOCKED);
});

test("file_path: a symlinked parent directory does not hide .env", () => {
  const linkDir = path.join(root, "safe");
  symlinkSync(path.join(root, "real"), linkDir);
  assert.equal(edit(path.join(linkDir, ".env")), BLOCKED);
});

test("file_path: a dangling symlink to an absent .env is blocked", () => {
  // Writing through a dangling link creates its target, so the target is what
  // the guard has to read — not the link's own innocuous name.
  const link = path.join(root, "config.txt");
  symlinkSync(path.join(root, "real", ".env.production"), link);
  assert.equal(edit(link), BLOCKED);
});

test("file_path: a dangling symlink to an ordinary absent file is allowed", () => {
  const link = path.join(root, "draft.txt");
  symlinkSync(path.join(root, "real", "notes.md"), link);
  assert.equal(edit(link), ALLOWED);
});

test("bash: redirection into .env is blocked", () => {
  assert.equal(bash("echo 'K=v' > .env"), BLOCKED);
  assert.equal(bash("echo 'K=v' >> /srv/app/.env"), BLOCKED);
  assert.equal(bash("cat <<EOF > .env\nK=v\nEOF"), BLOCKED);
});

test("bash: tee into .env is blocked", () => {
  assert.equal(bash("echo 'K=v' | tee -a .env"), BLOCKED);
});

test("bash: a copy destination of .env is blocked", () => {
  assert.equal(bash("cp secrets .env"), BLOCKED);
  assert.equal(bash("mv /tmp/staged .env"), BLOCKED);
});

test("bash: a copy destination survives a trailing redirect or comment", () => {
  // The end-of-destination anchor accepts these trailing forms.
  assert.equal(bash("cp secrets .env >/dev/null"), BLOCKED);
  assert.equal(bash("cp secrets .env 2>/dev/null"), BLOCKED);
  assert.equal(bash("cp secrets .env  # restore the local config"), BLOCKED);
});

test("bash: a copy destination survives shell grouping", () => {
  assert.equal(bash("(cp secrets .env)"), BLOCKED);
  assert.equal(bash("out=$(cp secrets .env)"), BLOCKED);
  assert.equal(bash("(cd /srv/app && cp /tmp/staged .env)"), BLOCKED);
});

test("bash: in-place and raw-write vectors are blocked", () => {
  assert.equal(bash("sed -i 's/a/b/' .env"), BLOCKED);
  assert.equal(bash("truncate -s 0 .env"), BLOCKED);
  assert.equal(bash("dd if=/tmp/x of=.env"), BLOCKED);
});

test("bash: .env names with several suffixes are blocked", () => {
  // .env.production.local and friends are real env files; a single-suffix
  // pattern let them through the command branch.
  assert.equal(bash("echo 'K=v' > .env.production.local"), BLOCKED);
  assert.equal(bash("cp a .env.development.local"), BLOCKED);
  assert.equal(bash("echo 'K=v' > .env.example.local"), BLOCKED);
});

test("bash: .env.example is writable through the command branch too", () => {
  assert.equal(bash("cp .env .env.example"), ALLOWED);
  assert.equal(bash("echo 'K=' > .env.example"), ALLOWED);
});

test("bash: reading .env is left alone", () => {
  assert.equal(bash("cat .env"), ALLOWED);
  assert.equal(bash("grep -c '' .env"), ALLOWED);
});

test("bash: a verb and a .env on separate commands do not combine", () => {
  // The gap never crosses a separator, so a cp on one line and a mention of
  // .env on the next is not a copy into .env.
  assert.equal(bash("cp a b\necho check .env in the docs"), ALLOWED);
});

// One file name for each default pattern (.env* takes two).
const SECRETS = [
  ".env",
  ".env.local",
  "server.pem",
  "server.key",
  "cert.p12",
  "cert.pfx",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  ".aws/credentials",
  ".netrc",
  ".pypirc",
  "credentials.json",
  "secrets.yaml",
  "secrets.yml",
  "secrets.json",
];

test("letter case does not hide a secret: Write .ENV and echo X > .ENV are blocked", () => {
  // The macOS and Windows file systems ignore case, so a write to .ENV lands on .env.
  assert.equal(edit(".ENV"), BLOCKED);
  assert.equal(bash("echo X > .ENV"), BLOCKED);
  assert.equal(edit("Server.PEM"), BLOCKED);
  assert.equal(ps("Set-Content -Path ID_RSA -Value x"), BLOCKED);
  assert.equal(edit(".Env.Example"), ALLOWED);
});

test("every default pattern is blocked via Write, Bash and PowerShell", () => {
  for (const name of SECRETS) {
    assert.equal(edit(name), BLOCKED, `Write ${name}`);
    assert.equal(bash(`echo x > ${name}`), BLOCKED, `Bash ${name}`);
    assert.equal(ps(`Set-Content -Path ${name} -Value x`), BLOCKED, `PowerShell ${name}`);
  }
  assert.equal(edit("src/app.env.ts"), ALLOWED, "a pattern matches a whole name, not the end of one");
});

test("templates and public keys are allowed via Write, Bash and PowerShell", () => {
  for (const name of [".env.example", ".env.sample", ".env.template", ".env.dist", "id_rsa.pub", "secrets.json.example"]) {
    assert.equal(edit(name), ALLOWED, `Write ${name}`);
    assert.equal(bash(`echo x > ${name}`), ALLOWED, `Bash ${name}`);
    assert.equal(ps(`Set-Content -Path ${name} -Value x`), ALLOWED, `PowerShell ${name}`);
  }
});

test("powershell: each write form is blocked, and reading is left alone", () => {
  for (const command of [
    "Set-Content -Path .env -Value 'K=v'",
    "Add-Content .env 'K=v'",
    "'K=v' | Out-File -FilePath .env",
    "'K=v' | Tee-Object -FilePath .env",
    "Copy-Item staged.txt .env",
    "Copy-Item -Destination .env -Path staged.txt",
    "Move-Item staged.txt .env -Force",
    "New-Item -Path .env -ItemType File -Value 'K=v'",
    "'K=v' > .env",
    "'K=v' >> .env",
    "ni .env -Value 'K=v'",
    "copy staged.txt .env",
  ]) {
    assert.equal(ps(command), BLOCKED, command);
  }
  assert.equal(ps("Get-Content .env"), ALLOWED);
  assert.equal(ps("Copy-Item .env .env.example"), ALLOWED);
});

test("protect.secrets adds patterns: .npmrc is allowed by default and blocked once added", () => {
  assert.equal(edit(".npmrc"), ALLOWED);
  assert.equal(bash("echo x > .npmrc"), ALLOWED);
  const project = repo("configured", { version: 1, protect: { secrets: [".npmrc", "config/*.local.yaml"] } });
  assert.equal(edit(".npmrc", { project }), BLOCKED);
  assert.equal(bash("echo x > .npmrc", { project }), BLOCKED);
  assert.equal(edit(".env", { project }), BLOCKED, "config adds to the defaults");
  assert.equal(edit("config/app.local.yaml", { project }), BLOCKED, "a slash matches the end of the path");
  assert.equal(edit("other/app.local.yaml", { project }), ALLOWED);
  assert.equal(edit("config/app.yaml", { project }), ALLOWED);
  assert.equal(edit("config/deep/app.local.yaml", { project }), ALLOWED, "* stays within one name");
});

test("protect.secrets: a leading / or ./ is dropped, so a root-relative pattern still matches", () => {
  const project = repo("rooted", { version: 1, protect: { secrets: ["/config/*.local.yaml", "./keys/*.txt"] } });
  assert.equal(edit("config/app.local.yaml", { project }), BLOCKED);
  assert.equal(edit("keys/deploy.txt", { project }), BLOCKED);
  assert.equal(edit("keys/readme.md", { project }), ALLOWED);
});

test("protect.secrets: **/ matches any number of folders, none included", () => {
  const project = repo("globstar", { version: 1, protect: { secrets: ["**/*.secret", "config/**/app.yaml"] } });
  assert.equal(bash("echo x > a.secret", { project }), BLOCKED);
  assert.equal(bash("echo x > deep/er/a.secret", { project }), BLOCKED);
  assert.equal(edit("a.secret", { project }), BLOCKED);
  assert.equal(bash("echo x > config/app.yaml", { project }), BLOCKED);
  assert.equal(bash("echo x > config/a/b/app.yaml", { project }), BLOCKED);
  assert.equal(bash("echo x > a.secret.md", { project }), ALLOWED);
  assert.equal(bash("echo x > other/app.yaml", { project }), ALLOWED);
});

test("an invalid config keeps the default patterns, and says so", () => {
  const project = repo("invalid", { version: 1, protect: { secrets: [".npmrc"] }, typo: true });
  const result = spawn(JSON.stringify({ session_id: "invalid-config", tool_name: "Write", tool_input: { file_path: ".npmrc" } }), { project });
  assert.equal(result.status, ALLOWED, "the invalid config's own patterns are off");
  const { systemMessage } = JSON.parse(result.stdout);
  assert.match(systemMessage, /unknown key "typo"/);
  assert.match(systemMessage, /the secrets guard uses only its defaults/);
  assert.equal(edit(".env", { project }), BLOCKED, "the defaults hold");
});

test("mcp: the file tools' path, filePath, file_path and destination are checked", () => {
  assert.equal(mcp("filesystem__write_file", { path: ".env", content: "K=v" }), BLOCKED);
  assert.equal(mcp("filesystem__write_file", { filePath: ".env", content: "K=v" }), BLOCKED);
  assert.equal(mcp("filesystem__edit_file", { path: "server.key", edits: [] }), BLOCKED);
  assert.equal(mcp("filesystem__move_file", { source: "staged.txt", destination: "secrets.json" }), BLOCKED);
  assert.equal(mcp("desktop-commander__edit_block", { file_path: "id_rsa", old_string: "a", new_string: "b" }), BLOCKED);
  assert.equal(mcp("filesystem__write_file", { path: "src/app.ts", content: "x" }), ALLOWED);
});

test("file_path: a secret-named symlink to an innocuously named file is blocked", () => {
  // The write lands on settings.txt, but through .env, so what the app reads as .env changes.
  const dir = path.join(root, "linked");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "settings.txt"), "K=v\n");
  symlinkSync(path.join(dir, "settings.txt"), path.join(dir, ".env"));
  assert.equal(edit(path.join(dir, ".env")), BLOCKED);
});

test("the trust file is blocked for the edit tools, through a symlink too", () => {
  assert.equal(edit(trustFile), BLOCKED);
  assert.equal(mcp("filesystem__write_file", { path: trustFile, content: "{}" }), BLOCKED);
  const link = path.join(root, "trust-link.json");
  symlinkSync(trustFile, link);
  assert.equal(edit(link), BLOCKED);
  assert.equal(edit(path.join(home, ".claude", "ODYSSEY-TRUST.json")), BLOCKED, "letter case does not hide it");
  assert.equal(edit(path.join(home, ".claude", "notes.md")), ALLOWED, "only the trust file");
});

test("commands naming the trust file or running trust approve are blocked", () => {
  assert.equal(bash("cat ~/.claude/odyssey-trust.json"), BLOCKED);
  assert.equal(bash("echo '{}' > ~/.claude/Odyssey-Trust.json"), BLOCKED);
  assert.equal(bash("node /opt/odyssey/scripts/odyssey.mjs trust approve"), BLOCKED);
  assert.equal(bash('cd /srv/app && node "/opt/my plugins/odyssey/scripts/odyssey.mjs" trust  approve'), BLOCKED);
  assert.equal(ps('& node "C:\\Plugins\\odyssey\\scripts\\odyssey.mjs" trust approve'), BLOCKED);
  assert.equal(bash('node /opt/odyssey/scripts/odyssey.mjs "trust" "approve"'), BLOCKED, "quotes do not hide it");
  assert.equal(bash("node /opt/odyssey/scripts/odyssey.mjs trust list"), ALLOWED);
  assert.equal(bash("node /opt/odyssey/scripts/odyssey.mjs trust revoke"), ALLOWED);
  assert.equal(bash("node /opt/odyssey/scripts/odyssey.mjs config"), ALLOWED);
});

test("bash: a tool's own output flag names a target: openssl, mkcert, curl, wget, gpg, ssh-keygen", () => {
  for (const command of [
    "openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365",
    "openssl genrsa -out server.key 2048",
    "mkcert -key-file dev.key -cert-file dev.crt localhost",
    "curl -fsSL https://example.test/env -o .env",
    "wget -O .env https://example.test/env",
    "gpg --output secrets.json --decrypt secrets.json.gpg",
    "ssh-keygen -t ed25519 -f ./id_ed25519 -N ''",
  ]) {
    assert.equal(bash(command), BLOCKED, command);
  }
  for (const command of [
    "ssh -o IdentityFile=~/.ssh/id_rsa host uptime",
    "ssh-keygen -y -f ~/.ssh/id_ed25519 > id_ed25519.pub",
    "ssh-keygen -l -f ~/.ssh/id_ed25519",
    "openssl req -new -key server.key -out server.csr",
    "curl -fsSL https://example.test/install.sh -o install.sh",
  ]) {
    assert.equal(bash(command), ALLOWED, command);
  }
});

test("bash: a quoted separator, a run of short flags and a continued line still name their target", () => {
  for (const command of [
    "sed -i 's|http://old|http://new|' .env",
    "sed -i '' 's|^API_URL=.*|API_URL=https://x|' .env.local",
    "sed -i 's/a/b/; s/c/d/' .env",
    "sed -i -E 's/DEBUG=(true|false)/DEBUG=false/' .env",
    "perl -pi -e 's/(foo)/bar/' .env",
    "ruby -i -pe 'gsub(/a/, \"b\")' .env",
    "cp 'a & b.txt' .env",
    "curl -sSLo .env https://example.test/env",
    "curl -sLo server.key https://example.test/key",
    "curl -s https://example.test/env -o.env",
    "wget -qO .env https://example.test/env",
    "cp .env.example \\\n  .env",
    "mv tmp.txt \\\n  config/.env.local",
    "curl -s https://example.test/env -o \\\n  .env",
    "echo x > .e\\\nnv", // bash joins the pieces: the file is .env
  ]) {
    assert.equal(bash(command), BLOCKED, command);
  }
  for (const command of [
    "Invoke-WebRequest https://example.test/env -OutFile .env",
    "iwr https://example.test/key -outfile server.key",
    "Copy-Item staged.txt `\n  -Destination .env",
  ]) {
    assert.equal(ps(command), BLOCKED, command);
  }
  for (const command of [
    "sed -i 's|a|b|' src/app.ts",
    "sed -n 's|a|b|p' .env",
    "grep -E 'KEY=(a|b)' .env",
    "curl -sSLo install.sh https://example.test/install.sh",
    "gcc -o build/app main.c",
    "go build -o bin/server ./cmd/server",
    "sort -o sorted.txt in.txt",
    "kubectl get pods -o wide",
    "tar -czf backup.tgz src",
    "ssh -oStrictHostKeyChecking=no host uptime",
    "git commit -m \"fix (guard): handle a missing .env; see the notes\"",
    "cp src/a.ts \\\n  src/b.ts",
  ]) {
    assert.equal(bash(command), ALLOWED, command);
  }
});

test("every write the README names is blocked", () => {
  for (const command of [
    "echo x > .env",
    "echo x >> .env",
    "echo x >| .env",
    "echo x 2> .env",
    "echo x | tee .env",
    "touch .env",
    "truncate -s 0 .env",
    "cp a.txt .env",
    "mv a.txt .env",
    "install -m 600 a.txt .env",
    "ln -s a.txt .env",
    "rsync a.txt .env",
    "scp host:a.txt .env",
    "cp .env.local config/",
    "sed -i 's/a/b/' .env",
    "sed --in-place 's/a/b/' .env",
    "perl -i -pe 's/a/b/' .env",
    "ruby -i -pe 'sub(/a/, \"b\")' .env",
    "dd if=a.txt of=.env",
    "openssl genrsa -out server.key 2048",
    "curl https://example.test/env -o .env",
    "wget -O .env https://example.test/env",
    "gpg --output secrets.json --decrypt secrets.json.gpg",
    "ssh-keygen -t ed25519 -f id_ed25519",
  ]) {
    assert.equal(bash(command), BLOCKED, command);
  }
  for (const command of [
    "Set-Content .env x",
    "Add-Content .env x",
    "'x' | Out-File .env",
    "'x' | Tee-Object .env",
    "Copy-Item a.txt .env",
    "Move-Item a.txt .env",
    "Rename-Item a.txt .env",
    "New-Item .env",
    "sc .env x",
    "ac .env x",
    "ni .env",
    "copy a.txt .env",
    "move a.txt .env",
    "cpi a.txt .env",
    "mi a.txt .env",
    "ren a.txt .env",
    "rni a.txt .env",
    "'x' > .env",
    "'x' >> .env",
    "'x' *> .env",
    "[IO.File]::WriteAllText('.env', 'x')",
  ]) {
    assert.equal(ps(command), BLOCKED, command);
  }
});

test("bash: a copy into a directory keeps each source's name, and links, scp and perl -i count", () => {
  for (const command of [
    "cp ~/.ssh/id_rsa .",
    "mv server.key certs/",
    "mv -t certs/ tls.key tls.crt",
    "ln -sf ../shared/.env .env",
    "ln -s ../../.env .",
    "scp prod:/srv/app/.env .env",
    "perl -pi -e 's/OLD/NEW/' .env",
    "echo x > $'.env'",
  ]) {
    assert.equal(bash(command), BLOCKED, command);
  }
  for (const command of [
    "mv README.md docs/",
    "cp .env.example .",
    "scp -i ~/.ssh/id_rsa app.tar host:/srv/",
    'rsync -e "ssh -i ~/.ssh/id_ed25519" dist/ host:/srv/app/',
    "perl -ne 'print if /KEY/' .env",
  ]) {
    assert.equal(bash(command), ALLOWED, command);
  }
});

test("a copy into a folder that exists keeps each source's name, with or without a trailing slash", () => {
  mkdirSync(path.join(root, "backup"));
  mkdirSync(path.join(home, "vault"));
  const at = (tool_name, command) => run({ tool_name, cwd: root, tool_input: { command } });
  for (const command of ["cp .env backup", "mv -f server.key backup", `cp .env ${path.join(root, "backup")}`, "cp .env ~/vault"]) {
    assert.equal(at("Bash", command), BLOCKED, command);
  }
  assert.equal(at("PowerShell", "Copy-Item .env -Destination backup"), BLOCKED);
  assert.equal(at("PowerShell", "Copy-Item .env .\\backup"), BLOCKED, "PowerShell's backslash, on any system");
  assert.equal(at("Bash", "cp .env backup.md"), ALLOWED, "a new file: only its own name counts");
  assert.equal(at("Bash", "cp .env not-there"), ALLOWED, "no such folder: a new file named not-there");
  assert.equal(at("Bash", "cp README.md backup"), ALLOWED);
});

test("powershell: a backslash ending a line ends a path, it doesn't continue the line", () => {
  assert.equal(ps("Copy-Item .env .\\backup\\\nGet-Date"), BLOCKED);
  assert.equal(ps("Copy-Item README.md .\\docs\\\nGet-Date"), ALLOWED);
  assert.equal(bash("echo x > .e\\\nnv"), BLOCKED, "Bash still joins the line");
});

test("powershell: renames and .NET file writes are blocked; Bash prose with its aliases or backticks is not", () => {
  for (const command of [
    "Rename-Item -Path staged.txt -NewName .env",
    "ren staged.txt .env",
    "[IO.File]::WriteAllText(\"$PWD\\.env\", 'K=v')",
    "[System.IO.File]::AppendAllText('secrets.json', 'x')",
  ]) {
    assert.equal(ps(command), BLOCKED, command);
  }
  // In Bash, "copy" and "move" are words in a sentence, and backticks quote code in prose.
  assert.equal(bash('echo "Next: copy .env.example to .env"'), ALLOWED);
  assert.equal(bash('echo "Then run: ni .env"'), ALLOWED);
  assert.equal(bash("gh pr create --title Setup --body \"Run `cp .env.example .env` and fill in the keys.\""), ALLOWED);
});

test("NotebookEdit: its notebook_path is checked, and a payload without one blocks", () => {
  const notebook = (tool_input) => run({ tool_name: "NotebookEdit", tool_input });
  assert.equal(notebook({ notebook_path: ".env.ipynb", cell_id: "c1", new_source: "x" }), BLOCKED);
  assert.equal(notebook({ notebook_path: "analysis.ipynb", cell_id: "c1", new_source: "x" }), ALLOWED);
  assert.equal(notebook({ file_path: "analysis.ipynb" }), BLOCKED, "not a payload this guard can read");
});

test("a start folder that is gone keeps the default patterns, and blocks nothing else", () => {
  const gone = { project: path.join(root, "gone") };
  assert.equal(bash("ls -la", gone), ALLOWED);
  assert.equal(edit(path.join(root, "src", "a.ts"), gone), ALLOWED);
  assert.equal(edit(path.join(root, "src", ".env"), gone), BLOCKED);
  assert.equal(bash("echo x > .env", gone), BLOCKED);
});

test("fails closed: an unreadable payload blocks", () => {
  const result = spawn("not json");
  assert.equal(result.status, BLOCKED);
  assert.match(result.stderr, /secrets guard could not check this call/);
  assert.equal(spawn("").status, BLOCKED);
});

test("fails closed: a path containing a NUL byte blocks", () => {
  // Resolving it throws, and only a path that does not exist is walked past.
  assert.equal(edit("notes\u0000.txt"), BLOCKED);
});

test("fails closed: a built-in tool's payload without its field blocks", () => {
  assert.equal(run({ tool_name: "PowerShell", tool_input: { script: "Set-Content .env x" } }), BLOCKED);
  assert.equal(run({ tool_name: "Write", tool_input: { path: "notes.md", content: "x" } }), BLOCKED);
});

test("fails closed: the hook blocks when its lib/ modules cannot load", () => {
  // A static import that throws exits 1 before any catch runs, and Claude Code treats
  // exit 1 as allow. The guard's dynamic import keeps that failure inside its catch.
  const alone = path.join(root, "alone", "hooks");
  mkdirSync(alone, { recursive: true });
  copyFileSync(HOOK, path.join(alone, "protect-env.mjs"));
  const result = spawn(JSON.stringify({ tool_input: { file_path: "README.md" } }), {
    hook: path.join(alone, "protect-env.mjs"),
  });
  assert.equal(result.status, BLOCKED);
  assert.match(result.stderr, /secrets guard could not check this call/);
});
