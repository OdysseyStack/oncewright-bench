// The stamp /odyssey:setup writes as the first line of each kit-owned file:
//   <!-- odyssey-managed v<version> sha256:<64 hex digits> -->
// Only that whole line is the stamp, so a file whose first line merely mentions odyssey-managed
// is the user's. A CRLF checkout leaves a \r at the line's end, and an editor may put a
// byte-order mark before it. hooks/protect-managed.mjs blocks Claude's edits to a file that
// starts with it, scripts/odyssey.mjs reads its version and hash, and lib/docs.mjs leaves a
// stamped rule out of the docs check.
export const STAMP = /^\uFEFF?<!-- odyssey-managed v(\S+) sha256:([0-9a-f]{64}) -->\r?$/;
