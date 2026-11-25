import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MASK, maskedRow, newLine, parseEnv, serializeEnv, setValue } from '../hooks/env'
import { isInside } from '../hooks/paths'
import {
  FIT, bmpPixels, bytesLine, cellsOf, frame, fromBase64, isEnvFile, isSecret, kindOf, paginate, pan, parseDelimited, secretsFrom,
  soundFromAfinfo, soundFromFfprobe, soundLine, tablePages, toBase64, videoLine, wrapLine, wrapNumbered,
} from '../hooks/read'
import { BAND, GUARD, PANE, mountPane, ok, peek, picture, pngFile, rows, start, world } from './world'

test('format detection goes by the extension, text when unknown', () => {
  const cases: [string, string][] = [
    ['README.md', 'markdown'], ['notes.MARKDOWN', 'markdown'], ['data.csv', 'csv'], ['data.tsv', 'tsv'],
    ['package.json', 'json'], ['bar.png', 'image'], ['photo.JPG', 'image'], ['IMG_1.heic', 'image'],
    ['anim.gif', 'image'], ['paper.pdf', 'pdf'], ['memo.docx', 'doc'], ['old.doc', 'doc'], ['note.rtf', 'doc'],
    ['take.m4a', 'audio'], ['song.mp3', 'audio'], ['voice.aiff', 'audio'], ['clip.opus', 'audio'],
    ['hooks/protect-env.mjs', 'text'], ['server.log', 'text'], ['Makefile', 'text'], ['.gitignore', 'text'],
    ['dir.v2/file', 'text'], ['C:\\dir.v2\\file', 'text'], ['C:\\docs\\README.md', 'markdown'], ['clip.MP4', 'video'], ['screen.mov', 'video'], ['page.html', 'html'],
  ]
  for (const [path, kind] of cases) expect(kindOf(path)).toBe(kind)
})

test("secret files: the kit's own list, templates and public keys allowed, case ignored", () => {
  const secrets = secretsFrom(GUARD)
  expect(secrets).not.toBeNull()
  if (!secrets) return
  for (const path of ['.env', '/repo/.env.local', 'config/.env.production', '/repo/.ENV', 'certs/server.pem', 'tls.key',
    'id_rsa', '/homes/me/.ssh/id_ed25519', '/homes/me/.aws/credentials', '.netrc', 'app/credentials.json', 'k8s/secrets.yaml',
    'C:\\Profiles\\me\\.aws\\credentials', 'C:\\repo\\.env']) {
    expect(isSecret(path, secrets)).toBe(true)
  }
  for (const path of ['.env.example', '/repo/.env.sample', 'id_rsa.pub', 'README.md', 'credentials.md', 'aws/credentials', 'environment.ts']) {
    expect(isSecret(path, secrets)).toBe(false)
  }
  // A repo's protect.secrets adds patterns, with **/ for any folders.
  const more = secretsFrom(GUARD, ['private/**/*.txt'])
  expect(more && isSecret('/repo/private/a/b/plan.txt', more)).toBe(true)
  expect(more && isSecret('/repo/private/plan.txt', more)).toBe(true)
  // A guard peek can't read (moved, rewritten) gives no list: the caller refuses everything.
  expect(secretsFrom('export default {}')).toBeNull()
  expect(secretsFrom('const DEFAULT_SECRETS = [];\nconst TEMPLATE = /x/;')).toBeNull()
})

test('the folder check: inside a root or not, case ignored on macOS, no prefix tricks', () => {
  const roots = ['/work/project', '/work/project-wt/feature']
  expect(isInside('/work/project/README.md', roots, 'mac')).toBe(true)
  expect(isInside('/WORK/Project/plugin/a.ts', roots, 'mac')).toBe(true)
  expect(isInside('/work/project-wt/feature/x.md', roots, 'mac')).toBe(true)
  expect(isInside('/work/project-other/x.md', roots, 'mac')).toBe(false)
  expect(isInside('/work/pictures/bar.png', roots, 'mac')).toBe(false)
  expect(isInside('/work', roots, 'mac')).toBe(false)
})

test('pages, tables and audio facts', () => {
  const text = Array.from({ length: 300 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join('\n')
  const pages = paginate(text, 8_000)
  expect(pages.length).toBe(3)
  expect(pages.every(p => p.text.length <= 8_000)).toBe(true)
  expect(pages[1]?.start).toBe(Number(/^line (\d+)/.exec(pages[1]?.text ?? '')?.[1]))
  expect(pages.map(p => p.text).join('\n')).toBe(text)

  expect(parseDelimited('name,note\r\n"Smith, J","said ""hi""\nthen left"\nLee,\n', ',')).toEqual([
    ['name', 'note'], ['Smith, J', 'said "hi"\nthen left'], ['Lee', ''],
  ])
  const table = tablePages([['a', 'b|c'], ['1', '2']])[0]?.text
  expect(table).toBe('| a | b\\|c |\n| --- | --- |\n| 1 | 2 |')

  const afinfo = 'File:           voice.aiff\nFile type ID:   AIFC\nNum Tracks:     1\n----\nData format:     1 ch,  22050 Hz, lpcm (0x0000000E) 16-bit big-endian signed integer\n                no channel layout.\nestimated duration: 1.993288 sec\n'
  const sound = soundFromAfinfo(afinfo)
  expect(sound && soundLine(sound)).toBe('0:02 · lpcm in AIFC · 22,050 Hz · mono')
  expect(soundFromAfinfo('Fail: AudioFileOpenURL failed\n')).toBeNull()
  expect(videoLine('{"streams":[{"codec_name":"h264","width":1920,"height":1080}],"format":{"duration":"42.4"}}')).toBe('0:42 · h264 · 1920 × 1080')
  const probe = '{"streams":[{"codec_name":"opus","sample_rate":"48000","channels":2}],"format":{"duration":"3725.5","format_long_name":"Ogg"}}'
  const probed = soundFromFfprobe(probe)
  expect(probed && soundLine(probed)).toBe('1:02:06 · opus in Ogg · 48,000 Hz · stereo')
})

// A 2 × 2 32-bit BMP as ffmpeg writes it (bottom row first, BGRA): red, see-through / blue, green.
const bmp = () => {
  const bytes = new Uint8Array(54 + 16)
  const view = new DataView(bytes.buffer)
  bytes.set([0x42, 0x4d])
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, 2, true)
  view.setInt32(22, 2, true)
  view.setUint16(28, 32, true)
  bytes.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0], 54)
  return bytes
}

