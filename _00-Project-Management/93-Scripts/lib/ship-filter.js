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
  const base = p.split('/').pop() || '';
  if (/^test-.*\.js$/.test(base)) return false;   // dev self-tests (test-pm-paths.js, test-mode.js, …)
  if (base === 'smoke-dashboard.js') return false; // dev smoke harness
  return true;
}

module.exports = { shouldShipKitScript };
