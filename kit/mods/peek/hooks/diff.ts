// /peek diff: the working tree's changes against HEAD (staged, unstaged and new untracked files),
// file by file. Only a path git itself names as changed is ever diffed, and a secret file's
// content is never read, nor its diff asked for.

import type { Pick, Picker, View } from '../types'
import { join, sameForm } from './paths'
import type { Os } from './paths'
import { changesFrom, clean, countsFrom, diffBody, isBinaryDiff, isSecret, newFileDiff, paginate, statusWord, tally } from './read'
import type { Secrets } from './read'
import { git, run } from './tools'
import type { Host } from './tools'

const ROWS_MAX = 500
const FLAGS = ['--no-renames', '--no-ext-diff', '--no-textconv', '--no-color']

type Changed = { rel: string; status: string; counts: { add: number; del: number } | null | undefined }

// HEAD, or git's empty tree in a repo with no commit yet.
const baseOf = async (host: Host, root: string): Promise<string> => {
  if ((await git(host, ['rev-parse', '--verify', '-q', 'HEAD'], root)).out !== undefined) return 'HEAD'
  const empty = await run(host, ['git', 'hash-object', '-t', 'tree', '--stdin'], 10_000, { cwd: root, stdin: '' })
  return empty.out?.trim() || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
}

// Every changed path, tracked first (as git lists them), then new untracked ones; or why not.
const changed = async (host: Host, root: string): Promise<{ base: string; files: Changed[]; why: string | null }> => {
  const base = await baseOf(host, root)
  const [status, numbers, untracked] = await Promise.all([
    git(host, ['diff', base, '--name-status', '-z', ...FLAGS], root),
    git(host, ['diff', base, '--numstat', '-z', ...FLAGS], root),
    git(host, ['ls-files', '-o', '--exclude-standard', '-z'], root),
  ])
  if (status.out === undefined) return { base, files: [], why: status.why }
  const counts = countsFrom(numbers.out ?? '')
  const files: Changed[] = changesFrom(status.out).map(c => ({ rel: c.path, status: c.status, counts: counts.get(c.path) }))
  for (const rel of (untracked.out ?? '').split('\0')) if (rel) files.push({ rel, status: 'N', counts: undefined })
  return { base, files, why: null }
}

const countLine = (c: Changed, isHidden: boolean) =>
  isHidden ? 'secret file' : c.counts === null ? 'binary' : c.counts ? [c.counts.add && `+${c.counts.add}`, c.counts.del && `−${c.counts.del}`].filter(Boolean).join(' ') : ''

// The list: one row per changed file, its status and its lines added and removed.
export const diffList = async (host: Host, root: string, secrets: Secrets): Promise<Picker> => {
  const os = host.os
  const { files, why } = await changed(host, root)
  const rows: Pick[] = files.slice(0, ROWS_MAX).map(c => {
    const label = [c.rel, statusWord(c.status), countLine(c, isSecret(c.rel, secrets))].filter(Boolean).join(' · ')
    return { value: join(os, root, c.rel), label, rel: c.rel }
  })
  const note = why ?? (files.length ? null : 'No changes against HEAD.')
  return { mode: 'diff', files: rows, index: [], root, more: Math.max(0, files.length - ROWS_MAX), note }
}

// One file's diff against HEAD, a page at a time: coloured by the pane, hunk headers kept.
export const diffView = async (host: Host, root: string, rel: string, secrets: Secrets, page = 0): Promise<View> => {
  const os: Os = host.os
  const path = join(os, root, rel)
  const base: View = { kind: 'diff', path, rel, info: 'against HEAD', page: 0, pages: 1, body: null, note: null, mark: null }
  const { base: against, files, why } = await changed(host, root)
  if (why) return { ...base, note: why }
  const change = files.find(c => sameForm(os, c.rel) === sameForm(os, rel))
  if (!change) return { ...base, note: 'No changes against HEAD.' }
  const info = `${statusWord(change.status)} · against ${against === 'HEAD' ? 'HEAD' : 'an empty repo'}`
  if (isSecret(change.rel, secrets) || isSecret(path, secrets)) return { ...base, info, note: 'changed (secret file, not shown)' }
  let diff: string
  if (change.status === 'N') {
    const text = await host.read(path).catch(() => null)
    if (text === null) return { ...base, info, note: 'A new file peek could not read (over 4 MiB?).' }
    if (text.includes('\u0000')) return { ...base, info, note: 'binary changed' }
    diff = newFileDiff(clean(text))
  } else {
    const got = await git(host, ['diff', against, ...FLAGS, '--', change.rel], root, 20_000)
    if (got.out === undefined) return { ...base, info, note: got.why }
    if (isBinaryDiff(got.out)) return { ...base, info, note: 'binary changed' }
    diff = diffBody(clean(got.out))
  }
  if (!diff) return { ...base, info, note: 'Changed, with no lines to show (a mode change, or an empty file).' }
  const pages = paginate(diff)
  const at = Math.max(0, Math.min(page, pages.length - 1))
  const { add, del } = tally(diff)
  return { ...base, info: `${info} · +${add} −${del}`, page: at, pages: pages.length, body: { as: 'diff', text: pages[at]?.text ?? '' } }
}