test('pixels become half blocks: top in front, bottom behind, see-through is the terminal', () => {
  const px = bmpPixels(bmp())
  expect(px && [px.width, px.height]).toEqual([2, 2])
  if (!px) return
  const f = frame(px.width, px.height, 10, 10, FIT)
  expect([f.columns, f.rows]).toEqual([2, 1])
  const words = Array.from(new Uint32Array(fromBase64(cellsOf(px, f)).buffer))
  expect(words).toEqual([0x2580, 0xff0000, 0x0000ff, 0x2584, 0x00ff00, 0x01000000])
  expect(toBase64(fromBase64('aGVsbG8='))).toBe('aGVsbG8=')

  // sips writes a picture with no alpha as 24-bit BGR, rows padded to 4 bytes, top row first.
  const flat = new Uint8Array(54 + 8)
  const view = new DataView(flat.buffer)
  flat.set([0x42, 0x4d])
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, 1, true)
  view.setInt32(22, -2, true)
  view.setUint16(28, 24, true)
  flat.set([0x10, 0x20, 0x30, 0, 0x40, 0x50, 0x60, 0], 54)
  expect(Array.from(bmpPixels(flat)?.rgba ?? [])).toEqual([0x30, 0x20, 0x10, 255, 0x60, 0x50, 0x40, 255])
})

const OUTSIDE = (typed: string) => `Peek shows files in this repo, its worktrees and folders you approve, and ${typed} is outside them (/peek allow <folder> approves one).`

test('the path guard: the repo and its worktrees only, secrets never, links followed', async ($, on) => {
  world(on, {
    stats: {
      '/repo/README.md': { realPath: '/repo/README.md' },
      '/REPO/readme.md': { realPath: '/REPO/readme.md' },
      '/wt/feature/notes.md': { realPath: '/wt/feature/notes.md' },
      '/homes/me/Pictures/bar.png': { realPath: '/homes/me/Pictures/bar.png' },
      '/repo/out.md': { realPath: '/homes/me/elsewhere/out.md', isLink: true },
      '/repo/config/settings.txt': { realPath: '/repo/id_rsa', isLink: true },
      '/repo/plugin': { realPath: '/repo/plugin', kind: 'dir' },
    },
    files: { '/repo/README.md': '# Hi\n', '/REPO/readme.md': '# Hi\n', '/wt/feature/notes.md': 'notes\n' },
  })
  await start($)

  expect(await peek($, 'README.md')).toBe('Peek: README.md')
  expect(await peek($, '/REPO/readme.md')).toBe('Peek: /REPO/readme.md')
  expect(await peek($, '/wt/feature/notes.md')).toBe('Peek: /wt/feature/notes.md')
  expect(await peek($, '~/Pictures/bar.png')).toBe(OUTSIDE('~/Pictures/bar.png'))
  expect(await peek($, 'out.md')).toBe(OUTSIDE('out.md'))
  expect(await peek($, 'id_rsa')).toBe("Peek never shows secret files, and id_rsa matches the kit's secret-file patterns.")
  expect(await peek($, '"plugin/../certs/server.pem"')).toBe("Peek never shows secret files, and plugin/../certs/server.pem matches the kit's secret-file patterns.")
  expect(await peek($, 'config/settings.txt')).toBe('Peek never shows secret files, and config/settings.txt leads to one.')
  expect(await peek($, 'missing.md')).toBe('Peek found no file at missing.md.')
  expect(await peek($, 'plugin')).toBe('plugin is a folder: peek shows one file at a time.')
})

// A session started in a folder peek won't show (here the home folder): nothing in it is shown or
// listed, /peek says why in one line, and approved folders still show.
const HOME_FOLDER = 'Peek shows no files from /homes/me: it is your whole home folder. Start Claude Code in a project folder, or approve one with /peek allow <folder>.'
const homeWorld = (on: On, worktrees: string | null) =>
  world(on, {
    cwd: '/homes/me',
    worktrees,
    store: { allowed: ['/homes/me/notes'] },
    stats: {
      '/homes/me': { realPath: '/homes/me', kind: 'dir' },
      '/homes/me/.claude/.credentials.json': { realPath: '/homes/me/.claude/.credentials.json' },
      '/homes/me/.config/gh/hosts.yml': { realPath: '/homes/me/.config/gh/hosts.yml' },
      '/homes/me/notes.md': { realPath: '/homes/me/notes.md' },
      '/homes/me/notes/todo.md': { realPath: '/homes/me/notes/todo.md' },
    },
    files: { '/homes/me/.claude/.credentials.json': '{"token":"sk-ant-SECRET"}', '/homes/me/.config/gh/hosts.yml': 'oauth_token: gho_SECRET\n', '/homes/me/notes.md': 'notes\n', '/homes/me/notes/todo.md': '# Todo\n' },
    answer: argv => {
      if (argv.join(' ') === 'git rev-parse --show-toplevel') return '/homes/me\n'
      if (argv.join(' ') === 'git ls-files -co --exclude-standard -z') return 'notes.md\0.config/gh/hosts.yml\0.claude/.credentials.json\0'
      return undefined
    },
  })

test('a session in the home folder outside git shows no file there and says why; approved folders still show', async ($, on) => {
  homeWorld(on, null)
  await start($)
  expect(await peek($, '~/.claude/.credentials.json')).toBe(HOME_FOLDER)
  expect(await peek($, 'notes.md')).toBe(HOME_FOLDER)
  expect(await peek($, '~/notes/todo.md')).toBe('Peek: ~/notes/todo.md')
  expect(await peek($, '')).toBe('Peek: pick a file')
  const ui = await mountPane($)
  expect(await rows(ui)).toEqual([])
  expect(await ui.find({ text: HOME_FOLDER })).toBeDefined()
  await ui.unmount()
})

test('a repo whose top is the home folder is no root: no file, list or diff from it, and /peek says why', async ($, on) => {
  homeWorld(on, 'worktree /homes/me\nHEAD abc\nbranch refs/heads/main\n')
  await start($)
  expect(await peek($, '~/.config/gh/hosts.yml')).toBe(HOME_FOLDER)
  expect(await peek($, 'diff notes.md')).toBe(HOME_FOLDER)
  expect(await peek($, '~/notes/todo.md')).toBe('Peek: ~/notes/todo.md')
  for (const [args, said, prefix] of [['', 'Peek: pick a file', 'file:'], ['diff', 'Peek: what changed', 'diff:']] as const) {
    expect(await peek($, args)).toBe(said)
    const ui = await mountPane($)
    expect(await rows(ui, prefix)).toEqual([])
    expect(await ui.find({ text: HOME_FOLDER })).toBeDefined()
    await ui.unmount()
  }
})

