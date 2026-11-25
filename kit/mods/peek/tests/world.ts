// The world beneath the mod, for every test file: a repo with a worktree, the kit's guard copied into
// the mod's folder, the files `stats` lists, and commands answered by `answer`; on macOS, Linux or
// Windows. Every read is the mock's: no real file, .env or command is touched.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsStat, On, ProcessRunInit } from 'claude-code'

import { folderOf, join, nameOf } from '../hooks/paths'
import type { Os } from '../hooks/paths'

// The two lines peek reads from the kit's protect-env.mjs, as they stand there (10-02).
export const GUARD = `
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

// Templates and public keys, judged by the last suffix.
const TEMPLATE = /\\.(?:example|sample|template|dist|pub)$/i;
`

// The mod's folder, where `odyssey.mjs mod install peek` puts the guard's copy and peek reads it
// (`$.plugin.root`); compared with forward slashes and letter case ignored, as hosts spell it. The
// test runner gives a module its URL, which the mod API's types leave out.
const here = (import.meta as ImportMeta & { url: string }).url
const GUARD_COPY = `${decodeURIComponent(new URL('..', here).pathname).replace(/^\/(?=[A-Za-z]:)/, '')}protect-env.mjs`.toLowerCase()
const slashed = (path: string) => path.replaceAll('\\', '/').toLowerCase()

export const NOW = 1_759_400_060_000
export const HOME: Record<Os, string> = { mac: '/homes/me', linux: '/homes/me', windows: 'C:\\Profiles\\me' }
export const REPO: Record<Os, string> = { mac: '/repo', linux: '/repo', windows: 'C:\\repo' }

export type Stat = Partial<FsStat> & { realPath: string }
// A command's answer: its standard output, a failure, or "not installed" (it can't start).
export type Answer = string | { fail: string } | { missing: true } | undefined

export type WorldOptions = {
  os?: Os
  stats?: Record<string, Stat>
  files?: Record<string, string> // text, or base64 for a bytes read
  answer?: (argv: readonly string[], init: ProcessRunInit, files: Record<string, string>) => Answer
  version?: string | null // null: this Claude Code has no version call
  store?: Record<string, unknown>
  noGuard?: boolean
  cwd?: string // the session's folder; the repo when left out
  worktrees?: string | null // `git worktree list --porcelain`'s answer; null: not in a git repo
}

export type Ran = { argv: readonly string[]; init: ProcessRunInit }

// The engine under test runs on a macOS or Linux host, where `C:\x` is no absolute path: it
// resolves it against the test's folder before a hook sees it. A real Windows host keeps it as
// is, so the world takes that folder off again.
const unresolved = (path: string) => path.replace(/^.*\/(?=[A-Za-z]:[\\/])/, '')
// A real Windows host does the reverse to a macOS or Linux test's path: `/repo/a.md` reaches a hook
// on its own drive (`D:\repo\a.md`), so those tests take the drive and the backslashes off.
const posix = (path: string) => {
  const off = path.replace(/^[A-Za-z]:(?=[\\/])/, '')
  return off.startsWith('\\') ? off.replaceAll('\\', '/') : off
}

export const world = (on: On, w: WorldOptions = {}) => {
  const os = w.os ?? 'mac'
  const home = HOME[os]
  const at = (path: string) => (os === 'windows' ? unresolved(path) : posix(unresolved(path)))
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, os === 'windows' ? { USERPROFILE: home } : { HOME: home })
  const files: Record<string, string> = { ...w.files }
  const stored: Record<string, unknown> = { ...w.store }
  const opened: unknown[] = [] // every ui.open, as asked
  const ran: Ran[] = [] // every command, as run
  const written: { path: string; text: string }[] = []
  const reads: string[] = [] // every path read
  const dirs: Record<string, Stat> =
    os === 'windows'
      ? { 'C:/repo': { realPath: 'C:\\repo', kind: 'dir' }, 'C:\\repo': { realPath: 'C:\\repo', kind: 'dir' } }
      : { '/repo': { realPath: '/repo', kind: 'dir' }, '/wt/feature': { realPath: '/wt/feature', kind: 'dir' } }
  const stats: Record<string, Stat> = { ...dirs, ...w.stats }
  const porcelain =
    w.worktrees !== undefined
      ? w.worktrees
      : os === 'windows' ? 'worktree C:/repo\nHEAD abc\nbranch refs/heads/main\n' : 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/feature\nHEAD def\n'

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd ?? REPO[os] }))
  on('session.version', () => {
    if (w.version === null) return { deny: '$.session.version is not a function' }
    const version = w.version ?? '2.1.289'
    return { value: { version, base: /^\d+\.\d+\.\d+(?:-dev)?/.exec(version)?.[0], builtAt: '2026-10-01T00:00:00Z' } }
  })
  on('command.register', () => ({ value: { command: 'peek' } }))
  on('ui.open', (_$, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('fs.exists', (_$, e) => ({ value: at(e.path) === '/System/Library/CoreServices/SystemVersion.plist' ? os === 'mac' : at(e.path) in files || at(e.path) in stats }))
  on('fs.read', (_$, e) => {
    const path = at(e.path)
    reads.push(path)
    if (slashed(e.path) === GUARD_COPY && !w.noGuard) return { value: GUARD }
    const text = files[path]
    if (text !== undefined && e.as === 'bytes') return { value: { base64: text } }
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_$, e) => {
    files[at(e.path)] = e.text
    written.push({ path: at(e.path), text: e.text })
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    const hit = stats[at(e.path)]
    return hit ? { value: { size: 10, mtimeMs: 0, isLink: false, ...hit, kind: hit.kind ?? 'file' } } : { deny: 'ENOENT' }
  })
  on('fs.list', (_$, e) => ({
    value: Object.entries(stats)
      .filter(([path]) => path !== at(e.path) && folderOf(path) === at(e.path))
      .map(([path, s]) => ({ name: nameOf(path), kind: s.kind ?? 'file', size: s.size ?? 10, mtimeMs: s.mtimeMs ?? 0, isLink: false })),
  }))
  on('store.get', (_$, e) => ({ value: stored[e.key] }))
  on('store.set', (_$, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const init = e.init?.cwd === undefined ? (e.init ?? {}) : { ...e.init, cwd: at(e.init.cwd) }
    ran.push({ argv: e.argv, init })
    const said = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const argv = gitArgs(e.argv)
    if (argv.join(' ') === 'git worktree list --porcelain' && porcelain !== null) return said(porcelain)
    if (argv[0] === 'git' && porcelain === null) return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    const out = w.answer?.(argv, init, files)
    if (typeof out === 'string') return said(out)
    if (out && 'missing' in out) return { deny: `Executable not found in $PATH: "${argv[0]}"` }
    const stderr = out && 'fail' in out ? out.fail : 'not mocked'
    return { value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, opened, ran, written, reads, stored, files, os, home, repo: REPO[os] }
}

// A git command as typed, without the options peek always adds (`-c core.fsmonitor=false`).
export const gitArgs = (argv: readonly string[]): readonly string[] =>
  argv[0] === 'git' && argv[1] === '-c' && argv[2] === 'core.fsmonitor=false' ? ['git', ...argv.slice(3)] : argv

export const start = ($: Engine, os: Os = 'mac') => $.session.start({ cwd: REPO[os], surface: 'terminal', isInteractive: true })

export const peek = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'peek', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } }))?.text

