// File formats peek reads in plain code, so it needs no tool on any OS: a Word or OpenDocument
// file's text (a zip, so an inflater too), a picture's size, a PNG's pixels, and a WAV's or an
// MP3's facts. Pure, so the tests read it.

import type { Image, Sound } from './read'

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))
const viewOf = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

// --- Inflate: raw DEFLATE (RFC 1951), as zlib's puff.c reads it -------------------------------------

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

type Huffman = { count: number[]; symbol: number[] }

// A canonical Huffman code from its code lengths: how many codes of each length, and the symbols
// in code order.
const huffman = (lengths: ArrayLike<number>): Huffman => {
  const count = new Array<number>(16).fill(0)
  for (let i = 0; i < lengths.length; i++) count[lengths[i] ?? 0]! += 1
  count[0] = 0
  const next = new Array<number>(16).fill(0)
  for (let len = 1; len < 15; len++) next[len + 1] = next[len]! + count[len]!
  const symbol = new Array<number>(lengths.length).fill(0)
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i] ?? 0
    if (len) symbol[next[len]!++] = i
  }
  return { count, symbol }
}

const FIXED_LIT = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)))
const FIXED_DIST = huffman(new Array<number>(30).fill(5))

const broken = (why: string): never => {
  throw new Error(`The compressed data is damaged: ${why}.`)
}

// At most `limit` bytes out (32 MiB unless the caller knows the size), so a small file that claims or
// inflates to a huge one is refused rather than decoded.
export const inflate = (data: Uint8Array, expected = 0, limit = 32 * 1024 * 1024): Uint8Array => {
  let out = new Uint8Array(Math.min(limit, Math.max(1024, expected)))
  let size = 0
  let at = 0
  let buffer = 0
  let held = 0 // bits in `buffer`, always under 8 between reads
  const bits = (n: number) => {
    while (held < n) {
      if (at >= data.length) broken('it ends early')
      buffer |= data[at++]! << held
      held += 8
    }
    const value = buffer & ((1 << n) - 1)
    buffer >>>= n
    held -= n
    return value
  }
  const grow = (n: number) => {
    if (size + n > limit) broken(`it inflates to more than ${limit.toLocaleString('en-US')} bytes`)
    if (size + n <= out.length) return
    const bigger = new Uint8Array(Math.max(out.length * 2, size + n))
    bigger.set(out.subarray(0, size))
    out = bigger
  }
  const decode = (h: Huffman) => {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len < 16; len++) {
      code |= bits(1)
      const count = h.count[len]!
      if (code - count < first) return h.symbol[index + code - first]!
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    return broken('a code is not in its table')
  }
  for (let last = 0; !last; ) {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      buffer = 0 // a stored block starts at the next byte
      held = 0
      if (at + 4 > data.length) broken('a stored block ends early')
      const len = data[at]! | (data[at + 1]! << 8)
      at += 4
      if (at + len > data.length) broken('a stored block ends early')
      grow(len)
      out.set(data.subarray(at, at + len), size)
      size += len
      at += len
      continue
    }
    let lit = FIXED_LIT
    let dist = FIXED_DIST
    if (type === 2) {
      const nlen = bits(5) + 257
      const ndist = bits(5) + 1
      const ncode = bits(4) + 4
      const codeLengths = new Array<number>(19).fill(0)
      for (let i = 0; i < ncode; i++) codeLengths[ORDER[i]!] = bits(3)
      const lengthCode = huffman(codeLengths)
      const lengths = new Array<number>(nlen + ndist).fill(0)
      for (let i = 0; i < nlen + ndist; ) {
        const sym = decode(lengthCode)
        if (sym < 16) {
          lengths[i++] = sym
          continue
        }
        if (sym === 16 && i === 0) broken('a repeat with nothing before it')
        const value = sym === 16 ? lengths[i - 1]! : 0
        let repeat = sym === 16 ? 3 + bits(2) : sym === 17 ? 3 + bits(3) : 11 + bits(7)
        if (i + repeat > nlen + ndist) broken('too many code lengths')
        while (repeat--) lengths[i++] = value
      }
      lit = huffman(lengths.slice(0, nlen))
      dist = huffman(lengths.slice(nlen))
    } else if (type !== 1) broken('an unknown block type')
    for (;;) {
      const sym = decode(lit)
      if (sym < 256) {
        grow(1)
        out[size++] = sym
        continue
      }
      if (sym === 256) break
      if (sym > 285) broken('a length out of range')
      const len = LBASE[sym - 257]! + bits(LEXT[sym - 257]!)
      const d = decode(dist)
      if (d > 29) broken('a distance out of range')
      const back = DBASE[d]! + bits(DEXT[d]!)
      if (back > size) broken('a distance before the start')
      grow(len)
      for (let i = 0; i < len; i++, size++) out[size] = out[size - back]!
    }
  }
  return out.subarray(0, size)
}

