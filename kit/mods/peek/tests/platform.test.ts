// macOS, Linux and Windows: paths, the tools each view falls back on, the .env save and the
// formats read in plain code, each under every OS's rules (simulated: the OS is what the host says).

import { expect, test } from 'claude-code/testing'

import { docxText, imageSize, inflate, mp3Facts, odtText, pngPixels, unzipEntry, wavFacts } from '../hooks/formats'
import { load } from '../hooks/load'
import { absolute, folderOf, isInside, nameOf, relTo, sameForm, tooBroad, windowsProblem } from '../hooks/paths'
import type { Os } from '../hooks/paths'
import { fromBase64, pageOfLine, paginate, soundLine, targets, toBase64 } from '../hooks/read'
import { REPLACE, saveAtomic } from '../hooks/tools'
import type { Host } from '../hooks/tools'
import { bmpFile, jpegHead, mountPane, mp3Head, peek, picture, pngFile, rows, start, wavFile, world } from './world'
import type { Answer } from './world'

const OSES = ['mac', 'linux', 'windows'] as const

// --- Paths ---------------------------------------------------------------------------------------------------

test('paths: separators, drive letters, the home folder and letter case, on each OS', () => {
  expect(absolute('windows', 'C:\\repo', 'C:\\Profiles\\me', 'src/a.ts')).toBe('C:\\repo\\src\\a.ts')
  expect(absolute('windows', 'C:\\repo', 'C:\\Profiles\\me', '~/notes/x.md')).toBe('C:\\Profiles\\me\\notes\\x.md')
  expect(absolute('windows', 'C:\\repo', 'C:\\Profiles\\me', '~\\notes\\x.md')).toBe('C:\\Profiles\\me\\notes\\x.md')
  expect(absolute('windows', 'C:\\repo', 'C:\\Profiles\\me', 'D:/data/x.csv')).toBe('D:\\data\\x.csv')
  expect(absolute('linux', '/repo', '/homes/me', '~/x')).toBe('/homes/me/x')
  expect(absolute('mac', '/repo/', '/homes/me', 'a.md')).toBe('/repo/a.md')
  expect(absolute('mac', '/repo', '/homes/me', '/etc/hosts')).toBe('/etc/hosts')

  // Windows and macOS ignore case, Linux does not; either separator; never a prefix trick.
  expect(isInside('c:\\REPO\\Src\\a.ts', ['C:\\repo'], 'windows')).toBe(true)
  expect(isInside('C:/repo/src/a.ts', ['C:\\repo\\'], 'windows')).toBe(true)
  expect(isInside('C:\\repo-other\\a.ts', ['C:\\repo'], 'windows')).toBe(false)
  expect(isInside('D:\\repo\\a.ts', ['C:\\repo'], 'windows')).toBe(false)
  expect(isInside('/REPO/a.ts', ['/repo'], 'mac')).toBe(true)
  expect(isInside('/REPO/a.ts', ['/repo'], 'linux')).toBe(false)
  expect(isInside('/repo/a.ts', ['/repo'], 'linux')).toBe(true)
  expect(sameForm('windows', 'C:\\Repo\\')).toBe('c:/repo')
  expect(sameForm('linux', '/Repo/')).toBe('/Repo')

  expect(relTo('C:\\repo\\src\\a.ts', ['C:\\repo'], 'windows')).toBe('src/a.ts')
  expect(relTo('/wt/feature/docs/x.md', ['/repo', '/wt/feature'], 'linux')).toBe('docs/x.md')
  expect(relTo('/elsewhere/x.md', ['/repo'], 'linux')).toBe('/elsewhere/x.md')
  expect([nameOf('C:\\repo\\src\\a.ts'), folderOf('C:\\repo\\src\\a.ts')]).toEqual(['a.ts', 'C:\\repo\\src'])
})

test("Windows spellings that lead elsewhere: device names, streams, trailing dots, short names, network paths", () => {
  for (const path of ['C:\\repo\\CON', 'C:\\repo\\nul.txt', 'C:\\repo\\aux\\x.md', 'C:\\repo\\COM1', 'C:\\repo\\lpt9.log', 'C:\\repo\\Con .txt']) {
    expect(windowsProblem(path)).toMatch(/a name Windows keeps for a device$/)
  }
  expect(windowsProblem('C:\\repo\\a.txt:secret')).toMatch(/an NTFS stream/)
  expect(windowsProblem('C:\\repo\\.env.')).toMatch(/ending in a dot or a space/)
  expect(windowsProblem('C:\\repo\\README.md ')).toMatch(/ending in a dot or a space/)
  expect(windowsProblem('C:\\repo\\CREDEN~1.JSO')).toMatch(/short 8\.3 name/)
  expect(windowsProblem('\\\\server\\share\\x.md')).toBe('a network or device path')
  expect(windowsProblem('D:x.md')).toBe('a path relative to a drive')
  for (const path of ['C:\\repo\\console.log', 'C:\\repo\\com10.txt', 'C:\\repo\\conference.md', 'C:\\repo\\..\\repo\\a.md', 'D:\\data\\x.csv']) {
    expect(windowsProblem(path)).toBeNull()
  }
})

