import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Folders, Mark, Pick, Picker, Pixels, Touched, View } from '../types'
import { diffList, diffView } from './diff'
import { isWritable, MASK, maskedRow, newLine, parseEnv, serializeEnv, setValue, UNWRITABLE } from './env'
import type { EnvDoc } from './env'
import { load, rawTextOf } from './load'
import { absolute, isInside, join, nameOf, relTo, sameForm, tooBroad, windowsProblem } from './paths'
import type { Os } from './paths'
import {
  FIT, TOO_OLD, bytesLine, cellsOf, clean, contextAbove, diffRuns, extraSecrets, frame, fromBase64, isEnvFile, isSecret, kindOf, meetsFloor,
  pan, secretsFrom, since, targets, worktreesFrom, wrapNumbered,
} from './read'
import type { Image, Kind, Lens, Secrets, Target } from './read'
import { git, saveAtomic } from './tools'
import type { Host } from './tools'

type $ = EngineInterface

const PANE = 'peek'
// The kit's secrets guard, whose secret-file patterns peek reuses: `odyssey.mjs mod install peek`
// copies it into peek's own folder.
const GUARD = 'protect-env.mjs'
const WARN = '#d29922'
const MARK = '#e3b341' // the line a file opened at
const DIFF = { hunk: '#58a6ff', add: '#3fb950', del: '#f85149' } as const
const EMBLEM = '🔭' // leads the pane's title and header
const CONTEXT = 3 // lines drawn above a line the file opened at
const ROWS_MAX = 50 // rows the list shows; the rest are counted on a line under it
const INDEX_MAX = 20_000 // repo files the filter searches
const FOLDERS_MAX = 2_000 // folders whose files peek dates, one listing each

const view = atom({ plugin: 'peek', key: 'view' } as const, null)
const picker = atom({ plugin: 'peek', key: 'picker' } as const, null)
const query = atom({ plugin: 'peek', key: 'query' } as const, '')
const folders = atom({ plugin: 'peek', key: 'folders' } as const, null)
const isPicture = atom({ plugin: 'peek', key: 'isPicture' } as const, false)
const lens = atom({ plugin: 'peek', key: 'lens' } as const, FIT)
const touched = atom({ plugin: 'peek', key: 'touched' } as const, [])
const wrote = atom({ plugin: 'peek', key: 'wrote' } as const, null)

// --- The host: which OS, its folders, and the engine calls the other files make ----------------------
// There is no platform value in the API, so the OS is read off the host: Windows by the session
// folder's spelling (a drive letter or a network path), macOS by its system version file, Linux
// otherwise. Module memory: a reload asks again.
let system: Os | null = null

const osOf = async ($: $): Promise<Os> => {
  if (system) return system
  const cwd = await $.session.cwd()
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(cwd)) return (system = 'windows')
  const isMac = await $.fs.exists('/System/Library/CoreServices/SystemVersion.plist').catch(() => false)
  return (system = isMac ? 'mac' : 'linux')
}

// The home folder: USERPROFILE on Windows (HOME is set there only by some shells), HOME elsewhere.
const homeOf = async ($: $): Promise<string> =>
  ((await osOf($)) === 'windows' ? ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))) : await $.env.get('HOME')) ?? ''

// Claude Code's per-user folder: CLAUDE_CONFIG_DIR when set, else .claude in the home folder.
const configOf = async ($: $): Promise<string> => (await $.env.get('CLAUDE_CONFIG_DIR')) || join(await osOf($), await homeOf($), '.claude')

// What tools.ts, load.ts and diff.ts reach the engine through: $ itself never leaves this file.
const hostOf = async ($: $): Promise<Host> => ({
  os: await osOf($),
  config: await configOf($),
  exec: (argv, init) => $.process.run(argv, init),
  read: path => $.fs.read(path),
  bytes: path => $.fs.read(path, { as: 'bytes' }).then(b => b.base64),
  write: (path, text) => $.fs.write(path, text),
})

// --- The Claude Code peek needs -----------------------------------------------------------------------
// The manifest has no field for it, so the session's version is read at run time; an older Claude
// Code with no version call at all counts as too old. /peek answers so there; nothing is tracked,
// so the band never shows. The answer, while this module lives.
let isSupported = false

const tooOld = async ($: $): Promise<string | null> => {
  try {
    const { version, base } = await $.session.version()
    return meetsFloor(base ?? version) ? null : `${TOO_OLD} (this is ${version}).`
  } catch {
    return `${TOO_OLD}.`
  }
}

// --- Where peek may look: the session's repo, its worktrees and approved folders; never a secret ----