// A repo or session folder under a system folder still shows its files; a system folder itself doesn't.
for (const [cwd, isRepo, typed, said] of [
  ['/usr/src/app', true, 'README.md', 'Peek: README.md'],
  ['/root/project', false, 'notes.md', 'Peek: notes.md'],
  ['/usr', false, 'src/app/README.md', "Peek shows no files from /usr: it is one of the system's own folders. Start Claude Code in a project folder, or approve one with /peek allow <folder>."],
  ['/etc', true, 'hosts', "Peek shows no files from /etc: it is one of the system's own folders. Start Claude Code in a project folder, or approve one with /peek allow <folder>."],
] as const) {
  test(`a session in ${cwd}${isRepo ? ', a git repo' : ' outside git'}: ${said.startsWith('Peek:') ? 'its files show' : 'nothing shows, and peek says why'}`, async ($, on) => {
    world(on, {
      cwd,
      worktrees: isRepo ? `worktree ${cwd}\nHEAD abc\nbranch refs/heads/main\n` : null,
      stats: Object.fromEntries(
        [cwd, '/usr', '/usr/src/app', '/usr/src/app/README.md', '/root/project/notes.md', '/etc/hosts'].map(p => [p, { realPath: p, kind: p.includes('.') || p === '/etc/hosts' ? 'file' : 'dir' }]),
      ),
      files: { '/usr/src/app/README.md': '# App\n', '/root/project/notes.md': 'notes\n', '/etc/hosts': '127.0.0.1 localhost\n' },
      answer: argv => (argv.join(' ') === 'git rev-parse --show-toplevel' ? `${cwd}\n` : undefined),
    })
    await start($)
    expect(await peek($, typed)).toBe(said)
  })
}

test("without the kit's patterns in its own folder it shows nothing", async ($, on) => {
  world(on, { stats: { '/repo/README.md': { realPath: '/repo/README.md' } }, files: { '/repo/README.md': '# Hi\n' }, noGuard: true })
  await start($)
  expect(await peek($, 'README.md')).toBe("Peek shows nothing until it can read the kit's secret-file patterns from protect-env.mjs in its own folder; /odyssey:setup puts that file back.")
})

test('zoom: fit to the pane, doubling up to 1 pixel per half cell, panning kept on the image', () => {
  // An 833 × 44 picture in 80 × 20 cells fits at under a tenth, four steps from 100%.
  const fit = frame(833, 44, 80, 20, FIT)
  expect([fit.step, fit.steps, fit.columns, fit.rows, fit.left, fit.width]).toEqual([0, 4, 80, 2, 0, 833])
  const full = frame(833, 44, 80, 20, { ...FIT, step: 4 })
  expect([full.scale, full.columns, full.pixelRows, full.rows, full.left, full.top, full.width, full.height]).toEqual([1, 80, 40, 20, 376.5, 2, 80, 40])
  expect(frame(833, 44, 80, 20, { ...FIT, step: 9 }).step).toBe(4)
  // Panning moves half a view and stops at the edges.
  const right = pan(833, 44, 80, 20, { ...FIT, step: 4 }, 1, 0)
  expect(frame(833, 44, 80, 20, right).left).toBe(416.5)
  let edge = { ...FIT, step: 4 }
  for (let i = 0; i < 20; i++) edge = pan(833, 44, 80, 20, edge, -1, -1)
  expect([frame(833, 44, 80, 20, edge).left, frame(833, 44, 80, 20, edge).top]).toEqual([0, 0])
  // The fit follows the pane's size: twice as wide, twice the scale; a small picture is not blown up.
  expect(frame(833, 44, 160, 20, FIT).columns).toBe(160)
  expect([frame(40, 10, 80, 20, FIT).steps, frame(40, 10, 80, 20, FIT).columns, frame(40, 10, 80, 20, FIT).rows]).toEqual([0, 40, 5])
  // A downscale averages what each cell covers: a 1-pixel black line on white reads as grey, not lost.
  const line = picture(4, 2)
  const halved = frame(4, 2, 2, 10, FIT)
  expect([halved.columns, halved.pixelRows]).toEqual([2, 1])
  const cells = Array.from(new Uint32Array(fromBase64(cellsOf(line, halved)).buffer))
  expect(cells.slice(0, 3)).toEqual([0x2580, 0x808080, 0x01000000])
  expect(cells.slice(3, 6)).toEqual([0x2580, 0xffffff, 0x01000000])
})