test('folders too broad to approve, on each OS', () => {
  const win = (folder: string) => tooBroad('windows', folder, 'C:\\Profiles\\me', 'C:\\Profiles\\me\\.claude')
  expect(win('C:\\')).toBe('the top of a drive')
  expect(win('D:\\')).toBe('the top of a drive')
  expect(win('C:\\Windows\\System32')).toBe("one of the system's own folders")
  expect(win('c:\\program files\\App')).toBe("one of the system's own folders")
  expect(win('C:\\ProgramData')).toBe("one of the system's own folders")
  expect(win('C:\\Profiles')).toBe('a folder that holds your home folder')
  expect(win('C:\\Profiles\\ME')).toBe('your whole home folder')
  expect(win('C:\\Profiles\\me\\.ssh\\keys')).toBe('a folder of keys')
  expect(win('c:\\profiles\\me\\.CLAUDE')).toBe("Claude Code's own folder, or one holding it")
  expect(win('D:\\notes')).toBeNull()
  expect(win('C:\\Profiles\\me\\projects\\site')).toBeNull()

  const linux = (folder: string) => tooBroad('linux', folder, '/homes/me', '/homes/me/.claude')
  expect(linux('/')).toBe('the top of a drive')
  expect(linux('/usr/share/doc')).toBe("one of the system's own folders")
  expect(linux('/etc')).toBe("one of the system's own folders")
  expect(linux('/homes')).toBe('a folder that holds your home folder')
  expect(linux('/tmp')).toBe('a folder every user or volume shares')
  expect(linux('/homes/me/.gnupg/x')).toBe('a folder of keys')
  expect(linux('/homes/Me/.ssh')).toBeNull() // Linux names are case-sensitive: another folder
  expect(linux('/var/www/site')).toBeNull()
  expect(linux('/tmp/scratch')).toBeNull()

  const mac = (folder: string) => tooBroad('mac', folder, '/Accounts/me', '/Accounts/me/.claude')
  expect(mac('/Accounts')).toBe('a folder that holds your home folder')
  expect(mac('/System/Library')).toBe("one of the system's own folders")
  expect(mac('/private/etc')).toBe("one of the system's own folders")
  expect(mac('/accounts/ME')).toBe('your whole home folder')
  expect(mac('/Accounts/me/Documents/notes')).toBeNull()
})

test("as the session's repo or folder, a system folder is too broad but a folder under one is not, on each OS", () => {
  const linux = (folder: string, home = '/homes/me') => tooBroad('linux', folder, home, `${home}/.claude`, true)
  expect(linux('/usr/src/app')).toBeNull()
  expect(linux('/root/project', '/root')).toBeNull()
  expect(linux('/usr')).toBe("one of the system's own folders")
  expect(linux('/etc')).toBe("one of the system's own folders")
  expect(linux('/root', '/root')).toBe('your whole home folder')
  expect(linux('/')).toBe('the top of a drive')
  expect(linux('/tmp')).toBe('a folder every user or volume shares')
  expect(linux('/homes/me/.claude/plugins')).toBe("Claude Code's own folder, or one holding it")
  expect(linux('/homes/me/.ssh/keys')).toBe('a folder of keys')
  expect(tooBroad('mac', '/private', '/Accounts/me', '/Accounts/me/.claude', true)).toBe("one of the system's own folders")
  const win = (folder: string) => tooBroad('windows', folder, 'C:\\Profiles\\me', 'C:\\Profiles\\me\\.claude', true)
  expect(win('C:\\Windows')).toBe("one of the system's own folders")
  expect(win('c:\\program files')).toBe("one of the system's own folders")
  expect(win('C:\\Windows\\Temp\\proj')).toBeNull()
  expect(win('D:\\')).toBe('the top of a drive')
})

