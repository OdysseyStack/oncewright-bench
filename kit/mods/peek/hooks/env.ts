// The .env editor's file model: pure, so the tests read it. A file is its lines in order; a KEY=value
// line keeps the text around its value, so a save rewrites only the values that changed and every
// other byte (comments, order, spacing, quotes, `export`) stays as it was.

export type EnvLine = {
  text: string // the line(s) as in the file; rewritten only when this entry changes
  key?: string
  value?: string // as written between the quotes (or unquoted, trailing comment left out)
  head?: string // `export KEY = `
  quote?: '"' | "'" | ''
  tail?: string // after the value: ` # comment`
  isLocked?: boolean // a quoted value spanning lines, or a double-quoted one with a backslash escape: kept whole, not editable here
  eol?: string // the line end that follows it in the file; a line added here takes the file's `eol`
}

export type EnvDoc = { lines: EnvLine[]; eol: '\n' | '\r\n'; isEndedByEol: boolean }

// `s`: a value holding any other line-break character is still a value, so it is still masked.
const ASSIGN = /^(\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*)(.*)$/s

export const parseEnv = (text: string): EnvDoc => {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  // Split at every CRLF, LF and CR, as dotenv readers do, so a file mixing them is read line by line;
  // each line keeps its own end for the save.
  const parts = text.split(/(\r\n|\r|\n)/)
  const rows = parts.filter((_, i) => i % 2 === 0)
  const ends = parts.filter((_, i) => i % 2 === 1)
  const isEndedByEol = rows.length > 1 && rows.at(-1) === ''
  if (isEndedByEol) rows.pop()
  const lines: EnvLine[] = []
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i] ?? ''
    const m = ASSIGN.exec(text)
    if (!m) {
      lines.push({ text, eol: ends[i] })
      continue
    }
    const [, head = '', key = '', rest = ''] = m
    const quote = rest[0] === '"' || rest[0] === "'" ? (rest[0] as '"' | "'") : ''
    if (!quote) {
      const hash = rest.search(/\s#/)
      const value = (hash < 0 ? rest : rest.slice(0, hash)).trimEnd()
      lines.push({ text, key, value, head, quote, tail: rest.slice(value.length), eol: ends[i] })
      continue
    }
    const close = closing(rest, quote)
    if (close >= 0) {
      const inner = rest.slice(1, close)
      // Readers take a backslash escape other than \" in double quotes each their own way, so it isn't edited here.
      const isLocked = quote === '"' && /\\(?!")/.test(inner)
      lines.push({ text, key, value: quote === '"' ? inner.replace(/\\"/g, '"') : inner, head, quote, tail: rest.slice(close + 1), eol: ends[i], ...(isLocked && { isLocked }) })
      continue
    }
    // A value that spans lines: this line and the ones up to its closing quote, kept as one.
    let end = i
    while (end + 1 < rows.length && closing(`${quote}${rows[end + 1] ?? ''}`, quote) < 0) end++
    end = Math.min(end + 1, rows.length - 1)
    const spanned = rows.slice(i, end).map((row, j) => `${row}${ends[i + j]}`).join('') + (rows[end] ?? '')
    lines.push({ text: spanned, key, head, quote, isLocked: true, eol: ends[end] })
    i = end
  }
  return { lines, eol, isEndedByEol }
}

// The index of the quote that closes a value opened at index 0; -1 when the line doesn't close it.
const closing = (rest: string, quote: string): number => {
  for (let i = 1; i < rest.length; i++) {
    if (quote === '"' && rest[i] === '\\') i++
    else if (rest[i] === quote) return i
  }
  return -1
}

// How a value is written: in single quotes when its line has them or it holds a backslash or a `"`
// (Node's dotenv, Docker Compose and a shell read single quotes literally) and it holds no `'`; else
// in double quotes (a `"` escaped) when it needs any (spaces, #, quotes), else bare. In double quotes
// those readers take a `"` or a backslash each their own way, so a value holding `'` with either has
// no form they all read back the same: the editor keeps none (isWritable).
const written = (value: string, quote: '"' | "'" | '') => {
  if ((quote === "'" || /["\\]/.test(value)) && !value.includes("'")) return `'${value}'`
  if (quote || /[\s#"'\\]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`
  return value
}

export const isWritable = (value: string) => !(value.includes("'") && /["\\]/.test(value))
export const UNWRITABLE = 'a value holding \' along with " or a backslash has no quoting every .env reader reads the same way'

export const setValue = (line: EnvLine, value: string): EnvLine => {
  const shown = written(value, line.quote ?? '')
  const quote = shown === value ? '' : (shown[0] as '"' | "'")
  return { ...line, text: `${line.head ?? `${line.key}=`}${shown}${line.tail ?? ''}`, value, quote }
}

export const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/

// `KEY=value` typed into the add field: the new line, or null when it isn't one.
export const newLine = (typed: string): EnvLine | null => {
  const at = typed.indexOf('=')
  const key = typed.slice(0, at).trim()
  if (at < 0 || !KEY.test(key)) return null
  return setValue({ text: '', key, head: `${key}=`, quote: '' }, typed.slice(at + 1).trim())
}

export const serializeEnv = (doc: EnvDoc): string =>
  doc.lines.map((l, i) => l.text + (i < doc.lines.length - 1 || doc.isEndedByEol ? (l.eol ?? doc.eol) : '')).join('')

export const MASK = '••••••'

// What a line shows while masked: a key's row, or a comment, with a commented-out assignment's
// value masked too (`# OLD_KEY=...` often holds an old secret). Any other line that isn't blank
// is masked whole, since a line it can't read (`KEY: value`, `1KEY=x`) may still hold a secret.
export const maskedRow = (line: EnvLine): string => {
  if (line.key !== undefined) return `${line.key} = ${MASK}${line.isLocked ? (line.value === undefined ? ' (spans lines: edit it by hand)' : ' (backslash escapes: edit it by hand)') : ''}`
  const commented = /^(\s*#\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=).*/.exec(line.text)
  if (commented) return `${commented[1]} ${MASK}`
  return /^\s*(#|$)/.test(line.text) ? line.text : MASK
}