test('wrapping breaks at spaces, keeps the indent, and numbers only first rows', () => {
  expect(wrapLine('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps'])
  expect(wrapLine('one two three four', 9)).toEqual(['one two', 'three', 'four'])
  expect(wrapLine('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  expect(wrapLine('    // a comment that is long', 16)).toEqual(['    // a comment', '    that is long'])
  expect(wrapLine('short', 40)).toEqual(['short'])
  expect(wrapNumbered('alpha beta gamma\nz', 7, 14)).toEqual({ gutter: '7\n \n8', rows: 'alpha beta\ngamma\nz' })
  expect(wrapNumbered('z', 98, 14, 3)).toEqual({ gutter: ' 98', rows: 'z' })
})

test('each text kind draws as its element, and n turns the page', async ($, on) => {
  const long = Array.from({ length: 400 }, (_, i) => `log line ${i + 1} \x1b[32mok\x1b[0m ${'·'.repeat(40)}`).join('\n')
  const files: Record<string, string> = {
    '/repo/README.md': '# Peek\n\nA *pane*.\n',
    '/repo/data.csv': 'name,count\n"Lee, A",3\n',
    '/repo/a.json': '{"b":[1,2]}',
    '/repo/run.log': long,
  }
  world(on, { stats: Object.fromEntries(Object.keys(files).map(path => [path, { realPath: path, size: files[path]?.length ?? 0 }])), files })
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    await peek($, 'README.md')
    let ui = await $.ui.mount({ plugin: 'peek', surface, ...PANE })
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# Peek\n\nA *pane*.\n')
    expect(await ui.find({ text: /^🔭 \/repo\/README\.md$/ })).toBeDefined()
    await ui.unmount()

    await peek($, 'data.csv')
    ui = await $.ui.mount({ plugin: 'peek', surface, ...PANE })
    expect(await ui.find({ text: /1 rows × 2 columns/ })).toBeDefined()
    expect((await ui.find({ type: 'Markdown' }))?.text).toBe('| name | count |\n| --- | --- |\n| Lee, A | 3 |')
    await ui.unmount()

    await peek($, 'a.json')
    ui = await $.ui.mount({ plugin: 'peek', surface, ...PANE })
    expect((await ui.find({ type: 'Code' }))?.text).toBe('{\n  "b": [\n    1,\n    2\n  ]\n}')
    await ui.unmount()

    await peek($, 'run.log')
    ui = await $.ui.mount({ plugin: 'peek', surface, ...PANE })
    expect(await ui.find({ text: /page 1 of 3/ })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.text).toMatch(/^log line 1 ok ·/)
    await ui.press({ key: 'next' })
    expect(await ui.find({ text: /page 2 of 3/ })).toBeDefined()
    expect((await ui.find({ type: 'Code' }))?.text).not.toContain('\x1b')
    await ui.unmount()
  }
})

const AFINFO = 'File type ID:   AIFC\nData format:     1 ch,  22050 Hz, lpcm (0x0000000E) 16-bit\nestimated duration: 1.993288 sec\n'

test('an image opens as blocks that zoom, pan and refit; r tries the picture; audio draws its facts and waveform', async ($, on) => {
  const png = toBase64(pngFile(400, 20, picture(400, 20).rgba))
  const size = fromBase64(png).length
  world(on, {
    stats: { '/repo/bar.png': { realPath: '/repo/bar.png', size }, '/repo/voice.aiff': { realPath: '/repo/voice.aiff', size: 92_000 } },
    files: { '/repo/bar.png': png },
    answer: (argv, _init, files) => {
      if (argv[0] === 'afinfo') return AFINFO
      // ffmpeg draws the waveform into peek's scratch file, its last argument.
      if (argv[0] !== 'ffmpeg') return undefined
      files[argv.at(-1) ?? ''] = toBase64(bmp())
      return ''
    },
  })
  await start($)
  await peek($, 'bar.png')
  let ui = await mountPane($)
  expect(await ui.find({ text: new RegExp(`400 × 20 px · PNG · ${bytesLine(size)}`) })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'preview' })).toBeDefined()
  expect(await ui.find({ text: /zoom fit \(20%\) · pixels 0–400 × 0–20 of 400 × 20/ })).toBeDefined()
  expect(await ui.find({ text: /^Esc closes · ctrl\+x ←→ width$/ })).toBeDefined()
  for (let i = 0; i < 3; i++) await ui.press({ key: 'in' })
  expect(await ui.find({ text: /zoom 100% · pixels 160–240 × 0–20/ })).toBeDefined()
  expect(await ui.find({ key: 'in' })).toBeUndefined()
  await ui.press({ key: 'right' })
  expect(await ui.find({ text: /pixels 200–280 × 0–20/ })).toBeDefined()
  await ui.press({ key: 'fit' })
  expect(await ui.find({ text: /zoom fit \(20%\)/ })).toBeDefined()
  // A wider pane refits.
  await ui.redraw({ ...PANE.props, bodyColumns: 160, placement: 'inline' })
  expect(await ui.find({ text: /zoom fit \(40%\)/ })).toBeDefined()
  expect(await ui.find({ text: /^Esc closes · ctrl\+x ↑↓ height$/ })).toBeDefined()
  await ui.press({ key: 'picture' })
  expect((await ui.find({ type: 'Image', key: 'picture' }))).toBeDefined()
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.press({ key: 'picture' })
  expect(await ui.find({ type: 'Raster', key: 'preview' })).toBeDefined()
  await ui.unmount()
  const desk = await $.ui.mount({ plugin: 'peek', surface: 'desktop', ...PANE })
  expect(await desk.find({ text: /Pictures draw in the terminal only/ })).toBeDefined()
  await desk.unmount()

  await peek($, 'voice.aiff')
  ui = await mountPane($)
  expect(await ui.find({ text: /0:02 · lpcm in AIFC · 22,050 Hz · mono · 90 KB/ })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'preview' })).toBeDefined()
  await ui.unmount()
})

test('/peek alone lists the repo newest first, secrets left out, and a pick shows the file', async ($, on) => {
  world(on, {
    stats: {
      '/repo/README.md': { realPath: '/repo/README.md', mtimeMs: 1_759_400_000_000 },
      '/repo/.env.local': { realPath: '/repo/.env.local', mtimeMs: 1_759_300_000_000 },
      '/repo/plugin/a.ts': { realPath: '/repo/plugin/a.ts', mtimeMs: 1_759_200_000_000 },
    },
    files: { '/repo/README.md': '# Hi\n' },
    answer: argv => {
      if (argv.join(' ') === 'git rev-parse --show-toplevel') return '/repo\n'
      if (argv.join(' ') === 'git ls-files -co --exclude-standard -z') return 'plugin/a.ts\0README.md\0.env.local\0'
      return undefined
    },
  })
  await start($)
  expect(await peek($, '')).toBe('Peek: pick a file')
  const ui = await mountPane($)
  expect(await rows(ui)).toEqual(['README.md · 1m', 'plugin/a.ts · 2d'])
  await ui.press({ key: 'file:/repo/README.md' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# Hi\n')
  await ui.unmount()
})

// --- Session files, the band, the edit key -------------------------------------------------------------

test('/peek alone lists the files Claude touched this session first, secrets and outside files left out', async ($, on) => {
  world(on, {
    stats: {
      '/repo/notes.md': { realPath: '/repo/notes.md', mtimeMs: 1_759_300_000_000 },
      '/repo/README.md': { realPath: '/repo/README.md', mtimeMs: 1_759_400_000_000 },
      '/repo/.env': { realPath: '/repo/.env' },
      '/homes/me/elsewhere.md': { realPath: '/homes/me/elsewhere.md' },
      '/wt/feature/plan.md': { realPath: '/wt/feature/plan.md' },
    },
    answer: argv => {
      if (argv.join(' ') === 'git rev-parse --show-toplevel') return '/repo\n'
      if (argv.join(' ') === 'git ls-files -co --exclude-standard -z') return 'README.md\0notes.md\0'
      return undefined
    },
  })
  on('tool.call', ok)
  await start($)
  for (const [tool, file_path] of [['Read', '/repo/notes.md'], ['Read', '/repo/.env'], ['Read', '/homes/me/elsewhere.md'], ['Edit', '/wt/feature/plan.md']] as const) {
    await $.tool.call({ tool, file_path, ...(tool === 'Edit' ? { old_string: 'a', new_string: 'b' } : {}) } as never)
  }
  expect(await peek($, '')).toBe('Peek: pick a file')
  const ui = await mountPane($)
  const listed = JSON.stringify(await rows(ui))
  expect(listed.indexOf('plan.md · this session, edited')).toBeGreaterThan(-1)
  expect(listed.indexOf('plan.md · this session')).toBeLessThan(listed.indexOf('notes.md · this session, read'))
  expect(listed.indexOf('notes.md · this session, read')).toBeLessThan(listed.indexOf('README.md · '))
  expect(listed).not.toContain('.env')
  expect(listed).not.toContain('elsewhere.md')
  expect(listed.split('notes.md · ').length - 1).toBe(1) // listed once, as this session's
  await ui.unmount()
})

test('after a write the band names the file, keeps the line beneath, and goes with the next prompt or in 2 minutes', async ($, on) => {
  const { clock } = world(on, { stats: { '/repo/README.md': { realPath: '/repo/README.md' }, '/repo/a.ts': { realPath: '/repo/a.ts' } }, files: { '/repo/README.md': '# Hi\n' } })
  on('tool.call', ok)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'Context 72% used' })
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await start($)
  let ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /wrote/ })).toBeUndefined()
  expect(await ui.find({ text: /Context 72% used/ })).toBeDefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: '# Hi\n' } as never)
  await clock.settle()
  ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^🔭 wrote README\.md ·$/ })).toBeDefined()
  expect(await ui.find({ text: /Context 72% used/ })).toBeDefined()
  // A band Button takes only a digit from the prompt (a letter there is typed), so the keys are 1 and 2.
  expect((await ui.find({ key: 'peek-wrote' }))?.props.hotkey).toBe('1')
  expect((await ui.find({ key: 'peek-diff' }))?.props).toMatchObject({ hotkey: '2', label: 'diff' })
  await ui.unmount()
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.settle()
  ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^🔭 wrote 2 files ·$/ })).toBeDefined()
  expect((await ui.find({ key: 'peek-diff' }))?.props.label).toBe('diff of a.ts')
  await ui.press({ key: 'peek-wrote' }) // several files: the picker opens
  expect(await ui.find({ text: /wrote/ })).toBeUndefined()
  await ui.unmount()
  // The next prompt takes it down.
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'x' } as never)
  await clock.settle()
  ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /^🔭 wrote a\.ts ·$/ })).toBeDefined()
  await $.prompt.submit({ text: 'next' } as never)
  expect(await ui.find({ text: /wrote/ })).toBeUndefined()
  await ui.unmount()
  await $.tool.call({ tool: 'Write', file_path: '/repo/README.md', content: '# Hi\n' } as never)
  await clock.settle()
  await clock.advance(120_000)
  ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /wrote/ })).toBeUndefined()
  await ui.unmount()
})