test('a target is the path as typed first, then path:line:col, then path:line; never a drive letter', () => {
  expect(targets('a.ts')).toEqual([{ path: 'a.ts', line: null, col: null }])
  expect(targets('a.ts:12')).toEqual([{ path: 'a.ts:12', line: null, col: null }, { path: 'a.ts', line: 12, col: null }])
  expect(targets('a.ts:12:5')).toEqual([
    { path: 'a.ts:12:5', line: null, col: null }, { path: 'a.ts', line: 12, col: 5 }, { path: 'a.ts:12', line: 5, col: null },
  ])
  expect(targets('C:\\repo\\a.ts:7').at(-1)).toEqual({ path: 'C:\\repo\\a.ts', line: 7, col: null })
  expect(targets('C:12')).toHaveLength(1)
  expect(targets('a.ts:0').at(-1)?.line).toBe(1)
  const pages = paginate(Array.from({ length: 300 }, (_, i) => `line ${i + 1} ${'x'.repeat(60)}`).join('\n'))
  expect([pageOfLine(pages, 1), pageOfLine(pages, pages[1]?.start ?? 0), pageOfLine(pages, 300), pageOfLine(pages, 9_999)]).toEqual([0, 1, 2, 2])
})

// --- Formats read in plain code --------------------------------------------------------------------------------

// Made by Python's zlib and zipfile (deflate with dynamic Huffman codes), so the inflater meets a
// real encoder's output: a 12 × 6 RGBA PNG with each row's filter different (none, sub, up, average,
// Paeth), a 4 × 2 two-bit palette PNG with a see-through entry, and a .docx.
const PNG_RGBA = 'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAGCAYAAAD37n+BAAAAN0lEQVR42mNgIBEw/mdg+A8h0CQY/mPVwAQi0BXjA8wNDAwN2CQasQszsJDqB5BL/2PDOIT/AwCmMh/yMl0miwAAAABJRU5ErkJggg=='
const PNG_PALETTE = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAgMAAAACxpXwAAAADFBMVEX///8AAAD/AAAAAP8xSkYMAAAAAXRSTlMAQObYZgAAAAxJREFUeNpjkGZ4AgABOQEAe5lCNwAAAABJRU5ErkJggg=='
const DOCX = 'UEsDBBQAAAAIANheRF3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgA2F5EXeFovOg8AQAACwUAABEAAAB3b3JkL2RvY3VtZW50LnhtbNWUO2/CMBDHv8rJQ7dioE+lJGydGag6O8nlUfzqnSHQT18nATq1S9VKLD7d6+/fWdYtlnujYYfErbOpmE2mAtAWrmxtnYqX9fP1owAOypZKO4upOCCLZbboktIVW4M2QBSwnHSpaELwiZRcNGgUT5xHG3OVI6NCdKmWnaPSkyuQOeobLefT6b00qrWil8xdeeitH44V9SaonI8WumSndCo0VkFExztOxcN8KmS2kKdKee4c23u8hL0qIrsnZKQdimyFuAFCVTK8RiaoWo0MV8r4JwgNtgQB92EyyA6aNCqf6UbxbK3yY81wvxyjHJw/h3M6Ri12oFuL34v+7ciKVE3KNzBL+hnhfdsWG8jJdRYqt4e3rfEMLv6FIa3VxwFKV//wCP/EO78w3psL4729MN67X/PK066RX3ss+wRQSwECFAMUAAAACADYXkRdxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIANheRF3haLzoPAEAAAsFAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAACmAQAAAAA='
const DOCX_TEXT = `Peek reads Word files & their text.\nTab\tstop\nnew line\n${[1, 2, 3, 4, 5].map(i => `Paragraph ${i}: the quick brown fox jumps over the lazy dog.\n`).join('')}`

test('a Word file is read out of its zip, a real deflate stream inflated in plain code', () => {
  const xml = unzipEntry(fromBase64(DOCX), 'word/document.xml')
  expect(xml).not.toBeNull()
  expect(docxText(new TextDecoder().decode(xml ?? new Uint8Array()))).toBe(DOCX_TEXT)
  expect(unzipEntry(fromBase64(DOCX), 'word/missing.xml')).toBeNull()
  expect(unzipEntry(new TextEncoder().encode('not a zip'), 'word/document.xml')).toBeNull()
  expect(odtText('<office:document-styles>style</office:document-styles><office:body><text:h>Title</text:h><text:p>One<text:tab/>two<text:s text:c="3"/>&amp; three<text:line-break/>four</text:p></office:body>'))
    .toBe('Title\nOne\ttwo   & three\nfour\n')
  // A stored (uncompressed) block, and a damaged stream refused plainly.
  expect(Array.from(inflate(new Uint8Array([1, 3, 0, 0xfc, 0xff, 7, 8, 9])))).toEqual([7, 8, 9])
  expect(() => inflate(new Uint8Array([0x05]))).toThrow(/damaged/)
  // Never more than its limit: a zip entry or a PNG that inflates past it is refused, not decoded.
  expect(Array.from(inflate(new Uint8Array([1, 3, 0, 0xfc, 0xff, 7, 8, 9]), 0, 3))).toEqual([7, 8, 9])
  expect(() => inflate(new Uint8Array([1, 3, 0, 0xfc, 0xff, 7, 8, 9]), 0, 2)).toThrow(/more than 2 bytes/)
})

