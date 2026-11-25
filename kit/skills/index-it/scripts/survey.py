#!/usr/bin/env python3
"""Survey a Claude Code memory store. Read-only. Prints JSON.

Everything deterministic lives here so the model never counts bytes, resolves
paths, or judges reachability by eye. Usage:

    python3 survey.py [--cwd PATH] [--sessions N]

--cwd       project directory whose store to survey (default: $PWD)
--sessions  how many recent transcripts to mine for usage (default: 20)
"""
import argparse
import hashlib
import json
import os
import re
import sys

LINK = re.compile(r"\(([A-Za-z0-9._-]+)\.md\)")
WIKI = re.compile(r"\[\[([A-Za-z0-9._-]+)\]\]")
FM_NAME = re.compile(r"^name:\s*(.+?)\s*$", re.M)
FM_TYPE = re.compile(r"^\s*type:\s*(.+?)\s*$", re.M)
FM_DESC = re.compile(r"^description:\s*(.+?)\s*$", re.M)
FM_SUPER = re.compile(r"^\s*superseded_by:\s*(.+?)\s*$", re.M)
FM_ASOF = re.compile(r"^\s*asof:\s*(.+?)\s*$", re.M)

# Index target: comfortably under the load limit, with headroom for a sprint.
INDEX_TARGET = 16000
INDEX_CEILING = 24400
# Claude Code also stops loading MEMORY.md at its 200th line.
LINE_TARGET = 150
LINE_CEILING = 200
HUB_TARGET = 8000
HOOK_MAX = 200


def slug_for(path):
    """Claude Code names a store's folder after the cwd's real path, with every character
    that isn't a letter or a digit turned into '-'."""
    return re.sub(r"[^A-Za-z0-9]", "-", os.path.realpath(path))


def index_lines(text):
    """MEMORY.md's lines as Claude Code counts them when it loads the file: it trims the text at
    both ends, then counts the newlines plus one, and cuts after the 200th line."""
    trimmed = text.strip()
    return trimmed.count("\n") + 1 if trimmed else 0


def frontmatter(text):
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    return text[: end + 4] if end != -1 else ""


