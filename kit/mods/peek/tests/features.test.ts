// The four features: open at a line, filter the list, /peek diff, approved folders; and the
// Claude Code version peek needs.

import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { pageOfLine, paginate } from '../hooks/read'
import { BAND, PANE, mountPane, ok, peek, rows, start, world } from './world'
import type { Stat } from './world'

const at = (path: string, mtimeMs = 0, extra: Partial<Stat> = {}): [string, Stat] => [path, { realPath: path, mtimeMs, ...extra }]

// --- 1. Open at a line -----------------------------------------------------------------------------------

const CODE = Array.from({ length: 400 }, (_, i) => `const line${i + 1} = ${i + 1} // ${'x'.repeat(30)}`).join('\n')
const LINES = {
  '/repo/src/big.ts': CODE,
  '/repo/notes:12': 'a file whose name ends in :12\n',
  '/repo/notes': 'the other notes\n',
  '/repo/README.md': '# Title\n\nSecond paragraph.\n',
  '/repo/data.csv': 'a,b\n1,2\n',
}

test('/peek path:line opens the page holding the line, the line marked', async ($, on) => {
  world(on, { stats: Object.fromEntries(Object.entries(LINES).map(([p, t]) => at(p, 0, { size: t.length }))), files: LINES })
  await start($)
  expect(await peek($, 'src/big.ts:250')).toBe('Peek: src/big.ts:250')
  const ui = await mountPane($)
  const page = pageOfLine(paginate(CODE), 250)
  expect(page).toBeGreaterThan(0)
  expect(await ui.find({ text: new RegExp(`· line 250 · page ${page + 1} of ${paginate(CODE).length}$`) })).toBeDefined()
  const mark = JSON.stringify(await ui.find({ key: 'mark' }))
  expect(mark).toContain('▶')
  expect(mark).toContain('250')
  expect(mark).toContain('const line250 = 250')
  expect(mark).not.toContain('const line251 =')
  // The parts before and after it stay numbered, their gutters as wide as the mark's.
  const codes = (await ui.findAll({ type: 'Code' })).map(c => c.text)
  expect(codes).toHaveLength(3)
  expect(codes[0]).toMatch(/^const line\d+ = /)
  expect(codes[2]).toMatch(/^const line251 = 251/)
  await ui.unmount()
})

test('path:line:col names the column; a name that really ends in :12 opens as itself; Markdown shows its source', async ($, on) => {
  world(on, { stats: Object.fromEntries(Object.entries(LINES).map(([p, t]) => at(p, 0, { size: t.length }))), files: LINES })
  await start($)
  await peek($, 'src/big.ts:12:7')
  let ui = await mountPane($)
  expect(await ui.find({ text: /^400 lines · .* · line 12, column 7 · page 1 of 3$/ })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'mark' }))).toContain('const line12 = 12')
  await ui.unmount()

  expect(await peek($, 'notes:12')).toBe('Peek: notes:12')
  ui = await mountPane($)
  expect((await ui.find({ type: 'Code' }))?.text).toBe('a file whose name ends in :12\n')
  expect(await ui.find({ key: 'mark' })).toBeUndefined()
  await ui.unmount()

  await peek($, 'README.md:3')
  ui = await mountPane($)
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(JSON.stringify(await ui.find({ key: 'mark' }))).toContain('Second paragraph.')
  await ui.unmount()
})

test('a line past the end marks the last; a table opens at its top and says so; no file, no guess', async ($, on) => {
  world(on, { stats: Object.fromEntries(Object.entries(LINES).map(([p, t]) => at(p, 0, { size: t.length }))), files: LINES })
  await start($)
  await peek($, 'src/big.ts:999')
  let ui = await mountPane($)
  expect(await ui.find({ text: 'Line 999 is past the end; the last line is 400.' })).toBeDefined()
  expect(JSON.stringify(await ui.find({ key: 'mark' }))).toContain('const line400 = 400')
  await ui.unmount()
  await peek($, 'data.csv:2')
  ui = await mountPane($)
  expect(await ui.find({ text: 'Opening at a line works in text, code and Markdown; this file opens at its top.' })).toBeDefined()
  await ui.unmount()
  expect(await peek($, 'missing.ts:3')).toBe('Peek found no file at missing.ts:3.')
})

