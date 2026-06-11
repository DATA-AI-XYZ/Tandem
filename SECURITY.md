# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 2.x | ✅ |
| 1.x | ⚠️ security fixes only |
| < 1.0 | ❌ |

## Threat model

This plugin is **a Claude Code extension**, not a network service. The threat surface is narrow but real:

1. **Hooks execute shell commands.** A malicious hook in this plugin would run on a user's machine when they edit PM-folder files (PostToolUse) or end a session (Stop). The shipped hooks invoke a single stdlib-only Node entrypoint directly — `node ${CLAUDE_PLUGIN_ROOT}/_00-Project-Management/93-Scripts/hook.js` (no `npm` step) — and they do NOT make network calls, modify files outside `_00-Project-Management/`, or read secrets.
2. **Skills load content into Claude's context.** A skill that contained prompt-injection payloads could attempt to manipulate Claude's behaviour against the user. All shipped skills are static markdown vetted at release; no skill loads remote content at runtime.
3. **Scaffold copy on install.** The plugin drops `scaffold/_00-Project-Management/` into the user's project root. No file outside that folder is touched.
4. **Validator scripts.** `93-Scripts/validate-frontmatter.js` and `93-Scripts/generate-dashboard.js` are pure-Node, stdlib-only, no I/O beyond reading PM files and writing the dashboard HTML. They do not execute user input.

## Reporting a vulnerability

**Do not file a public issue for security vulnerabilities.**

Email: `info@dataxyzconnect.com`

Include:
- The vulnerable file / function / command.
- A reproduction (minimum code, exact command).
- Your assessment of impact (information disclosure / code execution / DoS / etc.).
- Your proposed fix, if you have one.

Expect an acknowledgement within 72 hours, a fix or determination within 14 days for critical issues.

## What we will treat as a vulnerability

- Hook commands that escape their intended scope (e.g. modifying files outside `_00-Project-Management/`).
- Validator script that can be coerced to execute arbitrary code via crafted frontmatter.
- Skill content that performs prompt injection against the user.
- Scaffold install that overwrites unrelated user files.
- Any path-traversal or shell-injection in the scripts.

## What we will NOT treat as a vulnerability

- Failing to detect malicious user content (e.g. a malicious PM artefact filed by the user themselves) — the kit doesn't claim to validate user-authored prose.
- Issues in transitive dependencies of Node.js itself or in user-provided npm scripts the user wires up themselves.
- Behaviour that requires the attacker to already have write access to the user's `_00-Project-Management/` folder — that's a pre-existing compromise.

## Coordinated disclosure

For confirmed vulnerabilities, we aim for coordinated disclosure: reporter and maintainer agree on a fix, a release date, and (optionally) a public advisory after the patched version ships.
