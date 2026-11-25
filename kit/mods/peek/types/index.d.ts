// Pixels the block preview and the waveform draw from: RGBA, base64.
export type Pixels = { width: number; height: number; rgba: string }

// What the pane draws under the file's name, one page at a time.
export type Body =
  | { as: 'markdown'; text: string }
  | { as: 'code'; text: string; start: number; path: string }
  | { as: 'text'; text: string }
  | { as: 'image'; png: string | null; width: number; height: number; pixels: Pixels | null }
  | { as: 'audio'; pixels: Pixels | null }
  | { as: 'diff'; text: string } // a page of a unified diff, from its first hunk
  | { as: 'env' } // the masked .env editor: its values live in the module, never in state

// The line a file opened at (`/peek path:12:5`), marked where it is drawn.
export type Mark = { line: number; col: number | null }

export type View = {
  kind: 'file' | 'diff' // a file, or its diff against HEAD
  path: string
  rel: string // the path inside its repo or worktree; outside them, the path itself
  info: string
  page: number
  pages: number
  body: Body | null
  note: string | null
  mark: Mark | null
  isAtMark?: boolean // opened at the mark, no page turned since: drawn from just above it
}

export type Pick = { value: string; label: string; rel: string }

// The list: this session's files and the repo's newest (`files`), and every repo file the filter
// searches (`index`, paths under `root`, newest first; `more` past its cap); or the changed files.
export type Picker = { mode: 'files' | 'diff'; files: Pick[]; index: string[]; root: string; more: number; note: string | null }

// The approved folders, and the one waiting for a yes or a no.
export type Folders = { asking: string | null; list: string[]; note: string | null }

// The block preview's zoom: steps past fit, and the view's centre as a share of the image.
export type Lens = { step: number; cx: number; cy: number }

// A file Claude's tools read, wrote or edited in this session, newest first.
export type Touched = { path: string; verb: 'read' | 'wrote' | 'edited'; at: number }
// The files Claude wrote since the last prompt, for the band above the prompt.
export type Wrote = { files: { path: string; rel: string }[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    peek: {
      view: View | null
      picker: Picker | null
      query: string
      folders: Folders | null
      isPicture: boolean
      lens: Lens
      touched: Touched[]
      wrote: Wrote | null
    }
  }
}