export const PANE = {
  component: 'Pane',
  requestId: 'peek',
  props: { title: 'peek', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

export const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

export const mountPane = ($: Engine) => $.ui.mount({ plugin: 'peek', surface: 'terminal', ...PANE })

type Finder = { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }

// The list's rows, a Button each (a click opens one), as their labels read.
export const rows = async (ui: Finder, prefix = 'file:') => (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith(prefix)).map(b => b.text)

export const ok = (_$: unknown, e: { tool: unknown }) => ({ result: { tool: String(e.tool) } as never, text: 'ok' })

// --- Bytes for the format tests ------------------------------------------------------------------------

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff
  for (const x of b) c = (CRC[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const chunk = (type: string, data: number[] | Uint8Array) => {
  const body = new Uint8Array([...Array.from(type, c => c.charCodeAt(0)), ...data])
  return [...be32(data.length), ...body, ...be32(crc32(body))]
}

// A PNG of RGBA pixels, its data in stored (uncompressed) deflate blocks.
export const pngFile = (width: number, height: number, rgba: Uint8Array): Uint8Array => {
  const raw: number[] = []
  for (let y = 0; y < height; y++) raw.push(0, ...rgba.subarray(y * width * 4, (y + 1) * width * 4))
  const z: number[] = [0x78, 0x01]
  for (let at = 0; at < raw.length || at === 0; at += 65_535) {
    const piece = raw.slice(at, at + 65_535)
    const last = at + 65_535 >= raw.length ? 1 : 0
    z.push(last, piece.length & 0xff, piece.length >> 8, ~piece.length & 0xff, (~piece.length >> 8) & 0xff, ...piece)
  }
  let a = 1
  let b = 0
  for (const x of raw) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  z.push(...be32(((b << 16) | a) >>> 0))
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]), ...chunk('IDAT', z), ...chunk('IEND', [])])
}

// An opaque w × h picture: white, with a black column at x = 1.
export const picture = (w: number, h: number) => {
  const rgba = new Uint8Array(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) rgba.set([0, 0, 0, 255], (y * w + 1) * 4)
  return { width: w, height: h, rgba }
}

// The first bytes of a w × h JPEG: a JFIF header, then the frame header.
export const jpegHead = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1])

// A WAV of `seconds` of 16-bit mono silence at 22,050 Hz.
export const wavFile = (seconds: number) => {
  const data = Math.round(seconds * 22_050) * 2
  const b = new Uint8Array(44 + data)
  const v = new DataView(b.buffer)
  b.set([...'RIFF'].map(c => c.charCodeAt(0)), 0)
  v.setUint32(4, 36 + data, true)
  b.set([...'WAVEfmt '].map(c => c.charCodeAt(0)), 8)
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 22_050, true)
  v.setUint32(28, 44_100, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  b.set([...'data'].map(c => c.charCodeAt(0)), 36)
  v.setUint32(40, data, true)
  return b
}

// An MP3's first frame (MPEG-1 layer III, 128 kb/s, 44.1 kHz, joint stereo) after an empty ID3v2
// tag; with `frames`, a Xing header counting them.
export const mp3Head = (frames?: number) => {
  const b = new Uint8Array(10 + 418)
  b.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0], 0)
  b.set([0xff, 0xfb, 0x90, 0x64], 10)
  if (frames !== undefined) b.set([0x58, 0x69, 0x6e, 0x67, 0, 0, 0, 1, ...be32(frames)], 10 + 4 + 32)
  return b
}

// A w × h 32-bit BMP, bottom row first, as ffmpeg writes one: every pixel `bgra`.
export const bmpFile = (w: number, h: number, bgra = [0x40, 0x80, 0xc0, 0xff]) => {
  const b = new Uint8Array(54 + w * h * 4)
  const v = new DataView(b.buffer)
  b.set([0x42, 0x4d])
  v.setUint32(10, 54, true)
  v.setUint32(14, 40, true)
  v.setInt32(18, w, true)
  v.setInt32(22, h, true)
  v.setUint16(28, 32, true)
  for (let i = 0; i < w * h; i++) b.set(bgra, 54 + i * 4)
  return b
}