test('e puts "In <path>: " in the prompt and hands it the keys; Claude makes the edit in one turn', async ($, on) => {
  const { opened } = world(on, { stats: { '/wt/feature/docs/plan.md': { realPath: '/wt/feature/docs/plan.md' } }, files: { '/wt/feature/docs/plan.md': '# Plan\n' } })
  const filled: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('ui.close', () => ({ value: undefined }))
  await start($)
  await peek($, '/wt/feature/docs/plan.md')
  const ui = await mountPane($)
  expect(JSON.stringify(await ui.find({ key: 'edit' }))).toContain('edit · 1 Claude turn')
  await ui.press({ key: 'edit' })
  expect(filled).toEqual(['In docs/plan.md: '])
  expect(opened.at(-1)).toEqual({ id: 'peek', title: '🔭 plan.md' }) // open again, without the keys
  await ui.unmount()
})

// --- The masked .env editor ----------------------------------------------------------------------------

const ENV = `# Peek test env
API_KEY=sk-SECRET-123
export DB_URL="postgres://u:p@h/db" # main db
EMPTY=
QUOTED='single # not a comment'
# OLD_KEY=old-secret-999
LAST=plain value
`
const VALUES = ['sk-SECRET-123', 'postgres://u:p@h/db', 'single # not a comment', 'old-secret-999', 'plain value', 'sk-NEW-456', 'hello world']

test('the env model: masked rows, and a round trip that keeps comments, order, spacing and quotes', () => {
  const doc = parseEnv(ENV)
  expect(serializeEnv(doc)).toBe(ENV)
  expect(doc.lines.map(maskedRow)).toEqual([
    '# Peek test env', `API_KEY = ${MASK}`, `DB_URL = ${MASK}`, `EMPTY = ${MASK}`, `QUOTED = ${MASK}`, `# OLD_KEY= ${MASK}`, `LAST = ${MASK}`,
  ])
  expect(doc.lines.map(l => l.value)).toEqual([undefined, 'sk-SECRET-123', 'postgres://u:p@h/db', '', 'single # not a comment', undefined, 'plain value'])
  doc.lines[1] = setValue(doc.lines[1]!, 'sk-NEW-456')
  doc.lines[2] = setValue(doc.lines[2]!, 'say "hi"')
  doc.lines[4] = setValue(doc.lines[4]!, "it's")
  doc.lines.splice(3, 1)
  doc.lines.push(newLine('NEW_ONE= hello world')!)
  expect(serializeEnv(doc)).toBe(`# Peek test env
API_KEY=sk-NEW-456
export DB_URL='say "hi"' # main db
QUOTED="it's"
# OLD_KEY=old-secret-999
LAST=plain value
NEW_ONE="hello world"
`)
  expect(parseEnv(serializeEnv(doc)).lines[2]?.value).toBe('say "hi"')
  // A backslash goes in single quotes, which Node's dotenv, Docker Compose and a shell read
  // literally, so a value that ends in one, or holds `\n`, comes back as typed.
  for (const value of ['C:\\new\\dir', 'ends\\', 'a\\"b']) {
    const line = setValue(parseEnv('K="x"\n').lines[0]!, value)
    expect(line.text).toBe(`K='${value}'`)
    expect(parseEnv(`${line.text}\n`).lines[0]?.value).toBe(value)
  }
  expect(newLine('1BAD=x')).toBeNull()
  expect(newLine('no equals')).toBeNull()
  const multi = parseEnv('A=1\nCERT="line one\nline two"\nB=2\n')
  expect(multi.lines.map(l => l.key)).toEqual(['A', 'CERT', 'B'])
  expect(multi.lines[1]?.isLocked).toBe(true)
  expect(maskedRow(multi.lines[1]!)).toBe(`CERT = ${MASK} (spans lines: edit it by hand)`)
  expect(serializeEnv(multi)).toBe('A=1\nCERT="line one\nline two"\nB=2\n')
  expect(serializeEnv(parseEnv('A=1\r\nB=2'))).toBe('A=1\r\nB=2')
})