// --- Zip: one entry out of a .docx or an .odt --------------------------------------------------------

// The bytes of the entry named `name`, or null when the zip has none (or stores it some other way).
export const unzipEntry = (zip: Uint8Array, name: string): Uint8Array | null => {
  const view = viewOf(zip)
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) return null
  const entries = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const text = new TextDecoder()
  for (let n = 0; n < entries && at + 46 <= zip.length && view.getUint32(at, true) === 0x02014b50; n++) {
    const method = view.getUint16(at + 10, true)
    const packed = view.getUint32(at + 20, true)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    if (text.decode(zip.subarray(at + 46, at + 46 + nameLength)) === name) {
      if (local + 30 > zip.length) return null
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const body = zip.subarray(start, start + packed)
      return method === 0 ? body : method === 8 ? inflate(body, size) : null
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return null
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

const unescapeXml = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? whole
    const point = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole
  })

// word/document.xml's text: each paragraph a line, its tabs and line breaks kept.
export const docxText = (xml: string): string => {
  let text = ''
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g)) {
    text += m[1] !== undefined ? unescapeXml(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n'
  }
  return text
}

// An OpenDocument's content.xml: each paragraph or heading a line.
export const odtText = (xml: string): string =>
  unescapeXml(
    xml
      .replace(/^[\s\S]*?<office:body>/, '')
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n?: string) => ' '.repeat(Math.min(200, Number(n ?? 1))))
      .replace(/<\/text:(?:p|h)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )

// --- Pictures: the size from the header; a PNG's pixels ------------------------------------------------

export type Picture = { width: number; height: number; format: string }

// The size of a PNG, JPEG, GIF, BMP or WebP, from its first bytes; null for any other format.
export const imageSize = (b: Uint8Array): Picture | null => {
  const v = viewOf(b)
  if (b.length >= 24 && v.getUint32(0) === 0x89504e47) return { width: v.getUint32(16), height: v.getUint32(20), format: 'PNG' }
  if (b.length >= 10 && ascii(b, 0, 4) === 'GIF8') return { width: v.getUint16(6, true), height: v.getUint16(8, true), format: 'GIF' }
  if (b.length >= 26 && ascii(b, 0, 2) === 'BM') return { width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)), format: 'BMP' }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8 ') return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff, format: 'WEBP' }
    if (chunk === 'VP8L') return { width: (v.getUint32(21, true) & 0x3fff) + 1, height: ((v.getUint32(21, true) >>> 14) & 0x3fff) + 1, format: 'WEBP' }
    const le24 = (at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)
    if (chunk === 'VP8X') return { width: le24(24) + 1, height: le24(27) + 1, format: 'WEBP' }
    return null
  }
  if (b.length >= 4 && v.getUint16(0) === 0xffd8) {
    // JPEG: segment after segment to the frame header (SOF0-15, less DHT, JPG and DAC).
    for (let at = 2; at + 9 < b.length; ) {
      if (b[at] !== 0xff) return null
      const marker = b[at + 1]!
      if (marker === 0xff) at++
      else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) at += 2
      else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: v.getUint16(at + 7), height: v.getUint16(at + 5), format: 'JPEG' }
      } else at += 2 + v.getUint16(at + 2)
    }
  }
  return null
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

