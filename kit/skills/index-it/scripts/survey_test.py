"""The survey's size limits, checked against scratch memory stores under a scratch home.

Claude Code loads the first 200 lines or 25 KB of MEMORY.md, so the survey measures both.
Run: python3 survey_test.py
"""
import os
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True  # no __pycache__ left beside the script
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import survey  # noqa: E402

scratch = tempfile.mkdtemp(prefix="survey-test-")
os.environ["HOME"] = os.path.join(scratch, "home")


def index_of(name, text):
    """The survey's `index` object for a project whose MEMORY.md holds `text`."""
    project = os.path.join(scratch, name)
    os.makedirs(project)
    store = os.path.join(os.environ["HOME"], ".claude", "projects", survey.slug_for(project), "memory")
    os.makedirs(store)
    with open(os.path.join(store, "MEMORY.md"), "w", encoding="utf-8") as f:
        f.write(text)
    return survey.survey(project, 0)["index"]


def lines(n):
    return "".join("- [m%d](m%d.md) - a hook\n" % (i, i) for i in range(n))


try:
    # Lines as Claude Code counts them: blank lines at either end don't count.
    assert index_of("trailing", lines(150) + "\n\n")["lines"] == 150
    assert index_of("leading", "\n\n" + lines(150))["lines"] == 150
    at_target = index_of("at-target", lines(150))
    assert not at_target["over_target"] and not at_target["over_ceiling"]
    past_target = index_of("past-target", lines(151))
    assert past_target["over_target"] and not past_target["over_ceiling"]
    assert not index_of("at-ceiling", lines(200))["over_ceiling"]
    assert index_of("past-ceiling", lines(201))["over_ceiling"]
    # Bytes still count on their own: one long line.
    assert index_of("long", "x" * 16001 + "\n")["over_target"]
    assert index_of("longer", "x" * 24401 + "\n")["over_ceiling"]
    # A byte that isn't UTF-8, in the index, a memory file or a hub, is read as a
    # replacement character rather than stopping the survey.
    project = os.path.join(scratch, "not-utf8")
    os.makedirs(project)
    store = os.path.join(os.environ["HOME"], ".claude", "projects", survey.slug_for(project), "memory")
    os.makedirs(store)
    for name, text in [("MEMORY.md", b"- [hub-a](hub-a.md) - caf\xe9\n"),
                       ("hub-a.md", b"---\nname: hub-a\n---\n- [m](m.md) caf\xe9\n"),
                       ("m.md", b"---\nname: m\ndescription: caf\xe9\n---\nbody \xff\n")]:
        with open(os.path.join(store, name), "wb") as f:
            f.write(text)
    assert survey.survey(project, 0)["counts"] == {"memories": 2, "hubs": 1}
finally:
    shutil.rmtree(scratch)
print("survey size limits and non-UTF-8 bytes: ok")
