// What peek decides from the text it was handed: pure, so the tests read it.

import type { Os } from './paths'

export type Kind = 'markdown' | 'csv' | 'tsv' | 'json' | 'image' | 'pdf' | 'doc' | 'audio' | 'video' | 'html' | 'text'

const KINDS: Record<string, Kind> = {
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  csv: 'csv', tsv: 'tsv', json: 'json',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', heic: 'image', heif: 'image',
  tif: 'image', tiff: 'image', bmp: 'image', webp: 'image',
  pdf: 'pdf',
  docx: 'doc', doc: 'doc', rtf: 'doc', odt: 'doc',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', aif: 'audio', aiff: 'audio', aifc: 'audio',
  caf: 'audio', flac: 'audio', ogg: 'audio', opus: 'audio',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', mkv: 'video', avi: 'video',
  html: 'html', htm: 'html',
}

// By the file's extension; anything else is shown as text (a binary one is caught when read).
export const kindOf = (path: string): Kind => KINDS[/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''] ?? 'text'

// --- Secret files: the kit's own list --------------------------------------------------------

export type Secrets = { patterns: RegExp[]; template: RegExp; env: RegExp | null }

// The kit guard's DEFAULT_SECRETS and TEMPLATE, read from protect-env.mjs as it stands, plus a
// repo's `protect.secrets`. null when either can't be found, so the caller refuses everything
// rather than guard with a weaker list.
export const secretsFrom = (guard: string, extra: readonly string[] = []): Secrets | null => {
  const list = /const DEFAULT_SECRETS = \[([\s\S]*?)\];/.exec(guard)?.[1]
  const template = /const TEMPLATE = \/(.+)\/([a-z]*);/.exec(guard)
  const names = [...(list ?? '').matchAll(/["']([^"']+)["']/g)].map(m => m[1] ?? '')
  if (!names.length || !template?.[1]) return null
  const patterns = [...names, ...extra].map(compile)
  // The kit's own `.env*` entry: the one family the .env editor opens.
  const env = names.includes('.env*') ? (patterns[names.indexOf('.env*')] ?? null) : null
  return { patterns, template: new RegExp(template[1], template[2]), env }
}

// `protect.secrets` from a .claude/odyssey.json; it only adds patterns, as in the kit.
export const extraSecrets = (json: string): string[] => {
  try {
    const listed = (JSON.parse(json) as { protect?: { secrets?: unknown } }).protect?.secrets
    return Array.isArray(listed) ? listed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

// protect-env.mjs's compile(), the same matching: without a slash a pattern matches a file name,
// with one the end of the path; * matches within one name, **/ any number of folders; case ignored.
const compile = (pattern: string) => {
  const body = pattern
    .replaceAll('\\', '/')
    .replace(/^(?:\.?\/)+/, '')
    .split('**/')
    .map(piece => piece.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('(?:[^/]*/)*')
  return new RegExp(`(?:^|/)${body}$`, 'i')
}

export const isSecret = (file: string, secrets: Secrets): boolean => {
  const slashed = file.replaceAll('\\', '/')
  return !secrets.template.test(slashed) && secrets.patterns.some(re => re.test(slashed))
}

// A secret only by the kit's `.env*` entry, and by no other pattern (keys, certificates and
// credential files stay refused): the files the masked .env editor may open.
export const isEnvFile = (file: string, secrets: Secrets): boolean => {
  const slashed = file.replaceAll('\\', '/')
  const env = secrets.env
  return !!env && isSecret(file, secrets) && env.test(slashed) && !secrets.patterns.some(re => re !== env && re.test(slashed))
}

// --- Folders: the session's repo and its worktrees --------------------------------------------

// `git worktree list --porcelain` -> each worktree's folder.
export const worktreesFrom = (porcelain: string): string[] =>
  porcelain.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length))

// --- Text: cleaned and cut into pages ----------------------------------------------------------

export const PAGE = 8_000 // characters a page holds; an element takes 10,000 at most

// The elements take tab and newline as their only control characters: colour codes go, the rest
// becomes a replacement mark.
export const clean = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '\ufffd')