// A PNG's pixels as RGBA, for the block preview: every colour type and bit depth, not interlaced
// (null then, and the preview falls back to a tool).
export const pngPixels = (b: Uint8Array): Image | null => {
  const v = viewOf(b)
  if (b.length < 33 || v.getUint32(0) !== 0x89504e47 || ascii(b, 12, 4) !== 'IHDR') return null
  const width = v.getUint32(16)
  const height = v.getUint32(20)
  const depth = b[24]!
  const color = b[25]!
  const channels = CHANNELS[color]
  if (!channels || b[28] !== 0 || !width || !height || ![1, 2, 4, 8, 16].includes(depth) || (depth < 8 && color !== 0 && color !== 3)) return null
  let palette: Uint8Array | null = null
  let alpha: Uint8Array | null = null
  const parts: Uint8Array[] = []
  for (let at = 8; at + 8 <= b.length; ) {
    const len = v.getUint32(at)
    const type = ascii(b, at + 4, 4)
    const body = b.subarray(at + 8, at + 8 + len)
    if (type === 'PLTE') palette = body
    else if (type === 'tRNS') alpha = body
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (color === 3 && !palette) return null
  const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (packed.set(p, at), at + p.length), 0)
  const stride = Math.ceil((width * channels * depth) / 8)
  const raw = inflate(packed.subarray(2), height * (stride + 1), height * (stride + 1)) // past zlib's two-byte header
  if (raw.length < height * (stride + 1)) return null
  // Undo each row's filter (none, sub, up, average, Paeth).
  const bpp = Math.max(1, (channels * depth) / 8)
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const from = y * (stride + 1) + 1
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[row + x - bpp]! : 0
      const up = y ? rows[row - stride + x]! : 0
      const c = y && x >= bpp ? rows[row - stride + x - bpp]! : 0
      let p = raw[from + x]!
      if (filter === 1) p += a
      else if (filter === 2) p += up
      else if (filter === 3) p += (a + up) >> 1
      else if (filter === 4) {
        const pa = Math.abs(up - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + up - 2 * c)
        p += pa <= pb && pa <= pc ? a : pb <= pc ? up : c
      }
      rows[row + x] = p
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  const most = (1 << Math.min(depth, 8)) - 1
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const sample = (i: number) =>
      depth === 16 ? rows[row + i * 2]! : depth === 8 ? rows[row + i]! : (rows[row + ((i * depth) >> 3)]! >> (8 - depth - ((i * depth) & 7))) & most
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const s = x * channels
      if (color === 3) {
        const i = sample(s)
        rgba.set([palette?.[i * 3] ?? 0, palette?.[i * 3 + 1] ?? 0, palette?.[i * 3 + 2] ?? 0, alpha?.[i] ?? 255], o)
      } else if (color === 0 || color === 4) {
        const g = depth < 8 ? Math.round((sample(s) * 255) / most) : sample(s)
        rgba.set([g, g, g, color === 4 ? sample(s + 1) : 255], o)
      } else {
        rgba.set([sample(s), sample(s + 1), sample(s + 2), color === 6 ? sample(s + 3) : 255], o)
      }
    }
  }
  return { width, height, rgba }
}

