// Sums a transcript's token usage: requests, first request and peak context (score-g.mjs uses it).
// One API request can appear as several lines (one per content block), so dedupe by message id.
import fs from "node:fs";
import path from "node:path";

export function sum(file) {
  const seen = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const m = e.message;
    if (e.type !== "assistant" || !m?.usage || !m.id) continue;
    seen.set(m.id, { u: m.usage, model: m.model });
  }
  const t = { file: path.basename(file), reqs: 0, in: 0, cw: 0, cr: 0, out: 0, first: 0, peak: 0, model: "" };
  for (const { u, model } of seen.values()) {
    const ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (!t.reqs) t.first = ctx;
    t.reqs++;
    t.in += u.input_tokens || 0;
    t.cw += u.cache_creation_input_tokens || 0;
    t.cr += u.cache_read_input_tokens || 0;
    t.out += u.output_tokens || 0;
    t.peak = Math.max(t.peak, ctx);
    t.model = model || t.model;
  }
  // Input-token equivalents at Anthropic's published price ratios: cache write 1.25x, cache read 0.1x, output 5x.
  t.eq = Math.round(t.in + 1.25 * t.cw + 0.1 * t.cr + 5 * t.out);
  return t;
}