// A path with its links followed; as given when it can't be.
const realOf = async ($: $, path: string) => (path ? ((await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath ?? path) : '')

// Why a folder (a real path) is too broad for peek, as tooBroad says against the real home and Claude
// Code folders; null when it isn't.
const broadOf = async ($: $): Promise<(folder: string, isRoot?: boolean) => string | null> => {
  const [os, home, config] = await Promise.all([osOf($), homeOf($).then(h => realOf($, h)), configOf($).then(c => realOf($, c))])
  return (folder, isRoot) => tooBroad(os, folder, home, config, isRoot)
}

const rootsOf = async ($: $): Promise<string[]> => {
  const listed = await git(await hostOf($), ['worktree', 'list', '--porcelain'], undefined, 10_000)
  // Outside a git repo, the session's own folder stands in for the repo.
  const found = listed.out === undefined ? [await $.session.cwd()] : worktreesFrom(listed.out)
  const real = await Promise.all(found.map(f => $.fs.stat(f, { resolve: true }).then(s => s.realPath, () => undefined)))
  // A repo or folder too broad to approve (a session started in the home folder, say) is no root either.
  const broad = await broadOf($)
  return real.filter((r): r is string => r !== undefined && !broad(r, true))
}

// The approved folders (real paths), in peek's own store: a JSON file under Claude Code's folder.
const allowedOf = async ($: $): Promise<string[]> => {
  const stored = await $.store.get('allowed').catch(() => undefined)
  return Array.isArray(stored) ? stored.filter((f): f is string => typeof f === 'string') : []
}

const secretsOf = async ($: $, from: string[]): Promise<Secrets | null> => {
  const os = await osOf($)
  const guard = await $.fs.read(join(os, $.plugin.root, GUARD)).catch(() => null)
  if (guard === null) return null
  const extra = await Promise.all(from.map(f => $.fs.read(join(os, f, '.claude/odyssey.json')).then(extraSecrets, () => [])))
  return secretsFrom(guard, extra.flat())
}

const NO_PATTERNS = `Peek shows nothing until it can read the kit's secret-file patterns from ${GUARD} in its own folder; /odyssey:setup puts that file back.`

// The deepest repo or worktree holding a path; undefined outside them.
const rootOf = (real: string, roots: readonly string[], os: Os) => roots.filter(r => isInside(real, [r], os)).sort((a, b) => b.length - a.length)[0]

const whereAmI = async ($: $) => {
  const [os, home, cwd] = await Promise.all([osOf($), homeOf($), $.session.cwd()])
  return { os, home, cwd }
}

type Place = { real: string; size: number; rel: string; isEnv: boolean; refuse?: undefined } | { refuse: string }

const place = async ($: $, typed: string): Promise<Place> => {
  const { os, home, cwd } = await whereAmI($)
  const path = absolute(os, cwd, home, typed)
  const odd = os === 'windows' ? windowsProblem(path) : null
  if (odd) return { refuse: `Peek won't open ${typed}: ${odd}.` }
  const [roots, allowed] = await Promise.all([rootsOf($), allowedOf($)])
  const secrets = await secretsOf($, [cwd, ...roots])
  if (!secrets) return { refuse: NO_PATTERNS }
  // Secret files are refused, save the .env family, which opens in the masked editor.
  if (isSecret(path, secrets) && !isEnvFile(path, secrets)) return { refuse: `Peek never shows secret files, and ${typed} matches the kit's secret-file patterns.` }
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (!stat?.realPath) return { refuse: `Peek found no file at ${typed}.` }
  if (isSecret(stat.realPath, secrets) && !isEnvFile(stat.realPath, secrets)) return { refuse: `Peek never shows secret files, and ${typed} leads to one.` }
  const isEnv = isSecret(path, secrets) || isSecret(stat.realPath, secrets)
  const isOurs = isInside(stat.realPath, roots, os)
  if (!isOurs && !isInside(stat.realPath, allowed, os)) {
    return { refuse: (await shutOf($)) ?? `Peek shows files in this repo, its worktrees and folders you approve, and ${typed} is outside them (/peek allow <folder> approves one).` }
  }
  if (isEnv && !isOurs) return { refuse: `Peek never shows secret files outside this repo, and ${typed} is one.` }
  if (stat.kind !== 'file') return { refuse: `${typed} is a folder: peek shows one file at a time.` }
  return { real: stat.realPath, size: stat.size, rel: relTo(stat.realPath, roots, os), isEnv }
}

// `path:line[:col]`: the first spelling that names a file, the path as typed first.
const locate = async ($: $, typed: string): Promise<Target> => {
  const all = targets(typed)
  if (all.length === 1) return all[0] as Target
  const { os, home, cwd } = await whereAmI($)
  for (const one of all) {
    if (await $.fs.stat(absolute(os, cwd, home, one.path)).then(() => true, () => false)) return one
  }
  return all[0] as Target
}

// --- Showing a file, or its diff -----------------------------------------------------------------------

const setView = async ($: $, next: View) => {
  const before = await read($, view)
  if (before?.path !== next.path) await update($, lens, () => FIT)
  await update($, folders, () => null)
  await update($, view, () => next)
}

// Checks the path again, then draws the page; answers a refusal, or null when it showed.
const showFile = async ($: $, typed: string, page: number | null = null, mark: Mark | null = null): Promise<string | null> => {
  const spot = await place($, typed)
  if (spot.refuse !== undefined) return spot.refuse
  await setView($, spot.isEnv ? await envView($, spot) : await load(await hostOf($), spot.real, spot.size, page, spot.rel, mark))
  return null
}

const showDiff = async ($: $, typed: string, page = 0): Promise<string | null> => {
  const { os, home, cwd } = await whereAmI($)
  const path = absolute(os, cwd, home, typed)
  const odd = os === 'windows' ? windowsProblem(path) : null
  if (odd) return `Peek won't open ${typed}: ${odd}.`
  // A deleted file has no real path; its spelling stands in, and only a path git names is diffed.
  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath ?? path
  const roots = await rootsOf($)
  const root = rootOf(real, roots, os)
  if (root === undefined) return (await shutOf($)) ?? `Peek shows the diffs of files in this repo and its worktrees, and ${typed} is outside them.`
  const secrets = await secretsOf($, [cwd, ...roots])
  if (!secrets) return NO_PATTERNS
  await setView($, await diffView(await hostOf($), root, relTo(real, [root], os), secrets, page))
  return null
}

// `by` 0: the same page again, from its top.
const turn = async ($: $, by: number) => {
  const now = await read($, view)
  if (!now) return
  const page = Math.max(0, Math.min(now.pages - 1, now.page + by))
  if (page === now.page && by) return
  const refused = now.kind === 'diff' ? await showDiff($, now.path, page) : await showFile($, now.path, page, now.mark)
  if (refused) $.ui.toast(refused)
}

// --- The lists: the repo's files, or what changed ------------------------------------------------------

// Files Claude's tools touched this session, still in the repo, its worktrees or an approved folder,
// and not secret.
const sessionFiles = async ($: $, roots: string[], allowed: string[], secrets: Secrets, now: number, os: Os): Promise<Pick[]> => {
  const files: Pick[] = []
  for (const one of (await read($, touched)).slice(0, 30)) {
    const stat = await $.fs.stat(one.path, { resolve: true }).catch(() => undefined)
    const real = stat?.realPath
    if (!real || stat.kind !== 'file' || isSecret(one.path, secrets) || isSecret(real, secrets) || !isInside(real, [...roots, ...allowed], os)) continue
    if (files.some(f => sameForm(os, f.value) === sameForm(os, real))) continue
    const rel = relTo(real, roots, os)
    files.push({ value: real, label: `${rel} · this session, ${one.verb} ${since(now - one.at)} ago`, rel })
  }
  return files
}

// When each file last changed: one listing per folder (no per-file call, no shell), up to
// FOLDERS_MAX folders; files in folders past that are listed undated.
const datesOf = async ($: $, root: string, names: string[], os: Os): Promise<Map<string, number>> => {
  const byFolder = new Map<string, string[]>()
  for (const name of names) {
    const cut = name.lastIndexOf('/')
    const folder = cut < 0 ? '' : name.slice(0, cut)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), name])
  }
  const dates = new Map<string, number>()
  const all = [...byFolder.keys()]
  await Promise.all(all.slice(0, FOLDERS_MAX).map(async folder => {
    const entries = await $.fs.list(folder ? join(os, root, folder) : root).catch(() => [])
    for (const entry of entries) if (entry.kind !== 'dir') dates.set(folder ? `${folder}/${entry.name}` : entry.name, entry.mtimeMs)
  }))
  for (const folder of all.slice(FOLDERS_MAX)) for (const name of byFolder.get(folder) ?? []) dates.set(name, 0)
  return dates
}

