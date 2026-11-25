// The failing tests of a hidden check's output, for fix.mjs's follow-up: each test's name and its
// assertion message (the hidden tests carry their own), never the tests' source.
const MAX_LINES = 12;

// The failing tests in node --test's spec output: [{ name, message }], from its "failing tests" list.
export function failures(output) {
  const list = [];
  const lines = output.split("\n");
  let i = lines.findIndex((l) => l.startsWith("✖ failing tests:"));
  if (i < 0) return list;
  let cur = null;
  let done = false;
  for (const line of lines.slice(i + 1)) {
    const head = /^✖ (.*?)(?: \([\d.]+m?s\))?$/.exec(line);
    if (head) {
      cur = { name: head[1], message: [] };
      list.push(cur);
      done = false;
      continue;
    }
    if (!cur || done || line.startsWith("test at ")) continue;
    if (/^\s+at /.test(line) || /^\s+\{$/.test(line)) {
      done = true;
      continue;
    }
    cur.message.push(line.replace(/^  /, ""));
  }
  return list.map(({ name, message }) => {
    let text = message.join("\n").trim().replace(/^AssertionError \[ERR_ASSERTION\]: /, "");
    // A bare assert.ok prints the line of source it failed on: never pass that on.
    if (text.startsWith("The expression evaluated to a falsy value")) text = "an assertion failed";
    // A hidden test file that can't load is named by its path: say what it means instead.
    if (/(^|\/)test-hidden\//.test(name)) name = "the checks couldn't load the code";
    const kept = text.split("\n");
    return { name, message: kept.length > MAX_LINES ? [...kept.slice(0, MAX_LINES), "..."].join("\n") : text };
  });
}
