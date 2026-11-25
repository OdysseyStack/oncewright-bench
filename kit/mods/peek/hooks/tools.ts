// The commands peek runs, on any OS. Every one goes by argument vector (no shell on any OS),
// read-only and with a timeout, save the .env save at the bottom.
//
// The engine is reached through a Host that register.tsx builds from `$` (the engine follows `$`
// only within the file that declares the function using it); the tests and a real-machine check
// hand in their own.

import { folderOf, join, nameOf } from './paths'
import type { Os } from './paths'

export type Exec = (
  argv: readonly string[],
  init: { timeoutMs: number; cwd?: string; stdin?: string; env?: Record<string, string> },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export type Host = {
  os: Os
  config: string // Claude Code's per-user folder
  exec: Exec // $.process.run
  read: (path: string) => Promise<string> // $.fs.read, as text
  bytes: (path: string) => Promise<string> // $.fs.read, as base64
  write: (path: string, text: string) => Promise<void> // $.fs.write
}

// `missing`: the command could not start, so the tool is not installed (or not on PATH).
export type Ran = { out: string; why?: undefined; missing?: undefined } | { out?: undefined; why: string; missing: boolean }

type Init = { cwd?: string; stdin?: string; env?: Record<string, string> }

export const run = async (host: Host, argv: readonly string[], timeoutMs = 20_000, init: Init = {}): Promise<Ran> => {
  const name = argv[0] ?? 'a command'
  try {
    const done = await host.exec(argv, { timeoutMs, ...init })
    if (done.exitCode === 0) return { out: done.stdout }
    return { why: `${name} failed: ${done.stderr.trim().split('\n')[0] || `exit code ${done.exitCode}`}`, missing: false }
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    if (/time|still running|killed/i.test(said)) return { why: `${name} didn't finish within ${timeoutMs / 1000} s`, missing: false }
    return { why: `${name} isn't installed, or couldn't start`, missing: true }
  }
}

// Git, read-only: no file-system monitor (a repo's config can name one to run), no optional locks
// (git then never rewrites the index while reading), and a path taken as written, never as a
// pattern. Diffs also pass --no-ext-diff and --no-textconv, so no external program runs.
export const git = (host: Host, args: readonly string[], cwd?: string, timeoutMs = 15_000): Promise<Ran> =>
  run(host, ['git', '-c', 'core.fsmonitor=false', ...args], timeoutMs, { cwd, env: { GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' } })

// --- A converter's output, by way of a scratch file -----------------------------------------------------
// $.process.run hands back text, so a picture a tool makes (a BMP, a PNG) goes to a file instead: one
// of peek's own under Claude Code's folder, emptied once read or once the tool fails, so no copy of
// the picture stays.

export const converted = async (host: Host, name: string, argv: (out: string) => string[], timeoutMs = 30_000): Promise<Ran> => {
  const out = join(host.os, host.config, `peek/${name}`)
  if (!(await host.write(out, '').then(() => true, () => false))) return { why: `peek couldn't write its scratch file ${out}`, missing: false }
  const command = argv(out)
  const made = await run(host, command, timeoutMs)
  const read = made.why === undefined ? await host.bytes(out).catch(() => '') : ''
  await host.write(out, '').catch(() => undefined)
  if (made.why !== undefined) return made
  return read ? { out: read } : { why: `${command[0]} wrote nothing peek can read`, missing: false }
}

// --- The .env save: atomic on every OS ------------------------------------------------------------------
// The new text is written whole to a temporary file beside the .env, which then replaces the .env in
// one rename, so a crash leaves the old file or the new one, never a mix. No backup copy is kept.
//   macOS, Linux: `mktemp -d` makes a private folder (mode 0700) beside the .env; the text is written
//     in it, given the .env's own mode (`stat`), and moved over the .env (`mv`: a rename, since the
//     folder is on the same file system); the folder is then removed.
//   Windows: the text is written to `<.env>.peek-<random>.tmp` beside it, and .NET's File.Replace
//     (Windows' ReplaceFile) swaps it in, keeping the .env's permissions; PowerShell runs that one
//     call, the two paths handed over in variables, never in the command text.

export const REPLACE = [
  "$ErrorActionPreference = 'Stop'",
  'try { [System.IO.File]::Replace($env:PEEK_FROM, $env:PEEK_TO, [NullString]::Value) }',
  'catch { Remove-Item -LiteralPath $env:PEEK_FROM -Force -ErrorAction SilentlyContinue; [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',
].join('\n')

const random = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')

// Answers null once saved, else why not, in a plain line that never holds a value.
export const saveAtomic = async (host: Host, path: string, text: string): Promise<string | null> => {
  const written = (to: string) => host.write(to, text).then(() => true, () => false)
  if (host.os === 'windows') {
    const temp = `${path}.peek-${random()}.tmp`
    if (!(await written(temp))) return "peek couldn't write the temporary file"
    const swapped = await run(host, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', REPLACE], 20_000, { env: { PEEK_FROM: temp, PEEK_TO: path } })
    // REPLACE deletes the temporary file when the swap fails; when PowerShell couldn't run it, the
    // values in it are written over, since a mod's file calls can't delete.
    if (swapped.why !== undefined) await host.write(temp, '').catch(() => undefined)
    return swapped.why ?? null
  }
  const mode = (await run(host, host.os === 'mac' ? ['stat', '-f', '%Lp', path] : ['stat', '-c', '%a', path], 5_000)).out?.trim() ?? ''
  if (!/^[0-7]{3,4}$/.test(mode)) return "peek couldn't read the file's mode"
  const made = await run(host, ['mktemp', '-d', join(host.os, folderOf(path), '.peek-XXXXXXXX')], 5_000)
  const folder = made.out?.trim()
  if (!folder) return made.why ?? 'mktemp made no folder'
  const temp = join(host.os, folder, nameOf(path))
  try {
    if (!(await written(temp))) return "peek couldn't write the temporary file"
    for (const argv of [['chmod', mode, temp], ['mv', '-f', temp, path]]) {
      const done = await run(host, argv, 5_000)
      if (done.why !== undefined) return done.why
    }
    return null
  } finally {
    await run(host, ['rm', '-f', temp], 5_000)
    await run(host, ['rmdir', folder], 5_000)
  }
}
