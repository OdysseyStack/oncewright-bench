# Security

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**, or go straight to
https://github.com/OdysseyStack/oncewright/security/advisories/new. Please don't open a
public issue for it. There is no email address to write to. You will hear back within a week, and
a fix ships as a release whose changelog names the hook or skill that changed.

What counts as a vulnerability here:

- a way for Claude's tools, in the default permission modes, to write a secret file the guard
  documents as protected, or to write the trust file or run the approve command, other than by
  the limits the README lists;
- a hook that lets a call through when its own documentation says it blocks, other than by the
  bypasses listed below;
- `/odyssey:setup` changing a file the repo already had, beyond the changes its dry run
  lists: the `.gitignore` lines it appends, a kit rule it upgrades because you left it
  untouched, and one you edited that you approve replacing;
- a hook or the setup script sending data anywhere. None of them do, and none should.

## Supported versions

The latest 1.x release. Pin a version by adding the marketplace at its tag
(`/plugin marketplace add OdysseyStack/oncewright#v1.0.0`); release tags never move.

## Threat model

The secrets guard is a guardrail against Claude's mistakes in a workspace you trust. It is not a
boundary against a model or a repo set on getting around it, and it guards neither the plugin's
own files nor Claude Code's settings. The known ways around it are documented, not defects:

- **`bypassPermissions` mode**, where nothing stops Claude from writing the settings that switch
  hooks off.
- **A repo's own `.claude/settings.json`**, which can set `disableAllHooks`; in `claude -p` runs
  a repo's committed settings apply without a trust prompt.
- **An edited hook script** in the plugin's installed copy, or an edited file in peek's copy,
  `~/.claude/odyssey-peek`, whose code runs inside Claude Code with no guard checking it;
  `/odyssey:setup doctor` fails a peek that differs from the kit's.
- **Interpreter one-liners** (`node -e`, `python -c`) that open a secret file themselves, which
  the command branch can't see.

The README's "Known limits" section lists the narrower cases the command branch leaves open. To
enforce a guard across an organization, use Claude Code's managed settings, which can limit
hooks to those from managed settings and force-enabled plugins, and which a repo or a session
can't turn off.

## Supply chain

The first release is the one commit that created the repository. After it, `main` changes only
through pull requests, with CI and CodeRabbit's review required and no bypass for anyone, the
maintainer included, and releases are tagged from it. The organization requires two-factor
authentication. The plugin has no runtime dependencies: the hooks and the setup script use only
Node's standard library, and the companion skills the README recommends are linked, never
bundled.