// The row an element keyed `key` starts on, the drawn tree laid out as the terminal lays it (the kit
// draws no frames): a column Box stacks its children and their margins, a row Box sets them side by
// side, a Code takes a row per line, a Text one per line or, wrapping, one per `columns` of it.
type Drawn = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const kids = (el: Drawn) => (el.children ?? []).filter((c): c is Drawn => typeof c === 'object' && c !== null)
const marginOf = (el: Drawn) => Number(el.props?.marginTop ?? 0)
const height = (el: Drawn, columns: number): number => {
  const p = el.props ?? {}
  if (el.type === 'Code') return String(p.source ?? '').split('\n').length
  if (el.type === 'Text') {
    const lines = (el.children ?? []).join('').split('\n')
    return String(p.wrap ?? 'wrap').startsWith('truncate') ? lines.length : lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / columns)), 0)
  }
  if (el.type !== 'Box') return 1
  const outer = kids(el).map(k => marginOf(k) + height(k, columns))
  return p.flexDirection === 'column' ? outer.reduce((a, b) => a + b, 0) : Math.max(0, ...outer)
}
const rowOf = (el: Drawn, key: string, columns: number, y = 0): number | undefined => {
  if (el.props?.key === key) return y
  let at = y
  for (const k of kids(el)) {
    const found = rowOf(k, key, columns, at + marginOf(k))
    if (found !== undefined) return found
    if (el.props?.flexDirection === 'column') at += marginOf(k) + height(k, columns)
  }
  return undefined
}
// The first number in a part's gutter: the first line it draws.
const firstLine = (part?: { children: unknown[] }) => Number(String((part?.children[0] as Drawn | undefined)?.children?.[0] ?? '').trim().split(/\s+/)[0])
const sized = ($: Engine, bodyRows: number) => $.ui.mount({ plugin: 'peek', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } })
const stated = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([p, t]) => at(p, 0, { size: t.length })))

test('opened at a line, the line shows in the first frame at 10, 20 and 40 rows: line 1, a later page, the last line', async ($, on) => {
  world(on, { stats: stated(LINES), files: LINES })
  await start($)
  for (const bodyRows of [10, 20, 40]) {
    for (const [asked, line] of [[1, 1], [250, 250], [400, 400], [999, 400]] as const) {
      await peek($, `src/big.ts:${asked}`)
      const ui = await sized($, bodyRows)
      const row = rowOf((await ui.drawn()) as Drawn, 'mark', PANE.props.bodyColumns)
      expect(row).toBeDefined()
      expect(row ?? bodyRows).toBeLessThan(bodyRows)
      // The numbers are the file's: the mark is the line, three lines above it lead, the hint counts the rest.
      const mark = await ui.find({ key: 'mark' })
      expect(firstLine(mark)).toBe(line)
      expect(mark?.text).toContain(`const line${line} = ${line}`)
      const parts = (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('part:'))
      if (line === 1) {
        expect(await ui.find({ text: /^↑/ })).toBeUndefined()
        expect(firstLine(parts[0])).toBe(2)
      } else {
        expect(firstLine(parts[0])).toBe(line - 3)
        expect(await ui.find({ text: `↑ lines 1–${line - 4} above · p pages up` })).toBeDefined()
      }
      await ui.unmount()
    }
  }
})

