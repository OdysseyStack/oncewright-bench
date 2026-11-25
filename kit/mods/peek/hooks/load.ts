// What each kind of file shows, one page at a time: plain code first, a tool where there is no
// other way, and one plain line naming the tool (and how to get it on this OS) when it's missing.

import type { Mark, Pixels, View } from '../types'
import { docxText, imageSize, mp3Facts, odtText, pngPixels, shrink, unzipEntry, wavFacts } from './formats'
import type { Picture } from './formats'
import type { Os } from './paths'
import {
  PAGE, bmpPixels, bytesLine, clean, fromBase64, kindOf, needs, pageOfLine, paginate, parseDelimited, pngSize, soundFromAfinfo,
  soundFromFfprobe, soundLine, tablePages, toBase64, videoLine,
} from './read'
import type { Image, Sound } from './read'
import { converted, run } from './tools'
import type { Host } from './tools'

export const READ_MAX = 4 * 1024 * 1024 // what one $.fs.read takes
const IMAGE_MAX = 2 * 1024 * 1024 // what an Image takes, decoded
// The block preview's pixels: at most 640,000, so a large photo is scaled down first.
const PIXELS_MAX = 640_000
// The largest PNG peek decodes itself; past it a tool scales the picture down first.
const DECODE_MAX = 6_000_000

export const fail = (why: string): never => {
  throw new Error(why)
}

// A file's text as it is on disk (the .env editor saves it back byte for byte), and textOf, the same
// text cleaned for the screen.
export const rawTextOf = async (host: Host, path: string, size: number): Promise<string> => {
  if (size > READ_MAX) fail('Over 4 MiB: too large for peek to read yet.')
  const text = await host.read(path)
  if (text.includes('\u0000')) fail('A binary file: peek has no viewer for it.')
  return text
}

export const textOf = async (host: Host, path: string, size: number): Promise<string> => clean(await rawTextOf(host, path, size))

const bytesOf = async (host: Host, path: string) => fromBase64(await host.bytes(path))

const pageOf = <T,>(pages: T[], page: number) => {
  const at = Math.max(0, Math.min(page, pages.length - 1))
  return { at, one: pages[at] as T }
}

const lines = (text: string) => `${text.split('\n').length.toLocaleString('en-US')} lines`

const asPixels = (px: Image | null): Pixels | null => px && { width: px.width, height: px.height, rgba: toBase64(px.rgba) }

const AT_A_LINE = 'Opening at a line works in text, code and Markdown; this file opens at its top.'

// --- Word, OpenDocument, RTF ----------------------------------------------------------------------------

const docOf = async (host: Host, path: string, size: number, os: Os): Promise<string> => {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase()
  const entry = ext === 'docx' ? 'word/document.xml' : ext === 'odt' ? 'content.xml' : null
  const toText = ext === 'odt' ? odtText : docxText
  if (entry && size <= READ_MAX) {
    const xml = unzipEntry(await bytesOf(host, path), entry)
    if (xml) return toText(new TextDecoder().decode(xml))
  }
  if (os === 'mac') return (await run(host, ['textutil', '-convert', 'txt', '-stdout', path])).out ?? fail('textutil could not convert this document.')
  if (entry) {
    for (const argv of [['unzip', '-p', path, entry], ['tar', '-xOf', path, entry]]) {
      const got = await run(host, argv)
      if (got.out) return toText(got.out)
    }
    return fail(`Peek can't read this file's text: over 4 MiB it needs unzip or tar, and neither read it.`)
  }
  return fail(`${ext === 'rtf' ? 'RTF' : 'Old Word (.doc)'} text needs macOS's textutil: open it on a Mac, or save it as .docx.`)
}

// --- Pictures ---------------------------------------------------------------------------------------------