def survey(cwd, n_sessions):
    slug = slug_for(cwd)
    proj = os.path.join(os.path.expanduser("~/.claude/projects"), slug)
    store = os.path.join(proj, "memory")
    out = {"cwd": os.path.realpath(cwd), "slug": slug, "store": store}

    if not os.path.isdir(store):
        out["exists"] = False
        # A near-miss slug usually means the session was started elsewhere.
        root = os.path.expanduser("~/.claude/projects")
        base = os.path.basename(os.path.realpath(cwd)).lower()
        out["similar_stores"] = sorted(
            d for d in os.listdir(root)
            if base in d.lower() and os.path.isdir(os.path.join(root, d, "memory"))
        ) if os.path.isdir(root) else []
        return out
    out["exists"] = True

    index_path = os.path.join(store, "MEMORY.md")
    index = (open(index_path, encoding="utf-8", errors="replace").read()
             if os.path.exists(index_path) else "")
    size, lines = len(index.encode("utf-8")), index_lines(index)
    out["index"] = {
        "bytes": size,
        "lines": lines,
        "target": INDEX_TARGET,
        "ceiling": INDEX_CEILING,
        "line_target": LINE_TARGET,
        "line_ceiling": LINE_CEILING,
        "over_target": size > INDEX_TARGET or lines > LINE_TARGET,
        "over_ceiling": size > INDEX_CEILING or lines > LINE_CEILING,
    }

    files, hubs = {}, {}
    for fn in sorted(os.listdir(store)):
        if not fn.endswith(".md") or fn == "MEMORY.md":
            continue
        name = fn[:-3]
        text = open(os.path.join(store, fn), encoding="utf-8", errors="replace").read()
        fm = frontmatter(text)
        body = text[len(fm):]
        rec = {
            "bytes": len(text.encode("utf-8")),
            "type": (FM_TYPE.search(fm).group(1) if FM_TYPE.search(fm) else None),
            "has_description": bool(FM_DESC.search(fm)),
            "desc_bytes": len(FM_DESC.search(fm).group(1)) if FM_DESC.search(fm) else 0,
            "superseded_by": (FM_SUPER.search(fm).group(1) if FM_SUPER.search(fm) else None),
            "asof": (FM_ASOF.search(fm).group(1) if FM_ASOF.search(fm) else None),
            "name_matches_file": bool(FM_NAME.search(fm)) and FM_NAME.search(fm).group(1) == name,
            "body_sha": hashlib.sha256(body.encode("utf-8")).hexdigest()[:12],
            "mtime": int(os.path.getmtime(os.path.join(store, fn))),
        }
        files[name] = rec
        if name.startswith("hub-"):
            hubs[name] = {"bytes": rec["bytes"], "over_target": rec["bytes"] > HUB_TARGET,
                          "entries": len(LINK.findall(text))}

    out["files"] = files
    out["hubs"] = hubs
    out["counts"] = {"memories": len(files), "hubs": len(hubs)}

    # Reachability: index -> hub -> file. A file nothing points at is invisible
    # to deliberate routing (recall may still surface it on its description).
    # Only hubs the index reaches (directly or through other reached hubs) route;
    # an orphaned hub's members stay unreachable.
    hub_texts = {h: open(os.path.join(store, h + ".md"), encoding="utf-8", errors="replace").read()
                 for h in hubs}
    hub_text = "".join(hub_texts.values())
    reach = set(LINK.findall(index)) | set(WIKI.findall(index))
    pending = [h for h in hubs if h in reach]
    expanded = set()
    while pending:
        h = pending.pop()
        if h in expanded:
            continue
        expanded.add(h)
        found = set(LINK.findall(hub_texts[h])) | set(WIKI.findall(hub_texts[h]))
        pending += [n for n in found if n in hubs and n not in expanded]
        reach |= found
    out["unreachable"] = sorted(set(files) - reach - {"MEMORY.md"})
    out["dangling_links"] = sorted(
        l for l in (set(LINK.findall(index + hub_text)) | set(WIKI.findall(index + hub_text)))
        if l not in files and l != "MEMORY"
    )

    # Index hygiene: a SINGLE-memory line carrying content instead of a hook.
    # A roster line pointing at several memories is long by nature — only flag
    # lines that spend >HOOK_MAX bytes describing one file.
    long_lines = []
    for i, ln in enumerate(index.split("\n"), 1):
        size = len(ln.encode("utf-8"))
        if size > HOOK_MAX and ln.lstrip().startswith("-") and len(LINK.findall(ln)) <= 1:
            long_lines.append({"line": i, "bytes": size, "head": ln[:90]})
    out["index"]["long_lines"] = long_lines

    # Usage evidence from recent transcripts. Two signals, kept apart:
    #   opened   — the path form "memory/<name>.md", which is how a Read of the
    #              file appears. This is real use.
    #   mentioned— the bare "<name>.md", which ALSO matches every time the index
    #              itself is echoed into the transcript. Near-useless alone: a
    #              store whose index was read once scores every file as seen.
    # never_opened is the signal worth acting on.
    opened = {name: 0 for name in files}
    mentioned = {name: 0 for name in files}
    sessions = []
    if os.path.isdir(proj):
        jsonl = sorted(
            (os.path.join(proj, f) for f in os.listdir(proj) if f.endswith(".jsonl")),
            key=os.path.getmtime, reverse=True)[:n_sessions]
        for path in jsonl:
            try:
                blob = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            sessions.append({"file": os.path.basename(path), "bytes": len(blob)})
            for name in files:
                if "memory/" + name + ".md" in blob:
                    opened[name] += 1
                if name + ".md" in blob:
                    mentioned[name] += 1
    out["sessions_scanned"] = sessions
    out["opened"] = opened
    out["mentioned"] = mentioned
    out["never_opened"] = sorted(n for n, c in opened.items() if c == 0)

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--sessions", type=int, default=20)
    args = ap.parse_args()
    json.dump(survey(args.cwd, args.sessions), sys.stdout, indent=1, sort_keys=True)
    print()


if __name__ == "__main__":
    main()