export type Chunk = { start: number; text: string }

// Whole lines into pages of at most `budget` characters; `start` is the page's first line number.
// ponytail: a line longer than a page is cut across pages, so numbers after it drift on that page.
export const paginate = (text: string, budget = PAGE): Chunk[] => {
  const pages: Chunk[] = []
  let lines: string[] = []
  let size = 0
  let start = 1
  text.split('\n').forEach((line, i) => {
    for (let at = 0; at === 0 || at < line.length; at += budget) {
      const piece = line.slice(at, at + budget)
      if (lines.length && size + piece.length + 1 > budget) {
        pages.push({ start, text: lines.join('\n') })
        lines = []
        size = 0
        start = i + 1
      }
      lines.push(piece)
      size += piece.length + 1
    }
  })
  if (lines.length) pages.push({ start, text: lines.join('\n') })
  return pages
}

// CSV (quotes, doubled quotes, separators and newlines inside quotes) or TSV, by `sep`.
export const parseDelimited = (text: string, sep: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted && c === '"' && text[i + 1] === '"') {
      cell += '"'
      i++
    } else if (quoted && c === '"') {
      quoted = false
    } else if (quoted) {
      cell += c
    } else if (c === '"' && cell === '') {
      quoted = true
    } else if (c === sep) {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      rows.push([...row, cell])
      row = []
      cell = ''
    } else if (c !== '\r') {
      cell += c
    }
  }
  if (cell !== '' || row.length) rows.push([...row, cell])
  return rows
}