test('the env model: a double-quoted value with a backslash escape is locked, one with only \\" is not', () => {
  const text = 'A="a\\nb"\nB="say \\"hi\\""\nC=\'a\\nb\'\n'
  const doc = parseEnv(text)
  expect(doc.lines.map(l => l.isLocked === true)).toEqual([true, false, false])
  expect(maskedRow(doc.lines[0]!)).toBe(`A = ${MASK} (backslash escapes: edit it by hand)`)
  expect(serializeEnv(doc)).toBe(text)
})

// CRLF, LF and CR in one file: each line is read on its own, as dotenv readers read it.
const MIXED = 'A=1\r\nAPI_KEY=sk-SECRET-123\nexport DB_URL="postgres://u:p@h/db"\rCERT="line one\nline two"\r\nLAST=plain value'

test('the env model: a file mixing CRLF, LF and CR line ends is read line by line, every value masked', () => {
  const doc = parseEnv(MIXED)
  expect(doc.lines.map(l => l.key)).toEqual(['A', 'API_KEY', 'DB_URL', 'CERT', 'LAST'])
  expect(doc.lines.map(maskedRow)).toEqual([
    `A = ${MASK}`, `API_KEY = ${MASK}`, `DB_URL = ${MASK}`, `CERT = ${MASK} (spans lines: edit it by hand)`, `LAST = ${MASK}`,
  ])
  expect(parseEnv('K=one two\n').lines.map(maskedRow)).toEqual([`K = ${MASK}`])
})

test('the env model: a mixed-ending file saves byte for byte, and an edit changes only its value', () => {
  expect(serializeEnv(parseEnv(MIXED))).toBe(MIXED)
  expect(serializeEnv(parseEnv(`${MIXED}\n`))).toBe(`${MIXED}\n`)
  const doc = parseEnv(MIXED)
  const at = doc.lines.findIndex(l => l.key === 'API_KEY')
  expect(at).toBe(1)
  doc.lines[at] = setValue(doc.lines[at]!, 'sk-NEW-456')
  doc.lines.push(newLine('NEW_ONE=x')!)
  expect(serializeEnv(doc)).toBe(`${MIXED.replace('sk-SECRET-123', 'sk-NEW-456')}\r\nNEW_ONE=x`)
})

test("the env model: a line it can't read as KEY=value is masked whole; blank lines and comments show as written", () => {
  const doc = parseEnv('KEY: sk-colon-1\n1KEY=sk-digit-2\nsk-live-123\n\n  \n# a comment\n')
  expect(doc.lines.map(maskedRow)).toEqual([MASK, MASK, MASK, '', '  ', '# a comment'])
})

test("the editor opens only the kit's .env family; keys, certificates and credentials stay refused", async ($, on) => {
  const secrets = secretsFrom(GUARD)!
  expect(['.env', '/repo/.env.local', '/repo/.env.peek-test', '/repo/.envrc'].every(f => isEnvFile(f, secrets))).toBe(true)
  expect(['/repo/id_rsa', '/repo/server.pem', '/repo/.env.pem', '/repo/credentials.json', '/repo/.env.example', '/repo/README.md'].some(f => isEnvFile(f, secrets))).toBe(false)
  world(on, { stats: { '/repo/.env.peek-test': { realPath: '/repo/.env.peek-test' }, '/repo/link.env': { realPath: '/repo/id_ed25519' } }, files: { '/repo/.env.peek-test': ENV } })
  await start($)
  expect(await peek($, '.env.peek-test')).toBe('Peek: .env.peek-test')
  expect(await peek($, 'id_ed25519')).toMatch(/^Peek never shows secret files/)
  expect(await peek($, '.env.pem')).toMatch(/^Peek never shows secret files/)
  expect(await peek($, 'link.env')).toBe('Peek never shows secret files, and link.env leads to one.')
})

// Reads peek's session state as any plugin can, to show no value is in it.
const READER = {
  name: 'reader',
  register: (on: On) => {
    on('command.run', { command: 'peek-state' }, async $ => {
      const all = await Promise.all([
        $.state.get({ plugin: 'peek', key: 'view' }),
        $.state.get({ plugin: 'peek', key: 'picker' }),
        $.state.get({ plugin: 'peek', key: 'touched' }),
        $.state.get({ plugin: 'peek', key: 'wrote' }),
      ])
      return { text: JSON.stringify(all) }
    })
  },
}

test("the env model: a value holding \" and no ' is written in single quotes, which every reader takes literally", () => {
  const doc = parseEnv('A="1"\nB=2\n')
  doc.lines[0] = setValue(doc.lines[0]!, 'say "hi"')
  expect(serializeEnv(doc)).toBe(`A='say "hi"'\nB=2\n`)
  expect(parseEnv(serializeEnv(doc)).lines[0]?.value).toBe('say "hi"')
})