const topOf = async ($: $): Promise<string | null> => {
  const top = (await git(await hostOf($), ['rev-parse', '--show-toplevel'], undefined, 10_000)).out?.trim()
  if (!top) return null
  return (await $.fs.stat(top, { resolve: true }).catch(() => undefined))?.realPath ?? top
}

// When this session's repo, or its folder outside one, is too broad for peek: the line saying so.
const shutOf = async ($: $): Promise<string | null> => {
  const top = (await topOf($)) ?? (await realOf($, await $.session.cwd()))
  const why = (await broadOf($))(top, true)
  return why ? `Peek shows no files from ${top}: it is ${why}. Start Claude Code in a project folder, or approve one with /peek allow <folder>.` : null
}

// This session's files, then the repo's newest; and every repo file (tracked, and untracked but
// not ignored) for the filter to search, newest first. Secret files are never listed.
const fileList = async ($: $): Promise<Picker> => {
  const os = await osOf($)
  const root = (await topOf($)) ?? (await $.session.cwd())
  const shut = await shutOf($)
  const [listed, secrets, now, roots, allowed] = await Promise.all([
    shut ? { out: '' } : git(await hostOf($), ['ls-files', '-co', '--exclude-standard', '-z'], root, 20_000),
    secretsOf($, [root]),
    $.clock.now(),
    rootsOf($),
    allowedOf($),
  ])
  if (!secrets) return { mode: 'files', files: [], index: [], root, more: 0, note: NO_PATTERNS }
  const mine = await sessionFiles($, roots, allowed, secrets, now, os)
  const names = [...new Set((listed.out ?? '').split('\0'))].filter(n => n && !isSecret(n, secrets))
  const dates = await datesOf($, root, names.slice(0, INDEX_MAX), os)
  const index = names.slice(0, INDEX_MAX).filter(n => dates.has(n)).sort((a, b) => (dates.get(b) ?? 0) - (dates.get(a) ?? 0))
  const seen = new Set(mine.map(f => sameForm(os, f.value)))
  const recent = index
    .filter(n => !seen.has(sameForm(os, join(os, root, n))))
    .slice(0, ROWS_MAX)
    .map(n => ({ value: join(os, root, n), label: `${n} · ${since(now - (dates.get(n) || now))}`, rel: n }))
  const files = [...mine, ...recent]
  const skipped = names.length > INDEX_MAX ? `The filter searches the first ${INDEX_MAX.toLocaleString('en-US')} files of ${names.length.toLocaleString('en-US')}.` : null
  const note = shut ?? (files.length ? skipped : (listed.why ?? 'No files in this repo to pick from.'))
  return { mode: 'files', files, index, root, more: Math.max(0, index.length - recent.length), note }
}

const changeList = async ($: $): Promise<Picker> => {
  const root = await topOf($)
  if (root === null) return { mode: 'diff', files: [], index: [], root: '', more: 0, note: 'Not in a git repo, so there is no diff to show.' }
  const shut = await shutOf($)
  if (shut) return { mode: 'diff', files: [], index: [], root, more: 0, note: shut }
  const secrets = await secretsOf($, [root])
  if (!secrets) return { mode: 'diff', files: [], index: [], root, more: 0, note: NO_PATTERNS }
  return diffList(await hostOf($), root, secrets)
}

// The rows the list shows for what is typed in the filter: case ignored, anywhere in the path;
// this session's files first, then the repo's newest. At most ROWS_MAX, and how many more match.
const rowsOf = (list: Picker | null, typed: string, os: Os): { rows: Pick[]; more: number } => {
  if (!list) return { rows: [], more: 0 }
  const q = typed.trim().toLowerCase()
  if (list.mode === 'diff' || !q) return { rows: list.files, more: list.more }
  const rows: Pick[] = []
  const seen = new Set<string>()
  let total = 0
  const take = (pick: Pick) => {
    total++
    if (rows.length < ROWS_MAX) rows.push(pick)
  }
  for (const f of list.files) {
    if (!f.rel.toLowerCase().includes(q)) continue
    seen.add(sameForm(os, f.value))
    take(f)
  }
  for (const name of list.index) {
    if (!name.toLowerCase().includes(q)) continue
    const value = join(os, list.root, name)
    if (!seen.has(sameForm(os, value))) take({ value, label: name, rel: name })
  }
  return { rows, more: total - rows.length }
}

// --- Moving between the list and a file, in the one pane -------------------------------------------------
// The list's place while a file is open from it: the row last focused or opened, and the window's
// offset. Module memory: a reload starts the list at its top.
let chosen: string | null = null
let listOffset = 0
let restoring: number | null = null // the offset our next scroll puts back, taken by the ui.scroll hook

const rowKey = (mode: Picker['mode'], path: string) => `${mode === 'diff' ? 'diff' : 'file'}:${path}`

const titleOf = (shown: View | null, list: Picker | null, box: Folders | null) =>
  shown
    ? `${EMBLEM} ${nameOf(shown.path)}${shown.kind === 'diff' ? ' · diff' : ''}`
    : `${EMBLEM} ${box ? 'Approved folders' : list?.mode === 'diff' ? 'Changes' : 'Peek'}`

// Opens the pane on what the state holds, or retitles it when open. Pictures and PDF pages open as
// tall as the layout spares; the rest at the default. The .env editor keeps the pane on Esc, so an
// unsaved change isn't lost to it.
const seat = async ($: $, focus?: true) => {
  const [shown, list, box] = await Promise.all([read($, view), read($, picker), read($, folders)])
  const kind = shown?.kind === 'file' ? kindOf(shown.path) : 'text'
  const rows = kind === 'image' || kind === 'pdf' ? { rows: 200 } : {}
  const onEscape = shown?.body?.as === 'env' ? {} : { closeOnEscape: true as const }
  return $.ui.open({ id: PANE, title: titleOf(shown, list, box), ...(focus && { focus }), ...onEscape, ...rows })
}

// A row clicked, or Enter on it: the file, or its diff, opens in this pane.
const open = async ($: $, pick: Pick, mode: Picker['mode']) => {
  chosen = pick.value
  const refused = mode === 'diff' ? await showDiff($, pick.value) : await showFile($, pick.value)
  if (refused) return $.ui.toast(refused)
  await seat($)
}

