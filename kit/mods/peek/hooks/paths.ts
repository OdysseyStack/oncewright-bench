// Paths on macOS, Linux and Windows: pure, so the tests run each OS's rules on any machine.

export type Os = 'mac' | 'linux' | 'windows'

// Windows and macOS (by default) ignore letter case in names; Linux does not.
const folds = (os: Os) => os !== 'linux'

// `/x`, `C:\x` or `C:/x`, `\\server\share`.
export const isAbsolute = (path: string): boolean => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path)

const sepOf = (os: Os) => (os === 'windows' ? '\\' : '/')
const native = (os: Os, path: string) => (os === 'windows' ? path.replaceAll('/', '\\') : path)

// `rel` under `base` in the OS's own separators; an absolute `rel` stands alone.
export const join = (os: Os, base: string, rel: string): string =>
  isAbsolute(rel) ? native(os, rel) : `${base.replace(/[\\/]+$/, '')}${sepOf(os)}${native(os, rel)}`

// What the person typed, made absolute: `~` is the home folder, a relative path is under `cwd`.
export const absolute = (os: Os, cwd: string, home: string, typed: string): string =>
  join(os, cwd, home && /^~(?=$|[\\/])/.test(typed) ? `${home}${typed.slice(1)}` : typed)

// The spelling two paths are compared in: forward slashes, no trailing one, case folded where the
// file system folds it.
export const sameForm = (os: Os, path: string): string => {
  const slashed = path.replaceAll('\\', '/').replace(/(?<=.)\/+$/, '')
  return folds(os) ? slashed.toLowerCase() : slashed
}

// Whether a real path is one of the roots or lies under one (real paths too). No prefix tricks:
// /repo-other is not under /repo.
export const isInside = (real: string, roots: readonly string[], os: Os): boolean => {
  const path = sameForm(os, real)
  return roots.some(root => {
    const top = sameForm(os, root)
    return path === top || path.startsWith(top.endsWith('/') ? top : `${top}/`)
  })
}

// The path inside the deepest root holding it, with forward slashes; the path itself when none does.
export const relTo = (real: string, roots: readonly string[], os: Os): string => {
  const root = roots.filter(r => isInside(real, [r], os)).sort((a, b) => b.length - a.length)[0]
  return root === undefined ? real : real.slice(root.replace(/[\\/]+$/, '').length + 1).replaceAll('\\', '/')
}

export const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path

export const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || path

// --- Windows spellings that lead somewhere other than they say ------------------------------------

const DEVICE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\..*)?$/i

// Why Windows would open something other than this spelling names, or null: a network or device
// path, a drive-relative one, an NTFS stream (`a.txt:x`), a device name (CON, NUL, COM1, with any
// extension), a name ending in a dot or space (Windows drops them, so `.env.` opens `.env`), or a
// short 8.3 name (`CREDEN~1.JSO`).
export const windowsProblem = (path: string): string | null => {
  if (/^[\\/]{2}/.test(path)) return 'a network or device path'
  if (/^[A-Za-z]:(?![\\/])/.test(path)) return 'a path relative to a drive'
  for (const part of path.replace(/^[A-Za-z]:/, '').split(/[\\/]/)) {
    if (part === '' || part === '.' || part === '..') continue
    if (part.includes(':')) return `${part}: a name with a colon (an NTFS stream)`
    if (DEVICE.test(part.replace(/[. ]+$/, ''))) return `${part}: a name Windows keeps for a device`
    if (/[. ]$/.test(part)) return `${part}: a name ending in a dot or a space, which Windows drops`
    if (/~\d/.test(part)) return `${part}: a short 8.3 name (type the full name)`
  }
  return null
}

// --- Folders too broad to approve -----------------------------------------------------------------

// The system's own folders: neither they nor anything in them may be approved.
const SYSTEM = [
  '/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/proc', '/root', '/run', '/sbin', '/sys', '/usr',
  '/var/db', '/var/lib', '/var/log', '/System', '/Library', '/private/etc', '/private/var/db', '/private/var/log',
]
const WINDOWS_SYSTEM = /^[a-z]:\/(?:windows|program files|program files \(x86\)|programdata)(?:\/|$)/
// Folders that hold every user's or every volume's files: these themselves may not be approved.
const SHARED = ['/Users', '/home', '/Volumes', '/mnt', '/media', '/opt', '/srv', '/tmp', '/var', '/private', '/private/tmp', '/private/var', '/Applications']
// Under the home folder: keys, and Claude Code's own folder (its sign-in lives there on Linux).
const KEYS = ['.ssh', '.gnupg', '.aws']

// Why a folder (a real path) is too broad or too sensitive to approve, or null when it may be. As
// the session's repo or folder (`isRoot`), only a folder that is or holds a system folder is too
// broad: a project under one (/usr/src/app, C:\Windows\Temp\app) is shown.
export const tooBroad = (os: Os, folder: string, home: string, config: string, isRoot = false): string | null => {
  const at = sameForm(os, folder)
  if (at === '/' || /^[a-z]:\/?$/i.test(at)) return 'the top of a drive'
  if (home && at === sameForm(os, home)) return 'your whole home folder'
  if (home && isInside(home, [folder], os)) return 'a folder that holds your home folder'
  const isSystem =
    os === 'windows'
      ? WINDOWS_SYSTEM.test(at.toLowerCase()) && !(isRoot && at.slice(3).includes('/'))
      : isRoot ? SYSTEM.some(s => isInside(s, [folder], os)) : isInside(folder, SYSTEM, os)
  if (isSystem) return "one of the system's own folders"
  if (os !== 'windows' && SHARED.some(s => sameForm(os, s) === at)) return 'a folder every user or volume shares'
  if (config && (isInside(folder, [config], os) || isInside(config, [folder], os))) return "Claude Code's own folder, or one holding it"
  if (home && KEYS.some(k => isInside(folder, [join(os, home, k)], os))) return 'a folder of keys'
  return null
}