test("the .env editor won't keep a value holding ' along with \" or a backslash, and says why", async ($, on) => {
  const text = 'A=1\nB=2\n'
  const { written } = world(on, {
    stats: { '/repo/.env.peek-test': { realPath: '/repo/.env.peek-test', size: text.length } },
    files: { '/repo/.env.peek-test': text },
    answer: argv => (argv[0] === 'stat' ? '600\n' : argv[0] === 'mktemp' ? '/repo/.peek-a1b2c3d4\n' : ['chmod', 'mv', 'rm', 'rmdir'].includes(argv[0] ?? '') ? '' : undefined),
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: {} }) as never)
  await start($)
  await peek($, '.env.peek-test')
  const ui = await mountPane($)
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:0', origin: { kind: 'person' } })
  for (const refused of ["it's C:\\dir\\", 'it\'s "x"']) {
    await ui.press({ key: 'env:0' })
    await ui.input({ key: 'env-value', text: refused })
    expect(JSON.stringify(await ui.drawn())).toContain('Not kept: a value holding')
  }
  await ui.press({ key: 'env:0' })
  await ui.input({ key: 'env-value', text: '9' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Not kept: a value holding')
  await ui.press({ key: 'save' })
  expect(written.map(w => w.text)).toEqual(['A=9\nB=2\n'])
  await ui.unmount()
})

test('the .env editor changes nothing when Enter submits the value unchanged', async ($, on) => {
  const text = 'A=1\nB=2\n'
  world(on, {
    stats: { '/repo/.env.peek-test': { realPath: '/repo/.env.peek-test', size: text.length } },
    files: { '/repo/.env.peek-test': text },
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: {} }) as never)
  await start($)
  await peek($, '.env.peek-test')
  const ui = await mountPane($)
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:0', origin: { kind: 'person' } })
  await ui.press({ key: 'env:0' })
  await ui.input({ key: 'env-value', text: '1' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('Enter edits the selected key.')
  expect(drawn).not.toContain('Unsaved changes')
  await ui.unmount()
})

test('a save changes only the edited value: CRLF line ends and any other byte stay; the pane shows control characters cleaned', async ($, on) => {
  const crlf = '# keys\x1b[31m here\r\nA=1\r\nB=two\r\n'
  const { written } = world(on, {
    stats: { '/repo/.env.peek-test': { realPath: '/repo/.env.peek-test', size: crlf.length } },
    files: { '/repo/.env.peek-test': crlf },
    answer: argv => (argv[0] === 'stat' ? '600\n' : argv[0] === 'mktemp' ? '/repo/.peek-a1b2c3d4\n' : ['chmod', 'mv', 'rm', 'rmdir'].includes(argv[0] ?? '') ? '' : undefined),
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: {} }) as never)
  await start($)
  await peek($, '.env.peek-test')
  const ui = await mountPane($)
  expect(JSON.stringify(await ui.drawn())).not.toContain('\\u001b')
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:1', origin: { kind: 'person' } })
  await ui.press({ key: 'env:1' })
  await ui.input({ key: 'env-value', text: '9' })
  await ui.press({ key: 'save' })
  expect(written.map(w => w.text)).toEqual(['# keys\x1b[31m here\r\nA=9\r\nB=two\r\n'])
  await ui.unmount()
})

test('masked by default; v reveals the selected key and moving away masks it; edit, add, delete and an atomic save', { plugins: [READER] }, async ($, on) => {
  const outside: string[] = [] // every string peek sends anywhere but the pane and the .env's own save
  const { ran, written } = world(on, {
    stats: { '/repo/.env.peek-test': { realPath: '/repo/.env.peek-test', size: ENV.length } },
    files: { '/repo/.env.peek-test': ENV },
    answer: (argv, init) => {
      outside.push(...argv, init.stdin ?? '', JSON.stringify(init.env ?? {}))
      if (argv[0] === 'stat') return '640\n'
      if (argv[0] === 'mktemp') return '/repo/.peek-a1b2c3d4\n'
      if (['chmod', 'mv', 'rm', 'rmdir'].includes(argv[0] ?? '')) return ''
      return undefined
    },
  })
  on('ui.toast', (_$, e) => {
    outside.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('prompt.fill', (_$, e) => {
    outside.push(e.text)
    return { isFilled: true }
  })
  on('ui.focus', () => ({ value: {} }) as never)
  await start($)
  outside.push((await peek($, '.env.peek-test')) ?? '')
  const ui = await mountPane($)
  const label = async (key: string) => JSON.stringify(await ui.find({ key }))
  // Masked by default, comments kept, a commented-out value masked too.
  for (const value of VALUES) expect(JSON.stringify(await ui.drawn())).not.toContain(value)
  expect(await label('env:1')).toContain(`API_KEY = ${MASK}`)
  expect(JSON.stringify(await ui.drawn())).toContain('# Peek test env')
  // v reveals the selected (focused) key; moving away masks it again.
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:2', origin: { kind: 'person' } })
  await ui.press({ key: 'reveal' })
  expect(await label('env:2')).toContain('DB_URL = postgres://u:p@h/db')
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:4', origin: { kind: 'person' } })
  expect(await label('env:2')).toContain(`DB_URL = ${MASK}`)
  expect(await label('env:4')).toContain(`QUOTED = ${MASK}`)
  // Enter edits in an Input; a adds; d asks, y deletes.
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:1', origin: { kind: 'person' } })
  await ui.press({ key: 'env:1' })
  await ui.input({ key: 'env-value', text: 'sk-NEW-456' })
  await ui.press({ key: 'add' })
  await ui.input({ key: 'env-new', text: 'NEW_ONE=hello world' })
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'env:3', origin: { kind: 'person' } })
  await ui.press({ key: 'delete' })
  expect(JSON.stringify(await ui.drawn())).toContain('Delete EMPTY?')
  await ui.press({ key: 'yes' })
  expect(JSON.stringify(await ui.drawn())).toContain('Unsaved changes: w saves.')
  await ui.press({ key: 'save' })
  // One atomic save (macOS): the file's mode, a private folder beside it, the text written there,
  // given that mode, renamed over the .env, the folder removed.
  const temp = '/repo/.peek-a1b2c3d4/.env.peek-test'
  expect(ran.map(r => r.argv).filter(argv => argv[0] !== 'git')).toEqual([
    ['stat', '-f', '%Lp', '/repo/.env.peek-test'],
    ['mktemp', '-d', '/repo/.peek-XXXXXXXX'],
    ['chmod', '640', temp],
    ['mv', '-f', temp, '/repo/.env.peek-test'],
    ['rm', '-f', temp],
    ['rmdir', '/repo/.peek-a1b2c3d4'],
  ])
  expect(written).toEqual([{ path: temp, text: `# Peek test env
API_KEY=sk-NEW-456
export DB_URL="postgres://u:p@h/db" # main db
QUOTED='single # not a comment'
# OLD_KEY=old-secret-999
LAST=plain value
NEW_ONE="hello world"
` }])
  // No value in anything peek sent outside the pane: commands, toasts, prompts, command output, state.
  const state = (await $.command.run({ command: 'peek-state', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } }))?.text ?? ''
  expect(state).toContain('"as":"env"')
  for (const value of VALUES) {
    for (const sent of [...outside, state]) expect(sent).not.toContain(value)
  }
  expect(outside.some(sent => sent.includes('Saved .env.peek-test'))).toBe(true)
  await ui.unmount()
})

// --- Moving between the list and a file, in the one pane ------------------------------------------------

// Two repo files and a test .env (never a real one: every read is the mock's); the focus ring,
// the scroll window and closing answered as the engine would, and noted.
const nav = (on: On) => {
  const files: Record<string, string> = { '/repo/a.md': '# A\n', '/repo/b.md': '# B\n', '/repo/.env.peek-test': ENV }
  const saves: string[] = []
  const { opened } = world(on, {
    stats: {
      '/repo/a.md': { realPath: '/repo/a.md', mtimeMs: 1_759_400_000_000 },
      '/repo/b.md': { realPath: '/repo/b.md', mtimeMs: 1_759_300_000_000 },
      '/repo/.env.peek-test': { realPath: '/repo/.env.peek-test' },
    },
    files,
    answer: argv => {
      if (argv.join(' ') === 'git rev-parse --show-toplevel') return '/repo\n'
      if (argv.join(' ') === 'git ls-files -co --exclude-standard -z') return 'a.md\0b.md\0'
      if (argv[0] === 'mv') saves.push(argv.join(' '))
      return undefined
    },
  })
  const scrolled: number[] = []
  const closed: string[] = []
  on('ui.focus', () => ({ value: {} }) as never)
  on('ui.scroll', (_$, e) => (scrolled.push(e.offset), { value: {} }) as never)
  on('ui.close', (_$, e) => (closed.push(e.id), { value: undefined }))
  return { opened, scrolled, closed, saves }
}