// Rows as Markdown tables of at most `budget` characters, the header repeated on each page, a
// cell cut at 200 characters; `start` is the page's first data row.
export const tablePages = (rows: string[][], budget = PAGE): Chunk[] => {
  const width = Math.max(1, ...rows.map(r => r.length))
  const cell = (text = '') => (text.length > 200 ? `${text.slice(0, 199)}…` : text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const line = (r: readonly string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`
  const head = `${line(rows[0] ?? [])}\n|${' --- |'.repeat(width)}`
  return paginate(rows.slice(1).map(line).join('\n'), Math.max(1_000, budget - head.length - 1)).map(page => ({
    start: page.start,
    text: `${head}\n${page.text}`,
  }))
}

// --- Audio: afinfo's report, else ffprobe's ------------------------------------------------------

export type Sound = { seconds: number | null; format: string; rate: number | null; channels: number | null }

export const soundFromAfinfo = (out: string): Sound | null => {
  const data = /Data format:\s+(\d+) ch,\s+(\d+) Hz, '?([^\s(']+)/.exec(out)
  if (!data) return null
  const seconds = /estimated duration: ([\d.]+) sec/.exec(out)?.[1]
  const type = /File type ID:\s+(\S+)/.exec(out)?.[1]
  return {
    seconds: seconds ? Number(seconds) : null,
    format: [data[3], type && `in ${type}`].filter(Boolean).join(' '),
    rate: Number(data[2]),
    channels: Number(data[1]),
  }
}

type Probe = { streams?: { codec_name?: string; sample_rate?: string; channels?: number }[]; format?: { duration?: string; format_long_name?: string } }

export const soundFromFfprobe = (json: string): Sound | null => {
  try {
    const probe = JSON.parse(json) as Probe
    const stream = probe.streams?.[0]
    if (!stream) return null
    return {
      seconds: probe.format?.duration ? Number(probe.format.duration) : null,
      format: [stream.codec_name, probe.format?.format_long_name && `in ${probe.format.format_long_name}`].filter(Boolean).join(' '),
      rate: stream.sample_rate ? Number(stream.sample_rate) : null,
      channels: stream.channels ?? null,
    }
  } catch {
    return null
  }
}

// `ffprobe -show_entries format=duration:stream=codec_name,width,height -of json`, as one line.
export const videoLine = (json: string): string | null => {
  try {
    const probe = JSON.parse(json) as { streams?: { codec_name?: string; width?: number; height?: number }[]; format?: { duration?: string } }
    const stream = probe.streams?.[0]
    if (!stream) return null
    const seconds = Number(probe.format?.duration)
    return [Number.isFinite(seconds) ? clock(seconds) : null, stream.codec_name, stream.width && `${stream.width} × ${stream.height}`].filter(Boolean).join(' · ')
  } catch {
    return null
  }
}

export const clock = (seconds: number): string => {
  const s = Math.round(seconds)
  const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
  return (hms[0] ? hms : hms.slice(1)).map((n, i) => (i ? String(n).padStart(2, '0') : String(n))).join(':')
}

export const soundLine = (sound: Sound): string =>
  [
    sound.seconds === null ? null : clock(sound.seconds),
    sound.format,
    sound.rate && `${sound.rate.toLocaleString('en-US')} Hz`,
    sound.channels && (sound.channels === 1 ? 'mono' : sound.channels === 2 ? 'stereo' : `${sound.channels} channels`),
  ]
    .filter(Boolean)
    .join(' · ')

export const bytesLine = (n: number): string =>
  n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`

// --- Pictures: BMP pixels in, half-block cells out -----------------------------------------------

export const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0))
export const toBase64 = (bytes: Uint8Array): string => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

// A PNG's size, from its header.
export const pngSize = (b64: string): { width: number; height: number } | null => {
  const head = fromBase64(b64.slice(0, 32))
  if (head.length < 24 || head[1] !== 0x50) return null
  const view = new DataView(head.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

// The BMPs sips (24-bit BGR, or 32-bit bit fields with alpha) and ffmpeg (32-bit bgra) write, as
// RGBA rows top first.
export const bmpPixels = (bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null => {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(10, true)
  const header = view.getUint32(14, true)
  const width = view.getInt32(18, true)
  const signed = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  const fields = view.getUint32(30, true) === 3
  const height = Math.abs(signed)
  const step = bits / 8
  const stride = Math.ceil((width * step) / 4) * 4
  if ((bits !== 24 && bits !== 32) || width <= 0 || height === 0 || offset + stride * height > bytes.length) return null
  const masks = fields
    ? [54, 58, 62, header >= 56 ? 66 : -1].map(at => (at < 0 ? 0 : view.getUint32(at, true)))
    : [0x00ff0000, 0x0000ff00, 0x000000ff, bits === 32 ? 0xff000000 : 0]
  const shifts = masks.map(m => (m ? Math.clz32(m & -m) ^ 31 : 0))
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = signed > 0 ? height - 1 - y : y
    for (let x = 0; x < width; x++) {
      const at = offset + row * stride + x * step
      const px = bits === 32 ? view.getUint32(at, true) : view.getUint16(at, true) | ((bytes[at + 2] ?? 0) << 16)
      for (let c = 0; c < 4; c++) {
        const mask = masks[c] ?? 0
        rgba[(y * width + x) * 4 + c] = mask ? ((px & mask) >>> (shifts[c] ?? 0)) & 0xff : 255
      }
    }
  }
  return { width, height, rgba }
}

const DEFAULT = 0x01000000 // the terminal's own colour

export type Image = { width: number; height: number; rgba: Uint8Array }
export type Lens = { step: number; cx: number; cy: number } // zoom steps past fit; the view's centre, 0..1 of the image
export const FIT: Lens = { step: 0, cx: 0.5, cy: 0.5 }

// What the half blocks show of a w × h image in `columns` × `rows` cells (two pixels a cell, one
// above the other, so a half cell is about square). Fit shows it whole; each step doubles the
// scale, up to 1 image pixel per half cell (100%). `left`, `top`, `width`, `height` are the image
// pixels in view; `columns` × `rows` the cells drawn.
export const frame = (w: number, h: number, columns: number, rows: number, lens: Lens) => {
  const fit = Math.min(1, columns / w, (rows * 2) / h)
  const steps = Math.max(0, Math.ceil(Math.log2(1 / fit) - 1e-9))
  const step = Math.max(0, Math.min(steps, lens.step))
  const scale = Math.min(1, fit * 2 ** step)
  const width = Math.min(w, columns / scale)
  const height = Math.min(h, (rows * 2) / scale)
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, v))
  const left = clamp(lens.cx * w - width / 2, w - width)
  const top = clamp(lens.cy * h - height / 2, h - height)
  const across = Math.max(1, Math.min(columns, Math.round(width * scale)))
  const down = Math.max(1, Math.min(rows * 2, Math.round(height * scale)))
  return { scale, step, steps, left, top, width, height, columns: across, pixelRows: down, rows: Math.ceil(down / 2) }
}

// The lens moved by (dx, dy) half views, its centre kept where the whole view stays on the image.
export const pan = (w: number, h: number, columns: number, rows: number, lens: Lens, dx: number, dy: number): Lens => {
  const f = frame(w, h, columns, rows, lens)
  const keep = (c: number, seen: number, size: number) => Math.max(seen / 2 / size, Math.min(1 - seen / 2 / size, c))
  return {
    step: f.step,
    cx: keep((f.left + f.width / 2 + (dx * f.width) / 2) / w, f.width, w),
    cy: keep((f.top + f.height / 2 + (dy * f.height) / 2) / h, f.height, h),
  }
}

// The frame's pixels as Raster cells. Each drawn pixel is the average of the image pixels it covers
// (weighted by their alpha), so thin edges and text survive a downscale; a mostly see-through one
// is the terminal's own colour.
export const cellsOf = (px: Image, f: ReturnType<typeof frame>): string => {
  const out = new Uint32Array(f.columns * f.pixelRows)
  const stepX = f.width / f.columns
  const stepY = f.height / f.pixelRows
  for (let oy = 0; oy < f.pixelRows; oy++) {
    const y0 = Math.floor(f.top + oy * stepY)
    const y1 = Math.max(y0 + 1, Math.min(px.height, Math.ceil(f.top + (oy + 1) * stepY)))
    for (let ox = 0; ox < f.columns; ox++) {
      const x0 = Math.floor(f.left + ox * stepX)
      const x1 = Math.max(x0 + 1, Math.min(px.width, Math.ceil(f.left + (ox + 1) * stepX)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * px.width + x) * 4
          const alpha = px.rgba[i + 3] ?? 0
          r += (px.rgba[i] ?? 0) * alpha
          g += (px.rgba[i + 1] ?? 0) * alpha
          b += (px.rgba[i + 2] ?? 0) * alpha
          a += alpha
          n++
        }
      }
      out[oy * f.columns + ox] = a / n < 128 ? DEFAULT : (Math.round(r / a) << 16) | (Math.round(g / a) << 8) | Math.round(b / a)
    }
  }
  const words = new Uint32Array(f.columns * f.rows * 3)
  for (let y = 0; y < f.rows; y++) {
    for (let x = 0; x < f.columns; x++) {
      const top = out[2 * y * f.columns + x] ?? DEFAULT
      const bottom = 2 * y + 1 < f.pixelRows ? (out[(2 * y + 1) * f.columns + x] ?? DEFAULT) : DEFAULT
      const cell = top !== DEFAULT ? [0x2580, top, bottom] : bottom !== DEFAULT ? [0x2584, bottom, DEFAULT] : [0x20, DEFAULT, DEFAULT]
      words.set(cell, (y * f.columns + x) * 3)
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

// --- Wrapping: whole words to the pane's width, the line numbers kept ----------------------------

// One line as rows of at most `width` characters, broken at the last space that fits, a word longer
// than a row cut; rows after the first keep the line's indent (up to a third of the row).
// ponytail: counts characters, not cells, so a row of wide (CJK, emoji) characters can overflow.
export const wrapLine = (line: string, width: number): string[] => {
  const w = Math.max(8, width)
  const hang = (/^[ ]*/.exec(line)?.[0] ?? '').slice(0, Math.floor(w / 3))
  const rows: string[] = []
  let rest = line
  while (rest.length > w) {
    const lead = /^[ ]*/.exec(rest)?.[0].length ?? 0
    const space = rest.lastIndexOf(' ', w)
    const cut = space > lead ? space : w
    rows.push(rest.slice(0, cut).trimEnd())
    rest = hang + rest.slice(cut).trimStart()
  }
  rows.push(rest)
  return rows
}

// A page of numbered lines wrapped to `columns`: the gutter (a number on each line's first row) and
// the rows, one per drawn row, so the two columns stay side by side.
// `digits`: the gutter's width, when the page is drawn in parts that must line up.
export const wrapNumbered = (text: string, start: number, columns: number, digits?: number) => {
  const lines = text.split('\n').map(line => line.replace(/\t/g, '    '))
  const gutter = digits ?? String(start + lines.length - 1).length
  const numbers: string[] = []
  const rows: string[] = []
  lines.forEach((line, i) => {
    wrapLine(line, columns - gutter - 2).forEach((row, j) => {
      numbers.push(j ? '' : String(start + i))
      rows.push(row)
    })
  })
  return { gutter: numbers.map(n => n.padStart(gutter)).join('\n'), rows: rows.join('\n') }
}

// Opening at a line: how many of the `most` lines above `lines[at]` to draw, nearest first, so that,
// wrapped as wrapNumbered wraps them, they take at most `room` rows.
export const contextAbove = (lines: readonly string[], at: number, columns: number, digits: number, room: number, most = 3): number => {
  let n = 0
  for (; n < most && n < at; n++) {
    const rows = wrapLine((lines[at - n - 1] ?? '').replace(/\t/g, '    '), columns - digits - 2).length
    if (rows > room) break
    room -= rows
  }
  return n
}

export const since = (ms: number): string =>
  ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 86_400_000)}d`

// --- Opening at a line: `path:line` and `path:line:col` --------------------------------------------

export type Target = { path: string; line: number | null; col: number | null }

// The spellings to try, in order: the path as typed (a name may itself end in `:12`), then
// `path:line:col`, then `path:line`. A drive letter's colon is never taken for one.
export const targets = (typed: string): Target[] => {
  const out: Target[] = [{ path: typed, line: null, col: null }]
  const both = /^(.+):(\d+):(\d+)$/.exec(typed)
  const one = /^(.+):(\d+)$/.exec(typed)
  if (both?.[1] && !/^[A-Za-z]$/.test(both[1])) out.push({ path: both[1], line: Math.max(1, Number(both[2])), col: Math.max(1, Number(both[3])) })
  if (one?.[1] && !/^[A-Za-z]$/.test(one[1])) out.push({ path: one[1], line: Math.max(1, Number(one[2])), col: null })
  return out
}

// The page holding a line: the last page starting at or before it.
export const pageOfLine = (pages: readonly Chunk[], line: number): number =>
  Math.max(0, pages.findLastIndex(page => page.start <= line))

// --- Diffs: git's unified diff, drawn as runs of like lines ----------------------------------------

export type Change = { path: string; status: string }

// `git diff --name-status -z --no-renames`: a status letter, then the path.
export const changesFrom = (out: string): Change[] => {
  const parts = out.split('\0')
  const changes: Change[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i] ?? ''
    if (/^[A-Z]/.test(status)) changes.push({ status: status[0] ?? '', path: parts[i + 1] ?? '' })
  }
  return changes
}

// `git diff --numstat -z --no-renames`: lines added and removed per path; null for a binary file.
export const countsFrom = (out: string): Map<string, { add: number; del: number } | null> => {
  const counts = new Map<string, { add: number; del: number } | null>()
  for (const record of out.split('\0')) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record)
    if (m?.[3]) counts.set(m[3], m[1] === '-' ? null : { add: Number(m[1]), del: Number(m[2]) })
  }
  return counts
}

const STATUS: Record<string, string> = { M: 'modified', A: 'added', D: 'deleted', T: 'type changed', U: 'unmerged', C: 'copied', R: 'renamed', N: 'new' }
export const statusWord = (status: string): string => STATUS[status] ?? 'changed'

export const isBinaryDiff = (diff: string): boolean => /^(?:Binary files .* differ|GIT binary patch)$/m.test(diff)

// The diff from its first hunk on, the file header (diff --git, index, ---, +++) left out: the pane
// names the file. A mode change and the like stay, as plain lines.
export const diffBody = (diff: string): string => {
  const lines = diff.replace(/\n$/, '').split('\n')
  const hunk = lines.findIndex(l => l.startsWith('@@'))
  const head = (hunk < 0 ? lines : lines.slice(0, hunk)).filter(l => !/^(?:diff --git |index |--- |\+\+\+ )/.test(l))
  return [...head, ...(hunk < 0 ? [] : lines.slice(hunk))].join('\n')
}

// A new, untracked file as a diff: one hunk adding every line.
export const newFileDiff = (text: string): string => {
  const lines = text.replace(/\n$/, '').split('\n')
  if (text === '') return ''
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n')
}

export const tally = (body: string): { add: number; del: number } => {
  let add = 0
  let del = 0
  for (const line of body.split('\n')) {
    if (line[0] === '+') add++
    else if (line[0] === '-') del++
  }
  return { add, del }
}

export type Run = { kind: 'hunk' | 'add' | 'del' | 'same' | 'note'; text: string }

// A page of a diff as runs of like lines, each drawn in one colour: a hunk header on its own.
export const diffRuns = (text: string): Run[] => {
  const runs: Run[] = []
  for (const line of text.split('\n')) {
    const c = line[0]
    const kind: Run['kind'] = line.startsWith('@@') ? 'hunk' : c === '+' ? 'add' : c === '-' ? 'del' : c === ' ' || c === undefined ? 'same' : 'note'
    const last = runs.at(-1)
    if (last && last.kind === kind && kind !== 'hunk') last.text += `\n${line}`
    else runs.push({ kind, text: line })
  }
  return runs
}

// --- The Claude Code this needs ----------------------------------------------------------------------

export const FLOOR = '2.1.288'
export const TOO_OLD = `peek needs Claude Code ${FLOOR} or newer`

// Whether a version (`2.1.290`, `2.1.288-dev.…`) is at least FLOOR.
export const meetsFloor = (version: string | undefined): boolean => {
  const have = /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? '')
  if (!have) return false
  const need = FLOOR.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const ahead = Number(have[i + 1]) - (need[i] ?? 0)
    if (ahead) return ahead > 0
  }
  return true
}

// --- Tools a view needs, and how to get each on each OS --------------------------------------------

export type Fix = 'poppler' | 'ffmpeg'

// Each checked to exist: Homebrew's poppler and ffmpeg formulas, Debian's poppler-utils and ffmpeg
// packages, and winget's oschwartz10612.Poppler and Gyan.FFmpeg (both put their commands on PATH).
const INSTALL: Record<Fix, Record<Os, string>> = {
  poppler: { mac: 'macOS: brew install poppler', linux: 'Debian/Ubuntu: apt install poppler-utils', windows: 'Windows: winget install oschwartz10612.Poppler' },
  ffmpeg: { mac: 'macOS: brew install ffmpeg', linux: 'Debian/Ubuntu: apt install ffmpeg', windows: 'Windows: winget install Gyan.FFmpeg' },
}

// One plain line: what needs which tool, and how to get it on this OS.
export const needs = (what: string, tool: string, fix: Fix, os: Os): string => `${what} needs ${tool} (${INSTALL[fix][os]}).`
