# Contributing to Tandem

Thanks for your interest. This plugin is opinionated about its own development — it dogfoods its own rules. If you've read the [README](README.md) and the [CHANGELOG](CHANGELOG.md), the workflow will feel familiar.

## TL;DR

1. **Open an issue first** for anything beyond a typo or doc clarification. The plugin is small; coordination prevents wasted effort.
2. **Follow the PM kit's own conventions** when contributing — the plugin uses itself for its own work tracking under `_00-Project-Management/`.
3. **All AI-authored diffs require an explicit AI-code review pass** per SOP §7 DoD. Disclose in the PR description if Claude or another AI wrote >50 lines of the change.

## Reporting bugs

File an issue with the **Bug report** template. Include:

- Environment (OS, Node version, Claude Code version)
- The exact command that failed
- The expected vs actual behaviour
- The minimum reproduction

For security issues, do **not** file a public issue — see [SECURITY.md](SECURITY.md).

## Suggesting changes

File an issue with the **Feature proposal** template. The plugin has explicit boundary conditions (solo / small-team workflows; see SOP §19) — proposals that would push past those bounds are unlikely to land.

If the change is small and obvious, you can skip straight to a PR.

## Pull requests

1. Fork the repo and create a feature branch from `main`.
2. Make your changes. **Run the kit's own validators** before pushing:
   ```bash
   npm run pm:lint    # validates frontmatter on any PM artefacts in the repo
   npm run pm:dash    # regenerates the dashboard
   ```
3. If you're adding or changing a hook / skill: test it locally with `claude --plugin-dir .` against a throwaway project.
4. Update [CHANGELOG.md](CHANGELOG.md) under `## [Unreleased]` describing your change.
5. If your PR closes an item tracked in `_00-Project-Management/`, link the artefact path in the PR description.
6. Open the PR using the template. CI runs `pm:lint` on every push.

## What the maintainer looks for

- **Does it preserve the kit's opinions?** Closed status enum, story-testplan pairing, frontmatter timestamps, ADR-on-the-spot. The kit's value is its discipline.
- **Is there a paired testplan?** If you're adding a feature, write the testplan first (or alongside).
- **Does it dogfood?** Changes to the kit should be tracked in the kit's own `_00-Project-Management/`. If your PR doesn't update the relevant artefacts there, it's incomplete.
- **Is it stack-agnostic?** The kit must work on web, mobile, CLI, library, backend, data-pipeline, Power Platform, and automation projects. PRs that bake in assumptions about one stack get pushback.
- **Is the diff small?** Smaller is better. Multi-purpose PRs get split.

## Code of conduct

Be direct, respect time, assume good faith. No personal attacks, no harassment. The maintainer reserves the right to close PRs / issues that violate this.

## Maintainer expectations

- Issue triage: within 7 days.
- PR first review: within 14 days for small PRs (<100 lines), 30 days for larger.
- Release cadence: when meaningful work accumulates, not on a calendar.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