test("a PNG's pixels are decoded in plain code: every row filter, palettes and transparency", () => {
  const px = pngPixels(fromBase64(PNG_RGBA))
  expect(px && [px.width, px.height]).toEqual([12, 6])
  const at = (x: number, y: number) => Array.from(px?.rgba.subarray((y * 12 + x) * 4, (y * 12 + x) * 4 + 4) ?? [])
  expect([at(0, 0), at(1, 1), at(2, 2), at(11, 5), at(6, 3)]).toEqual([[0, 0, 0, 0], [0, 255, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]])
  const pal = pngPixels(fromBase64(PNG_PALETTE))
  expect(Array.from(pal?.rgba ?? [])).toEqual([255, 255, 255, 0, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 0])
  // Stored blocks too (the test's own encoder), and a round trip of its pixels.
  const own = picture(40, 3)
  expect(Array.from(pngPixels(pngFile(40, 3, own.rgba))?.rgba ?? [])).toEqual(Array.from(own.rgba))
})

test('picture sizes from the header: PNG, JPEG, GIF, BMP and WebP', () => {
  expect(imageSize(fromBase64(PNG_RGBA))).toEqual({ width: 12, height: 6, format: 'PNG' })
  expect(imageSize(jpegHead(640, 480))).toEqual({ width: 640, height: 480, format: 'JPEG' })
  expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]))).toEqual({ width: 800, height: 600, format: 'GIF' })
  const webp = new Uint8Array(30)
  webp.set([...'RIFF'].map(c => c.charCodeAt(0)), 0)
  webp.set([...'WEBPVP8X'].map(c => c.charCodeAt(0)), 8)
  webp.set([0xff, 0x03, 0x00, 0xdf, 0x01, 0x00], 24) // 1024 × 480, each less one
  expect(imageSize(webp)).toEqual({ width: 1024, height: 480, format: 'WEBP' })
  expect(imageSize(new TextEncoder().encode('just text, not a picture'))).toBeNull()
})

test("a WAV's and an MP3's facts from their headers", () => {
  const wav = wavFacts(wavFile(2))
  expect(wav && soundLine(wav)).toBe('0:02 · pcm 16-bit in WAVE · 22,050 Hz · mono')
  const vbr = mp3Facts(mp3Head(1_000))
  expect(vbr && soundLine(vbr)).toBe('0:26 · mp3 VBR · 44,100 Hz · stereo')
  const cbr = mp3Facts(mp3Head(), 10 + 1_600_000)
  expect(cbr && soundLine(cbr)).toBe('1:40 · mp3 128 kb/s · 44,100 Hz · stereo')
  expect(wavFacts(mp3Head())).toBeNull()
  expect(mp3Facts(wavFile(1))).toBeNull()
})

// --- The tools each view falls back on, per OS -------------------------------------------------------------------

// A host as each OS has it: files in memory, commands answered by `answer`, and every command noted.
const hostOn = (os: Os, files: Record<string, string> = {}, answer: (argv: readonly string[]) => Answer = () => undefined) => {
  const ran: { argv: readonly string[]; timeoutMs: number; env?: Record<string, string> }[] = []
  const written: { path: string; text: string }[] = []
  const host: Host = {
    os,
    config: os === 'windows' ? 'C:\\Profiles\\me\\.claude' : '/homes/me/.claude',
    exec: async (argv, init) => {
      ran.push({ argv, timeoutMs: init.timeoutMs, env: init.env })
      const out = answer(argv)
      if (typeof out === 'string') return { exitCode: 0, stdout: out, stderr: '' }
      if (out && 'missing' in out) throw new Error(`Executable not found in $PATH: "${argv[0]}"`)
      return { exitCode: 1, stdout: '', stderr: out && 'fail' in out ? out.fail : 'not mocked' }
    },
    read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
    bytes: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
    write: async (path, text) => {
      files[path] = text
      written.push({ path, text })
    },
  }
  return { host, ran, written, files }
}