const sizeOf = async (host: Host, path: string, small: Uint8Array | null, os: Os): Promise<Picture | null> => {
  const head = small && imageSize(small)
  if (head) return head
  if (os === 'mac') {
    const about = (await run(host, ['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', path], 10_000)).out ?? ''
    const width = Number(/pixelWidth: (\d+)/.exec(about)?.[1] ?? 0)
    if (width) return { width, height: Number(/pixelHeight: (\d+)/.exec(about)?.[1] ?? 0), format: /format: (\S+)/.exec(about)?.[1]?.toUpperCase() ?? '' }
  }
  const probe = (await run(host, ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', path], 10_000)).out
  try {
    const stream = (JSON.parse(probe ?? '') as { streams?: { codec_name?: string; width?: number; height?: number }[] }).streams?.[0]
    return stream?.width ? { width: stream.width, height: stream.height ?? 0, format: (stream.codec_name ?? '').toUpperCase() } : null
  } catch {
    return null
  }
}

// The picture scaled to `side` pixels on its longer edge, as a file of `format`: sips on macOS,
// ffmpeg elsewhere.
const scaled = (host: Host, path: string, side: number, format: 'png' | 'bmp', os: Os) =>
  converted(host, `scratch.${format}`, out =>
    os === 'mac'
      ? ['sips', '-s', 'format', format, '-Z', String(side), path, '--out', out]
      : ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', path, '-vf', `scale=w=${side}:h=${side}:force_original_aspect_ratio=decrease${format === 'bmp' ? ',format=bgra' : ''}`, '-frames:v', '1', '-update', '1', out],
  )

// On macOS sips is always there; elsewhere a missing ffmpeg gets its install line (one line for
// the preview and the full picture both).
const toolWhy = (made: { why?: string; missing?: boolean }, os: Os) =>
  made.missing && os !== 'mac' ? needs('Drawing this picture', 'ffmpeg', 'ffmpeg', os) : (made.why ?? null)

// A PNG of at most 2 MiB for the Image: the file itself when it is one, else a smaller copy until it fits.
const pngOf = async (host: Host, path: string, small: Uint8Array | null, format: string, longest: number, os: Os): Promise<{ png: string | null; why: string | null }> => {
  if (small && format === 'PNG' && small.length <= IMAGE_MAX) return { png: toBase64(small), why: null }
  const first = Math.min(longest, 1600)
  for (const side of [first, ...[1024, 640, 400].filter(s => s < first)]) {
    const made = await scaled(host, path, side, 'png', os)
    if (made.out === undefined) return { png: null, why: toolWhy(made, os) }
    if ((made.out.length * 3) / 4 <= IMAGE_MAX) return { png: made.out, why: null }
  }
  return { png: null, why: 'Too large to draw even at 400 pixels.' }
}

// The block preview's pixels: a PNG decoded here, anything else scaled by a tool into a BMP.
const previewOf = async (host: Host, path: string, small: Uint8Array | null, size: Picture | null, os: Os): Promise<{ pixels: Pixels | null; why: string | null }> => {
  if (small && size?.format === 'PNG' && size.width * size.height <= DECODE_MAX) {
    try {
      const px = pngPixels(small)
      if (px) return { pixels: asPixels(shrink(px, PIXELS_MAX)), why: null }
    } catch {
      // damaged or unusual: the tool tries it
    }
  }
  const longest = Math.max(size?.width ?? 0, size?.height ?? 0) || 1600
  const area = (size?.width ?? 0) * (size?.height ?? 0) || longest * longest
  const side = Math.max(1, Math.min(longest, Math.floor(longest * Math.sqrt(PIXELS_MAX / area))))
  const made = await scaled(host, path, side, 'bmp', os)
  const pixels = made.out ? asPixels(bmpPixels(fromBase64(made.out))) : null
  return { pixels, why: pixels ? null : made.missing ? toolWhy(made, os) : `No block preview: ${made.why ?? 'the tool wrote no pixels peek can read'}.` }
}

// --- Sound -----------------------------------------------------------------------------------------------

const AUDIO_PROBE = ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration,format_long_name:stream=codec_name,sample_rate,channels', '-of', 'json']
const WAVE = 'aformat=channel_layouts=mono,showwavespic=s=640x128:scale=sqrt:colors=0x58a6ff'

const soundOf = async (host: Host, path: string, size: number, os: Os): Promise<{ sound: Sound | null; isProbeMissing: boolean }> => {
  if (size <= READ_MAX && /\.(?:wav|mp3)$/i.test(path)) {
    const bytes = await bytesOf(host, path).catch(() => null)
    const sound = bytes && (/\.wav$/i.test(path) ? wavFacts(bytes) : mp3Facts(bytes, size))
    if (sound) return { sound, isProbeMissing: false }
  }
  if (os === 'mac') {
    const described = (await run(host, ['afinfo', path], 10_000)).out
    const sound = described === undefined ? null : soundFromAfinfo(described)
    if (sound) return { sound, isProbeMissing: false }
  }
  const probed = await run(host, ['ffprobe', ...AUDIO_PROBE, path], 10_000)
  return { sound: soundFromFfprobe(probed.out ?? ''), isProbeMissing: !!probed.missing }
}

// --- One page of a file ----------------------------------------------------------------------------------

// `page` null: the page holding the mark, else the first.
export const load = async (host: Host, path: string, size: number, page: number | null, rel: string, mark: Mark | null = null): Promise<View> => {
  const os = host.os
  const kind = kindOf(path)
  const bytes = bytesLine(size)
  const base: View = { kind: 'file', path, rel, info: bytes, page: 0, pages: 1, body: null, note: null, mark: null }
  const notAtLine = mark ? AT_A_LINE : null
  try {
    switch (kind) {
      case 'markdown':
      case 'html':
      case 'text':
      case 'json': {
        const text = await textOf(host, path, size)
        let shown = text
        let note: string | null = null
        // JSON is pretty-printed, unless it opens at a line: then its lines are the file's own.
        if (kind === 'json' && !mark) {
          try {
            shown = JSON.stringify(JSON.parse(text), null, 2)
          } catch (error) {
            note = `Not valid JSON (${error instanceof Error ? error.message : 'unreadable'}), so it is shown as written.`
          }
        }
        const pages = paginate(shown)
        const total = shown.split('\n').length
        const line = mark ? Math.min(mark.line, total) : null
        const { at, one } = pageOf(pages, page ?? (line ? pageOfLine(pages, line) : 0))
        // Markdown draws rendered, or as its numbered source when it opens at a line.
        const body = kind === 'markdown' && line === null ? { as: 'markdown' as const, text: one.text } : { as: 'code' as const, text: one.text, start: one.start, path }
        const where = line === null ? '' : ` · line ${line}${mark?.col ? `, column ${mark.col}` : ''}`
        if (mark && mark.line > total) note = `Line ${mark.line} is past the end; the last line is ${total}.`
        return {
          ...base, info: `${lines(shown)} · ${bytes}${where}`, page: at, pages: pages.length, body, note,
          mark: line === null ? null : { line, col: mark?.col ?? null }, isAtMark: line !== null && page === null,
        }
      }
      case 'csv':
      case 'tsv': {
        const rows = parseDelimited(await textOf(host, path, size), kind === 'csv' ? ',' : '\t')
        const pages = tablePages(rows)
        const { at, one } = pageOf(pages, page ?? 0)
        const columns = Math.max(0, ...rows.map(r => r.length))
        const info = `${Math.max(0, rows.length - 1).toLocaleString('en-US')} rows × ${columns} columns · ${bytes}`
        return { ...base, info, page: at, pages: pages.length, note: notAtLine, body: { as: 'markdown', text: one.text } }
      }
      case 'pdf': {
        const about = await run(host, ['pdfinfo', path], 10_000)
        if (about.out === undefined) return { ...base, note: about.missing ? needs('PDF text', 'pdftotext', 'poppler', os) : about.why }
        const count = Number(/^Pages:\s+(\d+)/m.exec(about.out)?.[1] ?? 0)
        const paper = /^Page size:\s+(.+)$/m.exec(about.out)?.[1]
        const at = Math.max(0, Math.min(page ?? 0, count - 1))
        const got = await run(host, ['pdftotext', '-f', String(at + 1), '-l', String(at + 1), '-enc', 'UTF-8', path, '-'])
        const text = clean((got.out ?? '').replace(/\f/g, '')).trim() // pdftotext ends a page with a form feed
        const why = got.missing ? needs('PDF text', 'pdftotext', 'poppler', os) : got.why
        const note = why ?? (text ? (text.length > PAGE ? `This page is cut at ${PAGE.toLocaleString('en-US')} characters.` : null) : 'No text on this page (a scan or a picture?).')
        const info = [`${count} page${count === 1 ? '' : 's'}`, paper, bytes].filter(Boolean).join(' · ')
        return { ...base, info, page: at, pages: Math.max(1, count), note: [note, notAtLine].filter(Boolean).join(' ') || null, body: { as: 'text', text: text.slice(0, PAGE) } }
      }
      case 'doc': {
        const text = clean(await docOf(host, path, size, os))
        const pages = paginate(text)
        const { at, one } = pageOf(pages, page ?? 0)
        return { ...base, info: `${lines(text)} · ${bytes}`, page: at, pages: pages.length, note: notAtLine, body: { as: 'text', text: one.text } }
      }
      case 'image': {
        const small = size <= READ_MAX ? await bytesOf(host, path).catch(() => null) : null
        const facts = await sizeOf(host, path, small, os)
        const width = facts?.width ?? 0
        const height = facts?.height ?? 0
        const { png, why } = await pngOf(host, path, small, facts?.format ?? '', Math.max(width, height) || 1600, os)
        const preview = await previewOf(host, path, small, facts, os)
        const drawn = (png && pngSize(png)) || { width, height }
        const note = [...new Set([preview.why, why, notAtLine].filter(Boolean))].join(' ') || null
        const info = [width && `${width} × ${height} px`, facts?.format, bytes].filter(Boolean).join(' · ')
        return { ...base, info, note, body: { as: 'image', png, width: drawn.width, height: drawn.height, pixels: preview.pixels } }
      }
      case 'video': {
        const probed = await run(host, ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', path], 10_000)
        const facts = videoLine(probed.out ?? '')
        const note = facts ? notAtLine : probed.missing ? needs('A video', 'ffprobe for its facts', 'ffmpeg', os) : 'ffprobe could not read this video.'
        return { ...base, info: facts ? `${facts} · ${bytes}` : bytes, note }
      }
      case 'audio': {
        const { sound, isProbeMissing } = await soundOf(host, path, size, os)
        const wave = await converted(host, 'wave.bmp', out => ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', path, '-filter_complex', WAVE, '-frames:v', '1', '-c:v', 'bmp', '-pix_fmt', 'bgra', '-update', '1', out], 60_000)
        const pixels = wave.out ? asPixels(bmpPixels(fromBase64(wave.out))) : null
        const notes =
          !sound && isProbeMissing && wave.missing
            ? [needs('This sound', 'ffmpeg for its facts and waveform', 'ffmpeg', os)]
            : [
                sound ? null : isProbeMissing ? needs('This sound', 'ffprobe for its facts', 'ffmpeg', os) : 'ffprobe could not read it.',
                pixels ? null : wave.missing ? needs('The waveform', 'ffmpeg', 'ffmpeg', os) : `No waveform: ${wave.why ?? 'ffmpeg drew nothing peek can read'}.`,
              ]
        const note = [...notes, notAtLine].filter(Boolean).join(' ') || null
        return { ...base, info: sound ? `${soundLine(sound)} · ${bytes}` : bytes, note, body: { as: 'audio', pixels } }
      }
    }
  } catch (error) {
    return { ...base, note: error instanceof Error ? error.message : String(error) }
  }
}
