/**
 * ship-filter.js — the single predicate for "does this 93-Scripts file ship to a consumer?".
 *
 * The kit's 93-Scripts tree is materialized into consumer projects (install.js step 0b),
 * refreshed there (update.js), and copied into the public plugin build (release-tandem.js
 * copyPmAssets). Dev-only test/fixture files must NOT reach a consumer: they're dead weight, and
 * the fixture `package.json` manifests under `__fixtures__` are a latent confounder for a consumer's
 * workspace tooling / layout detection (AI-code-review M1, STORY-16.4.05). One predicate, used by
 * all three call sites, keeps the shipped set consistent.
 *
 * `relPath` is POSIX-or-Windows relative to the 93-Scripts root.
 * Dependency-free — Node stdlib only (no imports needed).
 */
'use strict';

function shouldShipKitScript(relPath) {
  const p = String(relPath).replace(/\\/g, '/');
  if (p === '__fixtures__' || p.startsWith('__fixtures__/') || p.includes('/__fixtures__/')) return false;
  // The tests/ tree (STORY-22.4.01 / BACKLOG-0093). Two conventions coexist in this repo: the older
  // self-tests at the scripts root are `test-*.js`, while everything under tests/ is `*.test.js` —
  // which the rule below never matched, so all 17 of them shipped to consumers and into the public
  // plugin. Exclude the DIRECTORY (release-tandem passes dirs to fs.cpSync's filter, and returning
  // false there prunes the whole subtree) AND the dotted basename (so a stray test elsewhere is
  // still caught).
  if (p === 'tests' || p.startsWith('tests/') || p.includes('/tests/')) return false;
  const base = p.split('/').pop() || '';
  if (/^test-.*\.js$/.test(base)) return false;   // dev self-tests (test-pm-paths.js, test-mode.js, …)
  if (/\.test\.[cm]?js$/.test(base)) return false; // dev suites (foo.test.js / .cjs / .mjs)
  if (base === 'smoke-dashboard.js') return false; // dev smoke harness
  // …and the modules STORY-34.1.06 split it into (BACKLOG-0190). The harness stopped being one
  // file; it did not stop being dev-only. Without this the split would have quietly ADDED ~15k
  // lines of dev harness to every consumer install and to the public plugin — a behaviour change
  // the split was explicitly not allowed to make. Scoped to `lib/`, so a future shipped script
  // whose name happens to start with `smoke-` at the scripts root is not caught by accident.
  if (/^lib\/smoke-[^/]*\.js$/.test(p)) return false;
  // Transient copies of production scripts that test harnesses write INTO this tree so that
  // `__dirname`-relative requires still resolve (`.mutant-<pid>-…` from the mutation harnesses,
  // `.control-<pid>-…` from STORY-33.10.01's A/B arm). They are removed in `finally`, but a
  // SIGTERM — including run-suite.js's own `--timeout` kill — skips that. `.gitignore` already
  // stops a survivor being committed; without this it would still be COPIED into every consumer
  // install (install.js step 0b, update.js step 2) and into the public plugin
  // (release-tandem.js copyPmAssets), where it is a silent duplicate of a production script that
  // carries no denylist token and so passes the scrub gate untouched.
  if (/^\.(mutant|control)-/.test(base) || /\.mutant-backup-/.test(base)) return false;
  return true;
}

module.exports = { shouldShipKitScript };