// Enter in the filter: the first row it matches.
const openFirst = async ($: $, typed: string) => {
  const [list, os] = await Promise.all([read($, picker), osOf($)])
  const first = rowsOf(list, typed, os).rows[0]
  if (first) await open($, first, list?.mode ?? 'files')
  else $.ui.toast(`No file matches "${typed}".`)
}

// ← back (b) or ✕: an .env editor with unsaved edits asks first. Back shows the list again (the
// changes, from a diff), its rows read afresh, the filter kept, the row last opened focused and the
// window where it was.
const leave = async ($: $, to: 'back' | 'close', isSure = false) => {
  const shown = await read($, view)
  const isEnv = shown?.body?.as === 'env'
  if (isEnv && editor?.isDirty && !isSure) return changeEnv($, ed => void ((ed.leaving = to), (ed.deleting = null)))
  if (to === 'close') await $.ui.close({ id: PANE })
  else {
    const mode = shown?.kind === 'diff' ? 'diff' : 'files'
    const list = mode === 'diff' ? await changeList($) : await fileList($)
    await update($, picker, () => list)
    await update($, view, () => null)
    await update($, folders, () => null)
    await seat($)
    const { rows } = rowsOf(list, mode === 'files' ? await read($, query) : '', await osOf($))
    if (rows.some(f => f.value === chosen)) await $.ui.focus({ requestId: PANE, key: rowKey(mode, chosen ?? '') }).catch(() => undefined)
    restoring = listOffset
    await $.ui.scroll({ to: 'start', in: PANE }).catch(() => undefined)
  }
  if (isEnv) editor = null // the values leave memory; the file is read again when opened
}

// --- Approved folders ------------------------------------------------------------------------------------
// A folder outside the repo is approved by name, after the pane shows where it really leads and the
// person says yes. Kept in peek's store (Claude Code's folder, never the repo), as real paths.

const showFolders = async ($: $, asking: string | null = null, note: string | null = null) => {
  const list = await allowedOf($)
  await update($, view, () => null)
  await update($, folders, () => ({ asking, list, note }))
}

const askAllow = async ($: $, typed: string): Promise<string | null> => {
  const { os, home, cwd } = await whereAmI($)
  const path = absolute(os, cwd, home, typed)
  const odd = os === 'windows' ? windowsProblem(path) : null
  if (odd) return `Peek won't approve ${typed}: ${odd}.`
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (!stat?.realPath) return `Peek found no folder at ${typed}.`
  if (stat.kind !== 'dir') return `${typed} is a file: approve the folder that holds it.`
  const broad = (await broadOf($))(stat.realPath)
  if (broad) return `Peek won't approve ${stat.realPath}: it is ${broad}.`
  if (isInside(stat.realPath, await rootsOf($), os)) return `${stat.realPath} is in this repo already: peek shows it without approval.`
  await showFolders($, stat.realPath)
  return null
}

const answerAllow = async ($: $, isYes: boolean) => {
  const [box, os] = await Promise.all([read($, folders), osOf($)])
  const asking = box?.asking
  if (!asking) return
  if (!isYes) return showFolders($, null, `Not approved: ${asking}.`)
  const list = await allowedOf($)
  const kept = list.some(f => sameForm(os, f) === sameForm(os, asking)) ? list : [...list, asking]
  await $.store.set('allowed', kept)
  await showFolders($, null, `Approved: peek may show files in ${asking}. Secret files there stay refused.`)
}

const disallow = async ($: $, typed: string): Promise<string> => {
  if (!typed) return 'Name the folder: /peek disallow <folder>.'
  const { os, home, cwd } = await whereAmI($)
  const path = absolute(os, cwd, home, typed)
  // A folder that no longer exists is matched by its spelling.
  const real = (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath ?? path
  const list = await allowedOf($)
  const gone = list.filter(f => [real, path].some(p => sameForm(os, p) === sameForm(os, f)))
  if (!gone.length) return `${typed} isn't an approved folder (/peek allow lists them).`
  const kept = list.filter(f => !gone.includes(f))
  await $.store.set('allowed', kept)
  if (await read($, folders)) await update($, folders, () => ({ asking: null, list: kept, note: `No longer approved: ${gone.join(', ')}.` }))
  return `Peek no longer shows files in ${gone.join(', ')}.`
}

// --- The masked .env editor: the one exception to the secret refusal ----------------------------------
// Values live here, in the module, and in the pane while shown: never in $.state, a prompt, a toast,
// a log line or any file but the .env itself. A hot reload drops them; the file is read again.

type Editor = {
  path: string
  doc: EnvDoc
  selected: number | null // the key row the focus ring last stood on
  revealed: number | null // shown in clear until the ring moves away
  editing: number | 'new' | null
  deleting: number | null
  leaving: 'back' | 'close' | null // asking before unsaved edits are left
  isDirty: boolean
  problem: string | null // a plain line, never holding a value
}
let editor: Editor | null = null

const fresh = (path: string, doc: EnvDoc): Editor => {
  const first = doc.lines.findIndex(l => l.key !== undefined)
  return { path, doc, selected: first < 0 ? null : first, revealed: null, editing: null, deleting: null, leaving: null, isDirty: false, problem: null }
}

const envView = async ($: $, spot: { real: string; size: number; rel: string }): Promise<View> => {
  const bytes = bytesLine(spot.size)
  const base: View = { kind: 'file', path: spot.real, rel: spot.rel, info: bytes, page: 0, pages: 1, body: null, note: null, mark: null }
  try {
    const doc = parseEnv(await rawTextOf(await hostOf($), spot.real, spot.size))
    editor = fresh(spot.real, doc)
    const keys = doc.lines.filter(l => l.key !== undefined).length
    return { ...base, info: `${keys} key${keys === 1 ? '' : 's'} · ${bytes}`, body: { as: 'env' } }
  } catch (error) {
    return { ...base, note: error instanceof Error ? error.message : String(error) }
  }
}

const redraw = ($: $) => $.ui.invalidate('ui.render')

const editorFor = async ($: $, path: string): Promise<Editor | null> => {
  if (editor?.path === path) return editor
  // After a hot reload the file is read again, so it passes the open's checks again: it may be a link now.
  const spot = await place($, path)
  if (spot.refuse !== undefined || !spot.isEnv || spot.real !== path) return null
  const text = await $.fs.read(path).catch(() => null)
  if (text === null) return null
  editor = fresh(path, parseEnv(text))
  return editor
}

const changeEnv = ($: $, change: (ed: Editor) => void) => {
  if (!editor) return
  change(editor)
  redraw($)
}

// Atomic on every OS (tools.ts says how on each): the old file or the new one, never half of each.
const saveEnv = async ($: $) => {
  const ed = editor
  if (!ed) return
  const why = await saveAtomic(await hostOf($), ed.path, serializeEnv(ed.doc))
  changeEnv($, e => {
    e.problem = why ? `Not saved: ${why}.` : null
    e.isDirty = !!why
  })
  if (!why) $.ui.toast(`Saved ${nameOf(ed.path)}`)
}

// --- What Claude touched this session, and the band after it writes -------------------------------------

const VERBS: Record<string, Touched['verb']> = { Read: 'read', Write: 'wrote', Edit: 'edited', MultiEdit: 'edited', NotebookEdit: 'edited' }
const WRITES = new Set(['Write', 'Edit', 'MultiEdit'])
const BAND_MS = 120_000 // the band goes after two minutes, or with the next prompt

let bandTimer: Timer | null = null

const track = async ($: $, path: string, tool: string) => {
  const at = await $.clock.now()
  const verb = VERBS[tool] ?? 'read'
  await update($, touched, list => [{ path, verb, at }, ...list.filter(t => t.path !== path)].slice(0, 200))
  if (!WRITES.has(tool)) return
  const spot = await place($, path)
  if (spot.refuse !== undefined || spot.isEnv) return
  await update($, wrote, was => ({ files: [{ path: spot.real, rel: spot.rel }, ...(was?.files ?? []).filter(f => f.path !== spot.real)], at }))
  bandTimer?.cancel()
  bandTimer = $.clock.after(BAND_MS, () => void update($, wrote, () => null))
}

// --- Opening the pane ------------------------------------------------------------------------------------

type Ask =
  | { to: 'list' }
  | { to: 'file'; typed: string }
  | { to: 'diff'; typed: string | null }
  | { to: 'allow'; typed: string | null }
  | { to: 'disallow'; typed: string }

const unquote = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, '$2')