test('a click on a file in the list opens it in the same pane', async ($, on) => {
  const { opened } = nav(on)
  await start($)
  expect(await peek($, '')).toBe('Peek: pick a file')
  const ui = await mountPane($)
  expect(await ui.find({ text: /^Type to filter · Tab moves · Enter or a click opens · Esc closes/ })).toBeDefined()
  await ui.press({ key: 'file:/repo/b.md' })
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# B\n')
  expect(await rows(ui)).toEqual([])
  expect(await ui.find({ text: /^Esc closes · ctrl\+x ←→ width$/ })).toBeDefined()
  expect((await ui.find({ key: 'back' }))?.text).toBe('← back')
  expect(opened.map(o => (o as { id: string }).id)).toEqual(['peek', 'peek']) // one pane, retitled
  expect(opened.at(-1)).toMatchObject({ title: '🔭 b.md' })
  await ui.unmount()
})

test('the filter holds the keys first, and Enter there opens the first row', async ($, on) => {
  nav(on)
  await start($)
  await peek($, '')
  const ui = await mountPane($)
  expect((await ui.find({ key: 'filter' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'file:/repo/a.md' }))?.props.autoFocus).toBeUndefined()
  await ui.input({ key: 'filter', text: '' }) // Enter in the empty filter: the first row
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# A\n')
  await ui.unmount()
})

test("back returns to the list with the row and the scroll kept, and this session's files fresh", async ($, on) => {
  const { scrolled } = nav(on)
  on('tool.call', ok)
  await start($)
  await peek($, '')
  const ui = await mountPane($)
  await $.ui.focus({ component: 'Pane', requestId: 'peek', element: 'file:/repo/b.md', origin: { kind: 'person' } })
  await $.ui.scroll({ component: 'Pane', requestId: 'peek', offset: 3, by: 3, bodyRows: 30, contentRows: 60, origin: { kind: 'person' } })
  await ui.press({ key: 'file:/repo/b.md' })
  await $.ui.scroll({ component: 'Pane', requestId: 'peek', offset: 9, by: 6, bodyRows: 30, contentRows: 60, origin: { kind: 'person' } }) // the file scrolls
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.md' } as never)
  await ui.press({ key: 'back' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await rows(ui)).toEqual([expect.stringMatching(/^a\.md · this session, read/), 'b.md · 1d'])
  expect((await ui.find({ key: 'file:/repo/b.md' }))?.props.autoFocus).toBe(true) // the ring goes back to it
  expect((await ui.find({ key: 'filter' }))?.props.autoFocus).toBeUndefined()
  // The test kit can't run a mod's own $.ui.scroll ("no implementation"), so this raises the event the
  // engine makes of peek's call: peek's hook sets it to where the list was.
  await $.ui.scroll({ component: 'Pane', requestId: 'peek', offset: 0, by: -9, bodyRows: 30, contentRows: 60, origin: { kind: 'plugin', name: 'peek' } })
  expect(scrolled.at(-1)).toBe(3)
  await ui.unmount()
})

test('back from a file opened with /peek <path> goes to the list, on that file', async ($, on) => {
  nav(on)
  await start($)
  expect(await peek($, 'b.md')).toBe('Peek: b.md')
  const ui = await mountPane($)
  expect(await rows(ui)).toEqual([])
  await ui.press({ key: 'back' })
  expect(await rows(ui)).toEqual(['a.md · 1m', 'b.md · 1d'])
  expect((await ui.find({ key: 'file:/repo/b.md' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'file:/repo/a.md' }))?.props.autoFocus).toBeUndefined()
  await ui.unmount()
})

test('back from the .env editor with unsaved edits asks first; no leaves them, yes drops them unsaved', async ($, on) => {
  const { saves } = nav(on)
  await start($)
  await peek($, '.env.peek-test')
  const ui = await mountPane($)
  await ui.press({ key: 'back' }) // nothing changed: straight back
  expect(await rows(ui)).toHaveLength(2) // .env files never list: they open by path alone
  await peek($, '.env.peek-test')
  await ui.press({ key: 'env:1' })
  await ui.input({ key: 'env-value', text: 'sk-NEW-456' })
  await ui.press({ key: 'back' })
  expect(await ui.find({ text: 'Unsaved changes. Go back without saving?' })).toBeDefined()
  expect(await rows(ui)).toEqual([])
  await ui.press({ key: 'leave-no' })
  expect(await ui.find({ text: /Unsaved changes\. Go back/ })).toBeUndefined()
  expect(await ui.find({ text: /Unsaved changes: w saves\./ })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'leave-yes' })
  expect(await rows(ui)).toHaveLength(2)
  expect(saves).toEqual([])
  for (const value of VALUES) expect(JSON.stringify(await ui.drawn())).not.toContain(value)
  await ui.unmount()
})

test('✕ closes the pane from the list and from a file', async ($, on) => {
  const { closed } = nav(on)
  await start($)
  await peek($, '')
  let ui = await mountPane($)
  expect((await ui.find({ key: 'close' }))?.text).toBe('✕')
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['peek'])
  await ui.unmount()
  await peek($, 'a.md')
  ui = await mountPane($)
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['peek', 'peek'])
  await ui.unmount()
})

test("the footer names the keys only while the pane holds them, and never repeats a Button's", async ($, on) => {
  world(on, { stats: { '/repo/README.md': { realPath: '/repo/README.md', size: 6 } }, files: { '/repo/README.md': '# Hi\n' } })
  await start($)
  await peek($, 'README.md')
  let ui = await $.ui.mount({ plugin: 'peek', surface: 'terminal', ...PANE, props: { ...PANE.props, isFocused: false } })
  expect(await ui.find({ text: /^ctrl\+x tab for peek's keys · ctrl\+x x close$/ })).toBeDefined()
  await ui.unmount()
  ui = await mountPane($)
  expect(await ui.find({ text: /^Esc closes · ctrl\+x ←→ width$/ })).toBeDefined()
  expect(await ui.find({ text: /b back|e edit/ })).toBeUndefined()
  expect((await ui.find({ key: 'edit' }))?.props.hotkey).toBe('e')
  await ui.unmount()
})