// A shell by name. PowerShell runs one fixed call on Windows, the .env save's swap, and nothing else.
const SHELLS = /^(?:.*[\\/])?(?:sh|bash|zsh|dash|cmd|cmd\.exe)$/i
const MAC_ONLY = ['sips', 'afinfo', 'textutil', 'qlmanage']
const pdf = (os: Os) => (os === 'windows' ? 'C:\\repo\\paper.pdf' : '/repo/paper.pdf')

test('PDF text: pdftotext where it is installed; where not, one line naming it and how to get it on this OS', async () => {
  const hints: Record<Os, string> = {
    mac: 'PDF text needs pdftotext (macOS: brew install poppler).',
    linux: 'PDF text needs pdftotext (Debian/Ubuntu: apt install poppler-utils).',
    windows: 'PDF text needs pdftotext (Windows: winget install oschwartz10612.Poppler).',
  }
  for (const os of OSES) {
    const missing = hostOn(os, {}, () => ({ missing: true }))
    expect((await load(missing.host, pdf(os), 5_000, null, 'paper.pdf')).note).toBe(hints[os])
    const present = hostOn(os, {}, argv => (argv[0] === 'pdfinfo' ? 'Pages:          2\nPage size:      612 x 792 pts (letter)\n' : argv[0] === 'pdftotext' ? 'Hello from page one\n' : undefined))
    const shown = await load(present.host, pdf(os), 5_000, null, 'paper.pdf')
    expect([shown.info, shown.note, shown.body]).toEqual(['2 pages · 612 x 792 pts (letter) · 5 KB', null, { as: 'text', text: 'Hello from page one' }])
    expect(present.ran.map(r => r.argv)).toEqual([['pdfinfo', pdf(os)], ['pdftotext', '-f', '1', '-l', '1', '-enc', 'UTF-8', pdf(os), '-']])
  }
})

test('Word files are read in plain code on every OS; old .doc and RTF need macOS', async () => {
  for (const os of OSES) {
    const path = os === 'windows' ? 'C:\\repo\\memo.docx' : '/repo/memo.docx'
    const word = hostOn(os, { [path]: DOCX })
    const shown = await load(word.host, path, fromBase64(DOCX).length, null, 'memo.docx')
    expect(shown.body).toEqual({ as: 'text', text: DOCX_TEXT })
    expect(word.ran).toEqual([]) // no tool at all
    const old = hostOn(os, {}, argv => (argv[0] === 'textutil' ? 'Old memo text\n' : { missing: true }))
    const doc = await load(old.host, os === 'windows' ? 'C:\\repo\\old.doc' : '/repo/old.doc', 9_000, null, 'old.doc')
    if (os === 'mac') expect(doc.body).toEqual({ as: 'text', text: 'Old memo text\n' })
    else expect(doc.note).toBe("Old Word (.doc) text needs macOS's textutil: open it on a Mac, or save it as .docx.")
  }
})

test('sound: WAV and MP3 facts in plain code; the waveform by ffmpeg, or a line on how to get it', async () => {
  const wave: Record<Os, string> = {
    mac: 'The waveform needs ffmpeg (macOS: brew install ffmpeg).',
    linux: 'The waveform needs ffmpeg (Debian/Ubuntu: apt install ffmpeg).',
    windows: 'The waveform needs ffmpeg (Windows: winget install Gyan.FFmpeg).',
  }
  for (const os of OSES) {
    const path = os === 'windows' ? 'C:\\repo\\take.wav' : '/repo/take.wav'
    const bytes = wavFile(2)
    const bare = hostOn(os, { [path]: toBase64(bytes) }, () => ({ missing: true }))
    const shown = await load(bare.host, path, bytes.length, null, 'take.wav')
    expect([shown.info, shown.note]).toEqual(['0:02 · pcm 16-bit in WAVE · 22,050 Hz · mono · 86 KB', wave[os]])
    expect(bare.ran.map(r => r.argv[0])).toEqual(['ffmpeg'])
  }
  // A format plain code doesn't read: afinfo on macOS, else ffprobe; with neither, one line.
  const m4a = hostOn('linux', {}, () => ({ missing: true }))
  expect((await load(m4a.host, '/repo/song.m4a', 3_000_000, null, 'song.m4a')).note).toBe('This sound needs ffmpeg for its facts and waveform (Debian/Ubuntu: apt install ffmpeg).')
  expect(m4a.ran.map(r => r.argv[0])).toEqual(['ffprobe', 'ffmpeg'])
  const probe = '{"streams":[{"codec_name":"aac","sample_rate":"44100","channels":2}],"format":{"duration":"61","format_long_name":"QuickTime / MOV"}}'
  const win = hostOn('windows', {}, argv => (argv[0] === 'ffprobe' ? probe : { missing: true }))
  const song = await load(win.host, 'C:\\repo\\song.m4a', 3_000_000, null, 'song.m4a')
  expect([song.info, song.note]).toEqual(['1:01 · aac in QuickTime / MOV · 44,100 Hz · stereo · 2.9 MB', 'The waveform needs ffmpeg (Windows: winget install Gyan.FFmpeg).'])
})