// `/peek`, `/peek <path>[:line[:col]]`, `/peek diff [path]`, `/peek allow [folder]`, `/peek disallow
// <folder>`. A file named diff, allow or disallow opens as ./diff.
const askOf = (args: string): Ask => {
  const [, word = '', rest = ''] = /^(\S*)\s*([\s\S]*)$/.exec(args.trim()) ?? []
  if (word === 'diff') return { to: 'diff', typed: unquote(rest) || null }
  if (word === 'allow') return { to: 'allow', typed: unquote(rest) || null }
  if (word === 'disallow') return { to: 'disallow', typed: unquote(rest) }
  const typed = unquote(args)
  return typed ? { to: 'file', typed } : { to: 'list' }
}

// Shows what was asked for and opens the pane on it; answers the command's line.
const present = async ($: $, ask: Ask): Promise<string> => {
  let said: string
  if (ask.to === 'disallow') return disallow($, ask.typed)
  if (ask.to === 'file') {
    const target = await locate($, ask.typed)
    const refused = await showFile($, target.path, null, target.line ? { line: target.line, col: target.col } : null)
    if (refused) return refused
    said = `Peek: ${ask.typed}`
  } else if (ask.to === 'diff' && ask.typed) {
    const refused = await showDiff($, ask.typed)
    if (refused) return refused
    said = `Peek: the diff of ${ask.typed}`
  } else if (ask.to === 'allow') {
    const refused = ask.typed ? await askAllow($, ask.typed) : (await showFolders($), null)
    if (refused) return refused
    said = ask.typed ? 'Peek: approve this folder?' : 'Peek: approved folders'
  } else {
    const list = ask.to === 'diff' ? await changeList($) : await fileList($)
    await update($, view, () => null)
    await update($, folders, () => null)
    await update($, query, () => '')
    await update($, picker, () => list)
    said = ask.to === 'diff' ? 'Peek: what changed' : 'Peek: pick a file'
  }
  const shown = await read($, view)
  if (shown) chosen = shown.path // back from it lands on its row
  const opened = await seat($, true)
  if (!opened.isPlaced) return `Peek is open but waiting: ${opened.reason}`
  return said
}

const fromBand = async ($: $, as: 'file' | 'diff') => {
  const was = await read($, wrote)
  await update($, wrote, () => null)
  const files = was?.files ?? []
  const last = files[0]
  if (!last) return
  const said = as === 'diff' ? await present($, { to: 'diff', typed: last.path }) : await present($, files.length === 1 ? { to: 'file', typed: last.path } : { to: 'list' })
  if (!said.startsWith('Peek:')) $.ui.toast(said)
}

// `e`: Claude makes the edit, with its own tools (so the kit's guards check it), in one normal turn.
// The API can fill the prompt but has no call that hands it the keys; closing the pane does, and the
// pane opens again at once without them, so the file stays in view.
const EDITABLE: ReadonlySet<Kind> = new Set<Kind>(['markdown', 'text', 'json', 'csv', 'tsv', 'html'])

const askEdit = async ($: $, shown: View) => {
  const draft = (await $.prompt.read()).text
  const text = `In ${shown.rel}: `
  const filled = await $.prompt.fill(draft.trim() ? { text: `\n${text}`, mode: 'append' } : { text })
  if (!filled.isFilled) return $.ui.toast("Peek couldn't put the edit in the prompt (a dialog holds the keys?).")
  await $.ui.close({ id: PANE })
  await $.ui.open({ id: PANE, title: titleOf(shown, null, null) })
}

// The block preview's pixels, decoded once per picture rather than on every redraw.
let decoded: { key: string; image: Image } | null = null
const imageOf = (path: string, pixels: Pixels): Image => {
  const key = `${path}:${pixels.width}x${pixels.height}:${pixels.rgba.length}`
  if (decoded?.key !== key) decoded = { key, image: { width: pixels.width, height: pixels.height, rgba: fromBase64(pixels.rgba) } }
  return decoded.image
}