// A picture scaled down by a whole factor until it has at most `max` pixels, each the average of
// the block it covers (weighted by alpha).
export const shrink = (px: Image, max: number): Image => {
  const k = Math.ceil(Math.sqrt((px.width * px.height) / max))
  if (k <= 1) return px
  const width = Math.max(1, Math.floor(px.width / k))
  const height = Math.max(1, Math.floor(px.height / k))
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let dy = 0; dy < k; dy++) {
        for (let dx = 0; dx < k; dx++) {
          const i = ((y * k + dy) * px.width + x * k + dx) * 4
          const alpha = px.rgba[i + 3] ?? 0
          r += (px.rgba[i] ?? 0) * alpha
          g += (px.rgba[i + 1] ?? 0) * alpha
          b += (px.rgba[i + 2] ?? 0) * alpha
          a += alpha
        }
      }
      rgba.set(a ? [r / a, g / a, b / a, a / (k * k)] : [0, 0, 0, 0], (y * width + x) * 4)
    }
  }
  return { width, height, rgba }
}

// --- Sound: a WAV's or an MP3's facts, from its header -------------------------------------------------

export const wavFacts = (b: Uint8Array): Sound | null => {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WAVE') return null
  const v = viewOf(b)
  let fmt: { tag: number; channels: number; rate: number; perSecond: number; bits: number } | null = null
  let data: number | null = null
  for (let at = 12; at + 8 <= b.length; ) {
    const id = ascii(b, at, 4)
    const size = v.getUint32(at + 4, true)
    if (id === 'fmt ' && at + 24 <= b.length) {
      fmt = { tag: v.getUint16(at + 8, true), channels: v.getUint16(at + 10, true), rate: v.getUint32(at + 12, true), perSecond: v.getUint32(at + 16, true), bits: v.getUint16(at + 22, true) }
    }
    if (id === 'data') {
      data = Math.min(size, b.length - at - 8)
      break
    }
    at += 8 + size + (size & 1)
  }
  if (!fmt) return null
  const codec = fmt.tag === 1 || fmt.tag === 0xfffe ? 'pcm' : fmt.tag === 3 ? 'float' : `format ${fmt.tag}`
  return {
    seconds: data !== null && fmt.perSecond ? data / fmt.perSecond : null,
    format: `${codec} ${fmt.bits}-bit in WAVE`,
    rate: fmt.rate,
    channels: fmt.channels,
  }
}

const KBPS = { v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] }
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

// The first MP3 (MPEG audio layer III) frame after any ID3v2 tag; the length from a Xing or Info
// header's frame count, else from the bit rate (`size` is the whole file's).
export const mp3Facts = (b: Uint8Array, size = b.length): Sound | null => {
  const v = viewOf(b)
  let at = 0
  if (b.length >= 10 && ascii(b, 0, 3) === 'ID3') {
    at = 10 + (((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f)) + (b[5]! & 0x10 ? 10 : 0)
  }
  for (const end = Math.min(b.length - 4, at + 65_536); at < end; at++) {
    if (b[at] !== 0xff || (b[at + 1]! & 0xe0) !== 0xe0) continue
    const version = (b[at + 1]! >> 3) & 3
    const layer = (b[at + 1]! >> 1) & 3
    const rateAt = (b[at + 2]! >> 2) & 3
    const kbpsAt = b[at + 2]! >> 4
    if (version === 1 || layer !== 1 || rateAt === 3 || kbpsAt === 0 || kbpsAt === 15) continue
    const rate = RATES[version]?.[rateAt] ?? 0
    const kbps = (version === 3 ? KBPS.v1 : KBPS.v2)[kbpsAt] ?? 0
    const mono = b[at + 3]! >> 6 === 3
    const tag = at + 4 + (version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17)
    const header = tag + 12 <= b.length ? ascii(b, tag, 4) : ''
    const frames = (header === 'Xing' || header === 'Info') && v.getUint32(tag + 4) & 1 ? v.getUint32(tag + 8) : null
    const seconds = frames !== null ? (frames * (version === 3 ? 1152 : 576)) / rate : ((size - at) * 8) / (kbps * 1000)
    return { seconds, format: `mp3 ${header === 'Xing' ? 'VBR' : `${kbps} kb/s`}`, rate, channels: mono ? 1 : 2 }
  }
  return null
}