test('pictures: sizes and PNG previews in plain code; other formats scaled by sips on macOS, ffmpeg elsewhere, into a scratch file', async () => {
  const jpeg = toBase64(jpegHead(640, 480))
  for (const os of OSES) {
    const path = os === 'windows' ? 'C:\\repo\\photo.jpg' : '/repo/photo.jpg'
    const missing = hostOn(os, { [path]: jpeg }, () => ({ missing: true }))
    const shown = await load(missing.host, path, 36, null, 'photo.jpg')
    expect(shown.info).toBe('640 × 480 px · JPEG · 36 bytes')
    if (os !== 'mac') expect(shown.note).toBe(`Drawing this picture needs ffmpeg (${os === 'linux' ? 'Debian/Ubuntu: apt install ffmpeg' : 'Windows: winget install Gyan.FFmpeg'}).`)
    const scratch = os === 'windows' ? 'C:\\Profiles\\me\\.claude\\peek\\scratch.bmp' : '/homes/me/.claude/peek/scratch.bmp'
    const scaler = missing.ran.find(r => r.argv.at(-1) === scratch)?.argv ?? []
    expect(scaler[0]).toBe(os === 'mac' ? 'sips' : 'ffmpeg')
    if (os !== 'mac') expect(scaler).toEqual(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', path, '-vf', 'scale=w=640:h=640:force_original_aspect_ratio=decrease,format=bgra', '-frames:v', '1', '-update', '1', scratch])
  }
  // With the tool there, its picture comes back by way of the scratch file, emptied once read, so no
  // copy of the picture stays.
  const scratch = '/homes/me/.claude/peek/scratch.bmp'
  const drawn = hostOn('linux', { '/repo/photo.jpg': jpeg }, argv => {
    if (argv[0] !== 'ffmpeg') return { missing: true }
    drawn.files[argv.at(-1) ?? ''] = toBase64(bmpFile(64, 48))
    return ''
  })
  const photo = await load(drawn.host, '/repo/photo.jpg', 36, null, 'photo.jpg')
  expect(photo.body?.as === 'image' && photo.body.pixels && [photo.body.pixels.width, photo.body.pixels.height]).toEqual([64, 48])
  expect(drawn.files[scratch]).toBe('')
  const png = toBase64(pngFile(40, 3, picture(40, 3).rgba))
  const plain = hostOn('windows', { 'C:\\repo\\bar.png': png }, () => ({ missing: true }))
  const bar = await load(plain.host, 'C:\\repo\\bar.png', fromBase64(png).length, null, 'bar.png')
  expect([bar.note, bar.body?.as === 'image' && bar.body.pixels?.width, bar.body?.as === 'image' && !!bar.body.png]).toEqual([null, 40, true])
  expect(plain.ran).toEqual([])
})

test('a converter that fails part way, or runs out of time, leaves nothing of the picture in the scratch file', async () => {
  const jpeg = toBase64(jpegHead(640, 480))
  const scratch = '/homes/me/.claude/peek/scratch.bmp'
  for (const ending of ['exit code 1', 'timeout']) {
    const half = hostOn('linux', { '/repo/photo.jpg': jpeg })
    half.host.exec = async argv => {
      if (argv[0] !== 'ffmpeg') throw new Error(`Executable not found in $PATH: "${argv[0]}"`)
      half.files[argv.at(-1) ?? ''] = 'PARTIAL-PICTURE-BYTES'
      if (ending === 'timeout') throw new Error('timed out after 30000 ms')
      return { exitCode: 1, stdout: '', stderr: 'ffmpeg: out of memory' }
    }
    await load(half.host, '/repo/photo.jpg', 36, null, 'photo.jpg')
    expect([ending, half.files[scratch]]).toEqual([ending, ''])
  }
})

test('video facts by ffprobe, or a line on how to get it', async () => {
  const bare = hostOn('linux', {}, () => ({ missing: true }))
  expect((await load(bare.host, '/repo/clip.mp4', 900_000, null, 'clip.mp4')).note).toBe('A video needs ffprobe for its facts (Debian/Ubuntu: apt install ffmpeg).')
})

// --- The .env save, per OS ----------------------------------------------------------------------------------------

test('the .env save on macOS and Linux: a private folder beside it, the text there, its mode, one rename', async () => {
  for (const os of ['mac', 'linux'] as const) {
    const disk = hostOn(os, {}, argv => (argv[0] === 'stat' ? '600\n' : argv[0] === 'mktemp' ? '/repo/.peek-1a2b3c4d\n' : ''))
    expect(await saveAtomic(disk.host, '/repo/.env', 'K=v\n')).toBeNull()
    const temp = '/repo/.peek-1a2b3c4d/.env'
    expect(disk.ran.map(r => r.argv)).toEqual([
      os === 'mac' ? ['stat', '-f', '%Lp', '/repo/.env'] : ['stat', '-c', '%a', '/repo/.env'],
      ['mktemp', '-d', '/repo/.peek-XXXXXXXX'],
      ['chmod', '600', temp],
      ['mv', '-f', temp, '/repo/.env'],
      ['rm', '-f', temp],
      ['rmdir', '/repo/.peek-1a2b3c4d'],
    ])
    expect(disk.written).toEqual([{ path: temp, text: 'K=v\n' }])
  }
  // A rename that fails says so, and the private folder still goes.
  const failing = hostOn('linux', {}, argv => (argv[0] === 'stat' ? '644\n' : argv[0] === 'mktemp' ? '/repo/.peek-00000000\n' : argv[0] === 'mv' ? { fail: 'mv: cannot move: Permission denied' } : ''))
  expect(await saveAtomic(failing.host, '/repo/.env', 'K=v\n')).toBe('mv failed: mv: cannot move: Permission denied')
  expect(failing.ran.map(r => r.argv[0]).slice(-2)).toEqual(['rm', 'rmdir'])
})

test('the .env save on Windows: a temporary file beside it, swapped in by File.Replace, the paths in variables', async () => {
  const disk = hostOn('windows', {}, argv => (argv[0] === 'powershell.exe' ? '' : undefined))
  expect(await saveAtomic(disk.host, 'C:\\repo\\.env', 'K=v\r\n')).toBeNull()
  const [write] = disk.written
  expect(write?.path).toMatch(/^C:\\repo\\\.env\.peek-[0-9a-f]{8}\.tmp$/)
  expect(write?.text).toBe('K=v\r\n')
  expect(disk.ran).toEqual([{ argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', REPLACE], timeoutMs: 20_000, env: { PEEK_FROM: write?.path ?? '', PEEK_TO: 'C:\\repo\\.env' } }])
  // The command text holds no path and no value: both travel in variables.
  expect(REPLACE).toContain('[System.IO.File]::Replace($env:PEEK_FROM, $env:PEEK_TO, [NullString]::Value)')
  expect(REPLACE).not.toContain('repo')
  const failing = hostOn('windows', {}, () => ({ fail: 'Access to the path is denied.' }))
  expect(await saveAtomic(failing.host, 'C:\\repo\\.env', 'K=v')).toBe('powershell.exe failed: Access to the path is denied.')
  // PowerShell deletes the temporary file when the swap fails; when it couldn't run, peek empties it.
  expect(failing.written.map(w => w.text)).toEqual(['K=v', ''])
  expect(failing.written[1]?.path).toBe(failing.written[0]?.path)
})

// --- The whole mod under Windows and Linux --------------------------------------------------------------------

test('on Windows: drive-letter paths, case ignored, device names and streams refused, the list joined with backslashes', async ($, on) => {
  const { ran } = world(on, {
    os: 'windows',
    stats: {
      'C:\\repo\\README.md': { realPath: 'C:\\repo\\README.md', mtimeMs: 1_759_400_000_000 },
      'c:\\REPO\\readme.md': { realPath: 'C:\\repo\\README.md' },
      'C:\\repo\\src\\a.ts': { realPath: 'C:\\repo\\src\\a.ts', mtimeMs: 1_759_300_000_000 },
      'C:\\Profiles\\me\\x.md': { realPath: 'C:\\Profiles\\me\\x.md' },
    },
    files: { 'C:\\repo\\README.md': '# Hi\n', 'C:\\repo\\src\\a.ts': 'one\ntwo\nthree\n' },
    answer: argv => {
      if (argv.join(' ') === 'git rev-parse --show-toplevel') return 'C:/repo\n'
      if (argv.join(' ') === 'git ls-files -co --exclude-standard -z') return 'README.md\0src/a.ts\0.env\0'
      return undefined
    },
  })
  await start($, 'windows')
  expect(await peek($, 'README.md')).toBe('Peek: README.md')
  expect(await peek($, 'c:\\REPO\\readme.md')).toBe('Peek: c:\\REPO\\readme.md')
  expect(await peek($, 'src\\a.ts:2')).toBe('Peek: src\\a.ts:2')
  let ui = await mountPane($)
  expect(JSON.stringify(await ui.find({ key: 'mark' }))).toContain('two')
  expect(await ui.find({ text: /^🔭 C:\\repo\\src\\a\.ts$/ })).toBeDefined()
  await ui.unmount()
  expect(await peek($, '~\\x.md')).toMatch(/is outside them/)
  expect(await peek($, 'CON')).toBe("Peek won't open CON: CON: a name Windows keeps for a device.")
  expect(await peek($, 'README.md:hidden')).toBe("Peek won't open README.md:hidden: README.md:hidden: a name with a colon (an NTFS stream).")
  expect(await peek($, '.env.')).toBe("Peek won't open .env.: .env.: a name ending in a dot or a space, which Windows drops.")
  expect(await peek($, '')).toBe('Peek: pick a file')
  ui = await mountPane($)
  expect(await rows(ui)).toEqual(['README.md · 1m', 'src/a.ts · 1d'])
  expect(await ui.find({ key: 'file:C:\\repo\\src\\a.ts' })).toBeDefined()
  await ui.unmount()
  expect(ran.every(r => !SHELLS.test(r.argv[0] ?? '') && !MAC_ONLY.includes(r.argv[0] ?? ''))).toBe(true)
})

test('on Linux: letter case counts, so /REPO is not /repo', async ($, on) => {
  world(on, {
    os: 'linux',
    stats: { '/repo/README.md': { realPath: '/repo/README.md' }, '/REPO/readme.md': { realPath: '/REPO/readme.md' } },
    files: { '/repo/README.md': '# Hi\n', '/REPO/readme.md': '# Other\n' },
  })
  await start($, 'linux')
  expect(await peek($, 'README.md')).toBe('Peek: README.md')
  expect(await peek($, '/REPO/readme.md')).toMatch(/is outside them/)
})

test('Windows approved folders: drive roots and system folders refused, another drive allowed, removed case-blind', async ($, on) => {
  const { stored } = world(on, {
    os: 'windows',
    stats: {
      'C:\\': { realPath: 'C:\\', kind: 'dir' },
      'C:\\Windows\\System32': { realPath: 'C:\\Windows\\System32', kind: 'dir' },
      'D:\\notes': { realPath: 'D:\\notes', kind: 'dir' },
      'd:\\NOTES': { realPath: 'D:\\notes', kind: 'dir' },
      'D:\\notes\\todo.md': { realPath: 'D:\\notes\\todo.md' },
    },
    files: { 'D:\\notes\\todo.md': '# Todo\n' },
  })
  on('ui.focus', () => ({ value: {} }) as never)
  await start($, 'windows')
  expect(await peek($, 'allow C:\\')).toBe("Peek won't approve C:\\: it is the top of a drive.")
  expect(await peek($, 'allow C:\\Windows\\System32')).toBe("Peek won't approve C:\\Windows\\System32: it is one of the system's own folders.")
  expect(await peek($, 'allow D:\\notes')).toBe('Peek: approve this folder?')
  const ui = await mountPane($)
  await ui.press({ key: 'allow-yes' })
  await ui.unmount()
  expect(stored.allowed).toEqual(['D:\\notes'])
  expect(await peek($, 'D:\\notes\\todo.md')).toBe('Peek: D:\\notes\\todo.md')
  expect(await peek($, 'disallow d:\\NOTES')).toBe('Peek no longer shows files in D:\\notes.')
  expect(stored.allowed).toEqual([])
})

test('every command peek runs is an argument vector with a timeout: no shell, and no macOS-only tool off macOS', async () => {
  for (const os of OSES) {
    const all = hostOn(os, {}, () => ({ missing: true }))
    for (const name of ['paper.pdf', 'photo.heic', 'song.m4a', 'clip.mov', 'old.rtf', 'memo.docx']) {
      await load(all.host, `${os === 'windows' ? 'C:\\repo\\' : '/repo/'}${name}`, 5_000_000, null, name)
    }
    await saveAtomic(all.host, os === 'windows' ? 'C:\\repo\\.env' : '/repo/.env', 'K=v')
    expect(all.ran.length).toBeGreaterThan(5)
    for (const { argv, timeoutMs } of all.ran) {
      expect(SHELLS.test(argv[0] ?? '')).toBe(false)
      expect(timeoutMs).toBeGreaterThan(0)
      if (os !== 'mac') expect(MAC_ONLY).not.toContain(argv[0])
      if (/powershell/i.test(argv[0] ?? '')) expect(argv).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', REPLACE])
    }
  }
})