// --- The hooks -------------------------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'peek',
      description: "Show a file of this repo in a pane, or what changed; /peek alone picks a file",
      argumentHint: '[path[:line] | diff [path] | allow [folder] | disallow folder]',
      immediate: true,
    })
    isSupported = !(await tooOld($))
    return next(e)
  })

  on('command.run', { command: 'peek' }, async ($, e) => {
    const old = await tooOld($)
    return { text: old ?? (await present($, askOf(e.args))) }
  })

  // What Claude's file tools touched, once each call has succeeded; noted after, never in its way.
  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    const tool = String(e.tool)
    const input = e as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
    if (isSupported && VERBS[tool] && path && done.deny === undefined && !done.isError) void track($, path, tool)
    return done
  })

  // The band goes with the next prompt.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, wrote)) await update($, wrote, () => null)
    return next(e)
  })

  // The .env editor's selection is wherever the focus ring stands; a revealed value is masked again
  // as soon as the ring moves off it.
  on('ui.focus', async ($, e, next) => {
    const moved = await next(e)
    const row = /^(?:file|diff):([\s\S]+)$/.exec(e.element ?? '')
    if (e.requestId === PANE && row && !moved.deny) chosen = row[1] ?? null
    const envRow = /^env:(\d+)$/.exec(e.element ?? '')
    if (e.requestId === PANE && editor) {
      const at = envRow ? Number(envRow[1]) : null
      changeEnv($, ed => {
        if (at !== null) ed.selected = at
        if (ed.revealed !== null && ed.revealed !== at) ed.revealed = null
      })
    }
    return moved
  })

  // The list's window: noted as it moves, and put back where it was when `leave` returns to it.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    const offset = e.origin.kind === 'plugin' ? (restoring ?? e.offset) : e.offset
    if (e.origin.kind === 'plugin') restoring = null
    const moved = await next(offset === e.offset ? e : { ...e, offset })
    if (!moved.deny && !(await read($, view))) listOffset = offset
    return moved
  })

  // One line above the prompt after Claude writes, drawn with whatever the plugins beneath draw
  // there (another mod's line, a glow), never instead of it. A band Button takes a digit from the
  // prompt (a letter there is typed), so peek is 1 and the diff 2.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const was = await read($, wrote)
    if (e.props.hasSurvey || !was?.files.length) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const last = nameOf(was.files[0]?.rel ?? '')
    const what = was.files.length === 1 ? last : `${was.files.length} files`
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text>{`${EMBLEM} wrote ${what} ·`}</Text>
          <Button key="peek-wrote" plain hotkey="1" label="peek" onPress={() => void fromBand($, 'file')} />
          <Button key="peek-diff" plain hotkey="2" label={was.files.length === 1 ? 'diff' : `diff of ${last}`} onPress={() => void fromBand($, 'diff')} />
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text>Peek draws in the terminal.</Text>
    }
    const { Box, Text, Button, Markdown, Code, Input } = $.ui.resolve(e)
    const [shown, list, box, typed, picture, zoom, home, os] = await Promise.all([
      read($, view), read($, picker), read($, folders), read($, query), read($, isPicture), read($, lens), homeOf($), osOf($),
    ])
    // The live size: a resize (keys or a drag) draws the pane again with new props.
    const wide = Math.max(1, Math.min(512, e.props.bodyColumns))
    const tall = Math.max(4, Math.min(256, e.props.scroll.bodyRows - 8))
    // The footer: while the pane holds the keyboard, the keys no Button shows; without it a letter
    // lands in the prompt, so it says how to hand the pane the keys instead.
    const focused = e.props.isFocused
    const footer = (keys: string[], esc = 'Esc closes') => (
      <Text dimColor={focused} wrap="truncate-end">
        {(focused
          ? [...keys, esc, e.props.placement === 'dock' ? 'ctrl+x ←→ width' : 'ctrl+x ↑↓ height']
          : ["ctrl+x tab for peek's keys", 'ctrl+x x close']).join(' · ')}
      </Text>
    )
    const close = <Button key="close" plain role="dismiss" label="✕" onPress={() => void leave($, 'close')} />
    const header = (title: string) => (
      <Box gap={1}>
        <Box flexGrow={1}><Text bold>{`${EMBLEM} ${title}`}</Text></Box>
        {close}
      </Box>
    )

    if (!shown && box) {
      return (
        <Box flexDirection="column">
          {header('Approved folders')}
          {box.asking && (
            <Box flexDirection="column" marginTop={1}>
              <Text>Let peek show files in this folder?</Text>
              <Text bold>{box.asking}</Text>
              <Text dimColor>That is where it really leads, every link followed. Secret files there stay refused.</Text>
              <Box gap={2} marginTop={1}>
                <Button key="allow-yes" plain hotkey="y" label="yes" onPress={() => void answerAllow($, true)} />
                <Button key="allow-no" plain hotkey="n" label="no" onPress={() => void answerAllow($, false)} />
              </Box>
            </Box>
          )}
          {box.note && <Text color={box.note.startsWith('Approved') ? undefined : WARN}>{box.note}</Text>}
          {!box.asking && (
            <Box flexDirection="column" marginTop={1}>
              {box.list.length
                ? box.list.map(f => <Text key={`folder:${f}`}>{f}</Text>)
                : <Text dimColor>No approved folders yet: /peek allow {'<folder>'} adds one.</Text>}
              {!!box.list.length && <Text dimColor>/peek disallow {'<folder>'} removes one.</Text>}
            </Box>
          )}
          {footer([])}
        </Box>
      )
    }

    if (!shown) {
      // Buttons, not a Select: a Select picks by keys alone, a Button takes a click too.
      const mode = list?.mode ?? 'files'
      const filter = mode === 'files' ? typed : ''
      const { rows, more } = rowsOf(list, filter, os)
      const back = rows.some(f => f.value === chosen) ? chosen : null // the row to return to
      const canFilter = mode === 'files' && !!list && (list.files.length > 0 || list.index.length > 0)
      return (
        <Box flexDirection="column">
          {header(mode === 'diff' ? 'Changes against HEAD' : 'Peek')}
          {!list && <Text dimColor>Type /peek and a path, or /peek alone to pick a file.</Text>}
          {canFilter && (
            <Input key="filter" label="filter " placeholder="part of a path" value={filter} submitLabel="open the first" autoFocus={back ? undefined : true}
              onInput={value => void update($, query, () => value)} onSubmit={value => void openFirst($, value)} />
          )}
          {list && !rows.length && <Text>{filter.trim() ? `No file matches "${filter.trim()}".` : (list.note ?? 'No files to pick from.')}</Text>}
          {!!rows.length && !filter.trim() && (
            <Text dimColor>{mode === 'diff' ? 'Staged, unstaged and new files, each against HEAD' : "This session's files first, then the repo's, newest first"}</Text>
          )}
          {!!rows.length && list?.note && <Text dimColor>{list.note}</Text>}
          <Box marginTop={1} flexDirection="column">
            {rows.map(f => (
              <Button key={rowKey(mode, f.value)} plain label={f.label} autoFocus={f.value === back ? true : undefined} onPress={() => void open($, f, mode)} />
            ))}
          </Box>
          {more > 0 && <Text dimColor>{filter.trim() ? `${more} more: type more to narrow it` : mode === 'diff' ? `${more} more` : `${more} more: type to search them`}</Text>}
          {footer(rows.length ? [...(canFilter ? ['Type to filter'] : []), 'Tab moves', 'Enter or a click opens'] : [])}
        </Box>
      )
    }

    const body = shown.body
    let drawn = <Text dimColor>Nothing to show.</Text>
    let lensLine: string | null = null
    const keys: JSX.Element[] = []
    const hints: string[] = [] // the footer's names for this view's keys that no Button shows
    if (body?.as === 'env') {
      const ed = await editorFor($, shown.path)
      if (!ed) drawn = <Text color={WARN}>Peek couldn't read the file again.</Text>
      else {
        const first = ed.doc.lines.findIndex(l => l.key !== undefined)
        const rows = ed.doc.lines.map((line, i) => {
          if (ed.editing === i) {
            return <Input key="env-value" autoFocus label={`${line.key} = `} value={line.value ?? ''} submitLabel="keep" onSubmit={value => changeEnv($, x => {
              x.editing = null
              if (value === line.value) return // unchanged: the line keeps its bytes as written
              if (!isWritable(value)) x.problem = `Not kept: ${UNWRITABLE}.`
              else {
                x.doc.lines[i] = setValue(line, value)
                x.problem = null
                x.isDirty = true
              }
            })} />
          }
          if (line.key === undefined) return <Text dimColor>{clean(maskedRow(line)) || ' '}</Text>
          const label = ed.revealed === i && !line.isLocked ? `${line.key} = ${clean(line.value ?? '')}` : maskedRow(line)
          const edit = () => changeEnv($, x => void (x.editing = line.isLocked ? null : i))
          return <Button key={`env:${i}`} plain label={label} autoFocus={i === first ? true : undefined} onPress={edit} />
        })
        const selected = ed.selected === null ? undefined : ed.doc.lines[ed.selected]
        drawn = (
          <Box flexDirection="column">
            {rows}
            {ed.editing === 'new' && <Input key="env-new" autoFocus label="add " placeholder="KEY=value" submitLabel="add" onSubmit={typedLine => changeEnv($, x => {
              const line = newLine(typedLine)
              const why = !line ? 'type KEY=value, the key in letters, digits and _' : isWritable(line.value ?? '') ? null : UNWRITABLE
              x.problem = why && `Not added: ${why}.`
              if (line && !why) x.doc.lines.push(line)
              x.isDirty ||= !why
              x.editing = null
            })} />}
            {ed.deleting !== null && (
              <Box gap={2}>
                <Text color={WARN}>{`Delete ${ed.doc.lines[ed.deleting]?.key ?? 'it'}?`}</Text>
                <Button key="yes" plain hotkey="y" label="yes" onPress={() => changeEnv($, x => {
                  if (x.deleting !== null) x.doc.lines.splice(x.deleting, 1)
                  x.deleting = null
                  x.selected = x.revealed = null
                  x.isDirty = true
                })} />
                <Button key="no" plain hotkey="n" label="no" onPress={() => changeEnv($, x => void (x.deleting = null))} />
              </Box>
            )}
            {ed.leaving && (
              <Box gap={2}>
                <Text color={WARN}>{`Unsaved changes. ${ed.leaving === 'back' ? 'Go back' : 'Close'} without saving?`}</Text>
                <Button key="leave-yes" plain hotkey="y" label="yes" onPress={() => void leave($, ed.leaving ?? 'back', true)} />
                <Button key="leave-no" plain hotkey="n" label="no" onPress={() => changeEnv($, x => void (x.leaving = null))} />
              </Box>
            )}
            {ed.problem && <Text color={WARN}>{ed.problem}</Text>}
            <Text dimColor>{`Values stay in this pane (${MASK}); nothing here reaches Claude. ${ed.isDirty ? 'Unsaved changes: w saves.' : 'Enter edits the selected key.'}`}</Text>
          </Box>
        )
        if (selected?.key !== undefined && !selected.isLocked) {
          keys.push(<Button key="reveal" plain hotkey="v" label={ed.revealed === ed.selected ? 'hide' : `reveal ${selected.key}`} onPress={() => changeEnv($, x => void (x.revealed = x.revealed === x.selected ? null : x.selected))} />)
        }
        keys.push(<Button key="add" plain hotkey="a" label="add a key" onPress={() => changeEnv($, x => void (x.editing = 'new'))} />)
        if (selected?.key !== undefined) keys.push(<Button key="delete" plain hotkey="d" label={`delete ${selected.key}`} onPress={() => changeEnv($, x => void ((x.deleting = x.selected), (x.leaving = null)))} />)
        keys.push(<Button key="save" plain hotkey="w" label="save" variant={ed.isDirty ? 'primary' : undefined} onPress={() => void saveEnv($)} />)
        hints.push('Enter edits')
      }
    }
    // `e` on a text file: Claude makes the change in a normal turn.
    if (shown.kind === 'file' && (body?.as === 'markdown' || body?.as === 'code') && EDITABLE.has(kindOf(shown.path))) {
      keys.push(<Button key="edit" plain hotkey="e" label="edit · 1 Claude turn" onPress={() => void askEdit($, shown)} />)
    }
    if (body?.as === 'markdown') drawn = <Markdown text={body.text} />
    let hidden = false // the page has lines above the window: p shows it from its top
    if (body?.as === 'code') {
      // Wrapped here at whole words, our own gutter beside the rows, so a resize re-wraps. A line the
      // file opened at is drawn in a part of its own, keyed and marked. Opened there, the page is drawn
      // from up to CONTEXT lines above it, as many as fit under the rows over the code (header, info,
      // a note, the gap, the hint), so the line shows in the first frame at any height, unscrolled.
      const lines = body.text.split('\n')
      const at = shown.mark ? shown.mark.line - body.start : -1
      const digits = String(body.start + lines.length - 1).length
      const room = e.props.scroll.bodyRows - 5 - (shown.note ? Math.ceil(shown.note.length / wide) : 0)
      const top = shown.isAtMark && at >= 0 && at < lines.length ? at - contextAbove(lines, at, wide, digits, room, CONTEXT) : 0
      hidden = top > 0
      const part = (from: number, to: number, isMarked = false) => {
        const { gutter, rows } = wrapNumbered(lines.slice(from, to).join('\n'), body.start + from, wide, digits)
        return (
          <Box key={isMarked ? 'mark' : `part:${from}`}>
            <Text dimColor={!isMarked} color={isMarked ? MARK : undefined} bold={isMarked}>{gutter}</Text>
            <Text color={MARK} bold>{isMarked ? '▶' : ' '}</Text>
            <Code source={rows} path={body.path} wrap="truncate-end" />
          </Box>
        )
      }
      const { gutter, rows } = wrapNumbered(body.text, body.start, wide)
      drawn = rows.split('\n').length > 9_800
        ? <Code source={body.text} startLine={body.start} path={body.path} />
        : at >= 0 && at < lines.length
          ? (
            <Box flexDirection="column">
              {shown.isAtMark && body.start + top > 1 && <Text dimColor wrap="truncate-end">{`↑ lines 1–${body.start + top - 1} above · p pages up`}</Text>}
              {at > top && part(top, at)}
              {part(at, at + 1, true)}
              {at + 1 < lines.length && part(at + 1, lines.length)}
            </Box>
          )
          : (
            <Box>
              <Text dimColor>{gutter}</Text>
              <Box marginLeft={1}><Code source={rows} path={body.path} wrap="truncate-end" /></Box>
            </Box>
          )
    }
    if (body?.as === 'diff') {
      // Added lines green, removed red, each hunk's header blue; the rest as written.
      drawn = (
        <Box flexDirection="column">
          {diffRuns(body.text).map((run, i) =>
            run.kind === 'same' || run.kind === 'note'
              ? <Text key={`run:${i}`} dimColor={run.kind === 'note'} wrap="wrap">{run.text || ' '}</Text>
              : <Text key={`run:${i}`} color={DIFF[run.kind]} wrap="wrap">{run.text}</Text>,
          )}
        </Box>
      )
    }
    if (body?.as === 'text') drawn = <Text wrap="wrap">{body.text}</Text>
    if ((body?.as === 'image' || body?.as === 'audio') && e.surface !== 'terminal') drawn = <Text dimColor>Pictures draw in the terminal only.</Text>
    if ((body?.as === 'image' || body?.as === 'audio') && e.surface === 'terminal') {
      const { Raster, Image } = $.ui.resolve(e)
      if (body.as === 'image' && picture && body.png) {
        let columns = wide
        let rows = Math.max(1, Math.round((columns * body.height) / Math.max(1, body.width) / 2))
        if (rows > tall) {
          rows = tall
          columns = Math.max(1, Math.min(wide, Math.round((rows * 2 * body.width) / Math.max(1, body.height))))
        }
        const alt = "This terminal can't draw the full picture (it needs the kitty image protocol). Press r for the block preview."
        const source = { png: body.png }
        drawn = <Image key="picture" source={source} columns={columns} rows={rows} alt={alt} />
      } else if (body.pixels) {
        const px = imageOf(shown.path, body.pixels)
        const sight = body.as === 'audio' ? FIT : zoom
        const f = frame(px.width, px.height, wide, body.as === 'audio' ? 12 : tall, sight)
        drawn = <Raster key="preview" columns={f.columns} rows={f.rows} cells={cellsOf(px, f)} />
        if (body.as === 'image') {
          const span = (from: number, size: number) => `${Math.round(from)}–${Math.round(from + size)}`
          lensLine = `zoom ${f.step ? `${Math.round(f.scale * 100)}%` : `fit (${Math.round(f.scale * 100)}%)`} · pixels ${span(f.left, f.width)} × ${span(f.top, f.height)} of ${px.width} × ${px.height}`
          const set = (next: (was: Lens) => Lens) => () => void update($, lens, next)
          const step = (by: number) => set(was => ({ ...was, step: Math.max(0, Math.min(f.steps, frame(px.width, px.height, wide, tall, was).step + by)) }))
          const move = (dx: number, dy: number) => set(was => pan(px.width, px.height, wide, tall, was, dx, dy))
          if (f.step < f.steps) keys.push(<Button key="in" plain hotkey="z" label="zoom in" onPress={step(1)} />)
          if (f.step > 0) keys.push(<Button key="out" plain hotkey="x" label="zoom out" onPress={step(-1)} />)
          if (f.step > 0) keys.push(<Button key="fit" plain hotkey="0" label="fit" onPress={set(() => FIT)} />)
          if (f.width < px.width) {
            keys.push(<Button key="left" plain hotkey="h" label="left" onPress={move(-1, 0)} />)
            keys.push(<Button key="right" plain hotkey="l" label="right" onPress={move(1, 0)} />)
          }
          if (f.height < px.height) {
            keys.push(<Button key="up" plain hotkey="k" label="up" onPress={move(0, -1)} />)
            keys.push(<Button key="down" plain hotkey="j" label="down" onPress={move(0, 1)} />)
          }
        }
      }
      if (body.as === 'image') {
        keys.push(<Button key="picture" plain hotkey="r" label={picture ? 'block preview' : 'try the picture'} onPress={() => void update($, isPicture, was => !was)} />)
      }
    }

    const homeForm = home ? sameForm(os, home) : ''
    const where = homeForm && sameForm(os, shown.path).startsWith(`${homeForm}/`) ? `~${shown.path.slice(home.length)}` : shown.path
    const pages = shown.pages > 1 ? ` · page ${shown.page + 1} of ${shown.pages}` : ''
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Button key="back" plain hotkey="b" label="← back" onPress={() => void leave($, 'back')} />
          <Box flexGrow={1}><Text bold wrap="truncate-start">{`${EMBLEM} ${where}${shown.kind === 'diff' ? ' · diff' : ''}`}</Text></Box>
          {close}
        </Box>
        <Text dimColor wrap="truncate-end">{shown.info + pages}</Text>
        {lensLine && <Text dimColor wrap="truncate-end">{lensLine}</Text>}
        {shown.note && <Text color={WARN}>{shown.note}</Text>}
        <Box marginTop={1} flexDirection="column">{drawn}</Box>
        <Box marginTop={1} columnGap={2} flexWrap="wrap">
          {(shown.pages > 1 || hidden) && <Button key="prev" plain hotkey="p" label={hidden ? 'lines above' : 'previous page'} onPress={() => void turn($, hidden ? 0 : -1)} />}
          {shown.pages > 1 && <Button key="next" plain hotkey="n" label="next page" onPress={() => void turn($, 1)} />}
          {keys}
        </Box>
        {footer(hints, body?.as === 'env' ? 'Esc hands back the keys' : undefined)}
      </Box>
    )
  })
}