test('long wrapped lines above the mark: as many as fit, so the line still shows at 10 rows', async ($, on) => {
  const prose = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: ${'a paragraph written as one long line '.repeat(8)}`).join('\n')
  const files = { '/repo/README.md': prose }
  world(on, { stats: stated(files), files })
  await start($)
  for (const bodyRows of [10, 20, 40]) {
    await peek($, 'README.md:120')
    const ui = await sized($, bodyRows)
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    expect(rowOf((await ui.drawn()) as Drawn, 'mark', PANE.props.bodyColumns) ?? bodyRows).toBeLessThan(bodyRows)
    expect((await ui.find({ key: 'mark' }))?.text).toContain('Line 120: ')
    await ui.unmount()
  }
})

test('n and p from a line opened mid-file: p shows the page from its top, then pages back; n the next page', async ($, on) => {
  const short = Array.from({ length: 150 }, (_, i) => `line ${i + 1}`).join('\n')
  const files = { ...LINES, '/repo/short.txt': short }
  world(on, { stats: stated(files), files })
  await start($)
  const starts = paginate(CODE).map(p => p.start)
  const firstCode = async (ui: { find: (q: { type: string }) => Promise<{ text: string } | undefined> }) => (await ui.find({ type: 'Code' }))?.text.split('\n')[0]

  await peek($, 'src/big.ts:250')
  let ui = await sized($, 20)
  expect(await ui.find({ text: '↑ lines 1–246 above · p pages up' })).toBeDefined()
  expect((await ui.find({ key: 'prev' }))?.text).toBe('lines above')
  await ui.press({ key: 'prev' })
  expect(await ui.find({ text: /page 2 of 3$/ })).toBeDefined()
  expect(await ui.find({ text: /^↑/ })).toBeUndefined()
  expect(await firstCode(ui)).toMatch(new RegExp(`^const line${starts[1]} = `))
  expect(JSON.stringify(await ui.find({ key: 'mark' }))).toContain('▶')
  expect((await ui.find({ key: 'prev' }))?.text).toBe('previous page')
  await ui.press({ key: 'prev' })
  expect(await ui.find({ text: /page 1 of 3$/ })).toBeDefined()
  await ui.press({ key: 'next' })
  expect(await ui.find({ text: /page 2 of 3$/ })).toBeDefined()
  expect(await firstCode(ui)).toMatch(new RegExp(`^const line${starts[1]} = `))
  await ui.unmount()

  await peek($, 'src/big.ts:250')
  ui = await sized($, 20)
  await ui.press({ key: 'next' })
  expect(await ui.find({ text: /page 3 of 3$/ })).toBeDefined()
  expect(await firstCode(ui)).toMatch(new RegExp(`^const line${starts[2]} = `))
  await ui.unmount()

  // One page, opened at line 120: p shows lines 1–116 with it, and there is no next page.
  await peek($, 'short.txt:120')
  ui = await sized($, 20)
  expect(await ui.find({ text: '↑ lines 1–116 above · p pages up' })).toBeDefined()
  expect(await firstCode(ui)).toBe('line 117')
  expect(await ui.find({ key: 'next' })).toBeUndefined()
  await ui.press({ key: 'prev' })
  expect(await firstCode(ui)).toBe('line 1')
  expect(await ui.find({ key: 'prev' })).toBeUndefined()
  await ui.unmount()
})

// --- 2. Filter the list ------------------------------------------------------------------------------------

const MODS = Array.from({ length: 120 }, (_, i) => `src/mod${i}.ts`)
const REPO_FILES = ['README.md', ...MODS, 'docs/ReadMe-old.md', 'config/.env.local', 'certs/server.pem']

const listWorld = (on: Parameters<typeof world>[0]) =>
  world(on, {
    // README.md newest, the mods after it, docs/ReadMe-old.md oldest.
    stats: Object.fromEntries(REPO_FILES.map((name, i) => at(`/repo/${name}`, 1_759_400_000_000 - i * 60_000))),
    files: { '/repo/README.md': '# Read me\n' },
    answer: argv => {
      if (argv.join(' ') === 'git rev-parse --show-toplevel') return '/repo\n'
      if (argv.join(' ') === 'git ls-files -co --exclude-standard -z') return `${REPO_FILES.join('\0')}\0`
      return undefined
    },
  })

test('typing in the filter narrows the rows to the repo files whose path holds it, case ignored', async ($, on) => {
  listWorld(on)
  await start($)
  await peek($, '')
  const ui = await mountPane($)
  expect((await ui.find({ key: 'filter' }))?.props.autoFocus).toBe(true)
  expect(await rows(ui)).toHaveLength(50)
  expect(await ui.find({ text: '72 more: type to search them' })).toBeDefined()
  await ui.input({ key: 'filter', text: 'README', kind: 'change' })
  expect(await rows(ui)).toEqual(['README.md · 1m', 'docs/ReadMe-old.md'])
  await ui.input({ key: 'filter', text: 'mod1', kind: 'change' })
  expect(await rows(ui)).toHaveLength(31) // mod1, mod10-19, mod100-119
  expect(await ui.find({ text: /more:/ })).toBeUndefined()
  await ui.input({ key: 'filter', text: 'MOD', kind: 'change' })
  expect(await rows(ui)).toHaveLength(50)
  expect(await ui.find({ text: '70 more: type more to narrow it' })).toBeDefined()
  await ui.unmount()
})

test('secret files are never listed, whatever is typed; Enter opens the first match', async ($, on) => {
  listWorld(on)
  await start($)
  await peek($, '')
  const ui = await mountPane($)
  for (const typed of ['env', '.pem', 'certs', 'config/']) {
    await ui.input({ key: 'filter', text: typed, kind: 'change' })
    expect(await rows(ui)).toEqual([])
    expect(await ui.find({ text: `No file matches "${typed}".` })).toBeDefined()
  }
  expect(JSON.stringify(await ui.drawn())).not.toContain('server.pem')
  await ui.input({ key: 'filter', text: 'readme' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# Read me\n')
  await ui.unmount()
})

// --- 3. /peek diff -----------------------------------------------------------------------------------------

const DIFF_A = `diff --git a/src/a.ts b/src/a.ts
index 83db48f..bf269f4 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@ export const a
 const kept = 1
-const gone = 2
+const added = 3
+const more = 4
 const tail = 5
`
const FLAGS = '--no-renames --no-ext-diff --no-textconv --no-color'

const diffWorld = (on: Parameters<typeof world>[0]) =>
  world(on, {
    stats: Object.fromEntries([at('/repo/src/a.ts'), at('/repo/new.md'), at('/repo/logo.png'), at('/repo/README.md'), at('/repo/.env.production')]),
    files: { '/repo/new.md': 'one\ntwo\n', '/repo/src/a.ts': 'x', '/repo/.env.production': 'TOKEN=never-read' },
    answer: argv => {
      const line = argv.join(' ')
      if (line === 'git rev-parse --show-toplevel') return '/repo\n'
      if (line === 'git rev-parse --verify -q HEAD') return 'abc\n'
      if (line === `git diff HEAD --name-status -z ${FLAGS}`) return 'M\0src/a.ts\0D\0old.md\0M\0.env.production\0M\0logo.png\0'
      if (line === `git diff HEAD --numstat -z ${FLAGS}`) return ['2\t1\tsrc/a.ts', '0\t3\told.md', '1\t1\t.env.production', '-\t-\tlogo.png', ''].join('\0')
      if (line === 'git ls-files -o --exclude-standard -z') return 'new.md\0'
      if (line === `git diff HEAD ${FLAGS} -- src/a.ts`) return DIFF_A
      if (line === `git diff HEAD ${FLAGS} -- logo.png`) return 'diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n'
      if (line === `git diff HEAD ${FLAGS} -- old.md`) return 'diff --git a/old.md b/old.md\ndeleted file mode 100644\n--- a/old.md\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n-b\n-c\n'
      return undefined
    },
  })

// What the engine draws above the prompt when no plugin adds a line: here, an empty one.
const quietBand = (on: Parameters<typeof world>[0]) => on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ' ' }))

const colored = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string; props: Record<string, unknown> }[]> }, color: string) =>
  (await ui.findAll({ type: 'Text' })).filter(t => t.props.color === color).map(t => t.text)

test('/peek diff lists every change against HEAD, staged, unstaged and new, with its lines added and removed', async ($, on) => {
  diffWorld(on)
  await start($)
  expect(await peek($, 'diff')).toBe('Peek: what changed')
  const ui = await mountPane($)
  expect(await rows(ui, 'diff:')).toEqual([
    'src/a.ts · modified · +2 −1',
    'old.md · deleted · −3',
    '.env.production · modified · secret file',
    'logo.png · modified · binary',
    'new.md · new',
  ])
  await ui.unmount()
})

test("a file's diff: additions green, removals red, hunk headers kept, the file header left out; back to the list", async ($, on) => {
  const { opened } = diffWorld(on)
  on('ui.focus', () => ({ value: {} }) as never)
  await start($)
  await peek($, 'diff')
  const ui = await mountPane($)
  await ui.press({ key: 'diff:/repo/src/a.ts' })
  expect(await colored(ui, '#58a6ff')).toEqual(['@@ -1,3 +1,4 @@ export const a'])
  expect(await colored(ui, '#3fb950')).toEqual(['+const added = 3\n+const more = 4'])
  expect(await colored(ui, '#f85149')).toEqual(['-const gone = 2'])
  expect(JSON.stringify(await ui.drawn())).not.toContain('index 83db48f')
  expect(await ui.find({ text: 'modified · against HEAD · +2 −1' })).toBeDefined()
  expect(opened.at(-1)).toMatchObject({ title: '🔭 a.ts · diff' })
  await ui.press({ key: 'back' })
  expect(await rows(ui, 'diff:')).toHaveLength(5)
  expect((await ui.find({ key: 'diff:/repo/src/a.ts' }))?.props.autoFocus).toBe(true)
  // A new file is all additions; a deleted one all removals.
  await ui.press({ key: 'diff:/repo/new.md' })
  expect(await colored(ui, '#58a6ff')).toEqual(['@@ -0,0 +1,2 @@'])
  expect(await colored(ui, '#3fb950')).toEqual(['+one\n+two'])
  await ui.press({ key: 'back' })
  await ui.press({ key: 'diff:/repo/old.md' })
  expect(await colored(ui, '#f85149')).toEqual(['-a\n-b\n-c'])
  expect(await ui.find({ text: 'deleted file mode 100644' })).toBeDefined()
  await ui.unmount()
})

test("a secret file's diff is never asked for or read; a binary one says so; an unchanged one too", async ($, on) => {
  const { ran, reads } = diffWorld(on)
  await start($)
  await peek($, 'diff .env.production')
  let ui = await mountPane($)
  expect(await ui.find({ text: 'changed (secret file, not shown)' })).toBeDefined()
  expect(ran.some(r => r.argv.includes('.env.production'))).toBe(false)
  expect(reads).not.toContain('/repo/.env.production')
  expect(JSON.stringify(await ui.drawn())).not.toContain('never-read')
  await ui.unmount()
  await peek($, 'diff logo.png')
  ui = await mountPane($)
  expect(await ui.find({ text: 'binary changed' })).toBeDefined()
  await ui.unmount()
  await peek($, 'diff README.md')
  ui = await mountPane($)
  expect(await ui.find({ text: 'No changes against HEAD.' })).toBeDefined()
  await ui.unmount()
  expect(await peek($, 'diff /etc/hosts')).toBe('Peek shows the diffs of files in this repo and its worktrees, and /etc/hosts is outside them.')
})

test("the band's 2 opens the diff of Claude's last edit", async ($, on) => {
  const { clock } = diffWorld(on)
  on('tool.call', ok)
  quietBand(on)
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'gone', new_string: 'added' } as never)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  await band.press({ key: 'peek-diff' })
  await band.unmount()
  const ui = await mountPane($)
  expect(await colored(ui, '#3fb950')).toEqual(['+const added = 3\n+const more = 4'])
  expect(await ui.find({ text: /^🔭 \/repo\/src\/a\.ts · diff$/ })).toBeDefined()
  await ui.unmount()
})

// --- 4. Approved folders -------------------------------------------------------------------------------------

const folderWorld = (on: Parameters<typeof world>[0], store: Record<string, unknown> = {}) =>
  world(on, {
    store,
    stats: Object.fromEntries([
      at('/homes/me', 0, { kind: 'dir' }),
      at('/homes/me/notes', 0, { kind: 'dir' }),
      ['/homes/me/link-notes', { realPath: '/homes/me/notes', kind: 'dir', isLink: true }],
      at('/homes/me/other', 0, { kind: 'dir' }),
      at('/homes/me/notes/todo.md'),
      at('/homes/me/notes/id_rsa'),
      at('/homes/me/notes/.env'),
      at('/', 0, { kind: 'dir' }),
      ['/etc', { realPath: '/private/etc', kind: 'dir' }],
      at('/homes/me/.ssh', 0, { kind: 'dir' }),
      at('/homes/me/.claude', 0, { kind: 'dir' }),
      at('/repo/plugin', 0, { kind: 'dir' }),
    ]),
    files: { '/homes/me/notes/todo.md': '# Todo\n', '/homes/me/notes/.env': 'K=v' },
  })

test('/peek allow shows where a folder really leads and asks; yes lets peek show its files, secrets still refused', async ($, on) => {
  const { stored } = folderWorld(on)
  await start($)
  expect(await peek($, '~/notes/todo.md')).toMatch(/is outside them/)
  expect(await peek($, 'allow ~/link-notes')).toBe('Peek: approve this folder?')
  const ui = await mountPane($)
  expect(await ui.find({ text: '/homes/me/notes' })).toBeDefined() // the link, followed
  expect((await ui.find({ key: 'allow-yes' }))?.props.hotkey).toBe('y')
  expect((await ui.find({ key: 'allow-no' }))?.props.hotkey).toBe('n')
  await ui.press({ key: 'allow-yes' })
  expect(stored.allowed).toEqual(['/homes/me/notes'])
  expect(await ui.find({ text: 'Approved: peek may show files in /homes/me/notes. Secret files there stay refused.' })).toBeDefined()
  await ui.unmount()
  expect(await peek($, '~/notes/todo.md')).toBe('Peek: ~/notes/todo.md')
  expect(await peek($, '~/notes/id_rsa')).toBe("Peek never shows secret files, and ~/notes/id_rsa matches the kit's secret-file patterns.")
  expect(await peek($, '~/notes/.env')).toBe('Peek never shows secret files outside this repo, and ~/notes/.env is one.')
})

test('no adds nothing; /peek allow lists; /peek disallow removes, by the link or the real path', async ($, on) => {
  const { stored } = folderWorld(on, { allowed: ['/homes/me/notes'] })
  await start($)
  await peek($, 'allow ~/other')
  let ui = await mountPane($)
  await ui.press({ key: 'allow-no' })
  expect(stored.allowed).toEqual(['/homes/me/notes'])
  expect(await ui.find({ text: 'Not approved: /homes/me/other.' })).toBeDefined()
  await ui.unmount()
  expect(await peek($, 'allow')).toBe('Peek: approved folders')
  ui = await mountPane($)
  expect(await ui.find({ text: '/homes/me/notes' })).toBeDefined()
  await ui.unmount()
  expect(await peek($, 'disallow ~/link-notes')).toBe('Peek no longer shows files in /homes/me/notes.')
  expect(stored.allowed).toEqual([])
  expect(await peek($, '~/notes/todo.md')).toMatch(/is outside them/)
  expect(await peek($, 'disallow ~/notes')).toBe("~/notes isn't an approved folder (/peek allow lists them).")
})

test('the top of the disk, the home folder, system folders, keys and Claude Code\'s own folder are refused', async ($, on) => {
  const { stored } = folderWorld(on)
  await start($)
  expect(await peek($, 'allow /')).toBe("Peek won't approve /: it is the top of a drive.")
  expect(await peek($, 'allow ~')).toBe("Peek won't approve /homes/me: it is your whole home folder.")
  expect(await peek($, 'allow /etc')).toBe("Peek won't approve /private/etc: it is one of the system's own folders.")
  expect(await peek($, 'allow ~/.ssh')).toBe("Peek won't approve /homes/me/.ssh: it is a folder of keys.")
  expect(await peek($, 'allow ~/.claude')).toBe("Peek won't approve /homes/me/.claude: it is Claude Code's own folder, or one holding it.")
  expect(await peek($, 'allow ~/notes/todo.md')).toBe('~/notes/todo.md is a file: approve the folder that holds it.')
  expect(await peek($, 'allow plugin')).toBe('/repo/plugin is in this repo already: peek shows it without approval.')
  expect(await peek($, 'allow ~/nowhere')).toBe('Peek found no folder at ~/nowhere.')
  expect(stored.allowed).toBeUndefined()
})

// --- The Claude Code version peek needs ------------------------------------------------------------------------

const versioned = (on: Parameters<typeof world>[0], version: string | null) =>
  world(on, { version, stats: Object.fromEntries([at('/repo/README.md')]), files: { '/repo/README.md': '# Hi\n' } })

for (const [version, said] of [
  ['2.1.287', 'peek needs Claude Code 2.1.288 or newer (this is 2.1.287).'],
  ['2.0.999', 'peek needs Claude Code 2.1.288 or newer (this is 2.0.999).'],
  [null, 'peek needs Claude Code 2.1.288 or newer.'],
  ['2.1.288', 'Peek: README.md'],
  ['2.1.288-dev.20260920.t101500.sha1a2b3c4', 'Peek: README.md'],
  ['2.2.0', 'Peek: README.md'],
] as const) {
  test(`on Claude Code ${version ?? 'with no version call'}, /peek answers "${said}"`, async ($: Engine, on) => {
    versioned(on, version)
    await start($)
    expect(await peek($, 'README.md')).toBe(said)
  })
}

test('on an older Claude Code the band stays away and nothing is tracked', async ($, on) => {
  const { clock } = versioned(on, '2.1.200')
  on('tool.call', ok)
  quietBand(on)
  await start($)
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: '# Hi\n' } as never)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  expect(await band.find({ text: /wrote/ })).toBeUndefined()
  await band.unmount()
})
