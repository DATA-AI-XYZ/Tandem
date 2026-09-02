'use strict';
/**
 * host-path-redaction.js — ONE implementation of the board's identity redaction.
 *
 * BUG-20260824-09 / ADR-0238.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES HERE RATHER THAN IN EITHER BUILD
 *
 * TWO builds now emit a board: the shipped `generate-dashboard.js` (CJS) and the
 * ported Preact lane `board/build.mjs` (ESM). The ported board is the one
 * STORY-33.9.05 cuts over to the committed `DASHBOARD.html` name, so a redaction
 * that lived only in the old generator would have been silently undone by the port
 * — measured, before this module existed: the old board was clean at 0 occurrences
 * while `DASHBOARD-NEXT.html` carried 639.
 *
 * A copy in each build would drift, and this repo has already paid for that lesson
 * once (ADR-0175: one artefact-ID grammar, six divergent copies). So: one module,
 * required by the CJS generator and loaded through `createRequire` by the ESM lane.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES, IN THREE PASSES
 *
 *   1. the home directory and its spelling variants  ->  `~`
 *   2. the bare username, if long enough             ->  `~user`
 *   3. project-supplied tokens, longest first        ->  `~user`
 *
 * It DEGRADES rather than deletes: `<home>/source/repos/x` becomes
 * `~/source/repos/x`, so the half a reader actually uses survives.
 *
 * ---------------------------------------------------------------------------
 * WHY PASS 2 EXISTS, GIVEN PASS 1
 *
 * Pass 1 alone took the live board from 642 occurrences to 20, and all 20 were
 * prose: artefacts quoting the username as a denylist token while documenting this
 * very leak class. Leaving them was defensible in the abstract — "the corpus quoting
 * a rule must not be scrubbed by the rule" — and wrong for a SHARED artefact, because
 * a reader learns the username just as well from 20 as from 642.
 *
 * The consumer-safety concern that argued against pass 2 is kept as a LENGTH FLOOR
 * rather than discarded: a consumer whose username is `adm` keeps that word in their
 * own prose. A consumer called `admin` does not, and that trade is stated in ADR-0238
 * rather than hidden here.
 *
 * ---------------------------------------------------------------------------
 * WHY PASS 3 IS CONFIG AND NEVER HARDCODED
 *
 * The environment yields a home path and a username. It does not yield a maintainer's
 * surname, their email, or a former client's codename. `release-tandem.js` keeps a
 * DENYLIST of exactly those, but it is dev-only and never ships — so this module
 * cannot import it and MUST NOT inline it: baking one project's private tokens into a
 * file every consumer receives is the same leak from the other direction. The release
 * scrub gate proved that concretely by refusing a build when an illustrative comment
 * in the generator used real names.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Below this length a username collides with ordinary words too easily to substitute blind. */
const REDACT_MIN_USERNAME = 4;

/**
 * Every spelling of the home directory this corpus actually produced — measured from
 * a context histogram over all 642 occurrences, not imagined. Longest first, so a
 * shorter spelling cannot pre-empt a longer one and strand a fragment.
 */
function hostPathVariants(home) {
  const nativePath = String(home || '');
  if (!nativePath) return [];
  const fwd = nativePath.replace(/\\/g, '/');
  const out = new Set();
  for (const base of [nativePath, fwd]) {
    out.add(base);
    // JSON.stringify has already run by the time a document reaches this, so the
    // escaped spelling is the one most occurrences actually wear.
    out.add(base.replace(/\\/g, '\\\\'));
    if (/^[A-Za-z]:/.test(base)) {
      const lower = base.charAt(0).toLowerCase() + base.slice(1);
      const upper = base.charAt(0).toUpperCase() + base.slice(1);
      out.add(lower);
      out.add(upper);
      out.add(lower.replace(/\\/g, '\\\\'));
      out.add(upper.replace(/\\/g, '\\\\'));
    }
  }
  // The slugified spelling Claude's temp directories use: a Windows user-profile path collapses
  // to "c--Users-<name>", the drive colon and every separator alike becoming dashes.
  // (Spelled out rather than shown as a literal path: the release scrub gate's machine-path shape
  // rule refuses "<drive>:\Users\" anywhere in shipped text, and this file ships — STORY-35.1.02.)
  const slug = fwd.replace(/:/g, '-').replace(/\//g, '-');
  out.add(slug);
  out.add(slug.charAt(0).toLowerCase() + slug.slice(1));
  return Array.from(out).filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * Project-supplied identity tokens, read from `.claude-pm-config.json` beside the repo
 * root. A consumer with no such key gets exactly the environment-derived behaviour.
 * A malformed config degrades to empty rather than throwing: a board that fails to
 * build teaches nobody anything, and the environment-derived passes still run.
 */
function configuredRedactTokens(repoRoot) {
  try {
    const cfgPath = path.join(repoRoot || process.cwd(), '.claude-pm-config.json');
    if (!fs.existsSync(cfgPath)) return [];
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const list = cfg && cfg.redactTokens;
    if (!Array.isArray(list)) return [];
    return list.filter((t) => typeof t === 'string' && t.trim().length >= 3).map((t) => t.trim());
  } catch (e) {
    return [];
  }
}

/**
 * @param {string} text        the assembled document
 * @param {string} [home]      defaults to os.homedir()
 * @param {string[]} [tokens]  defaults to configuredRedactTokens(repoRoot)
 * @param {string} [repoRoot]  where to look for .claude-pm-config.json
 */
function redactHostPaths(text, home, tokens, repoRoot) {
  const src = String(text == null ? '' : text);
  const homeDir = home === undefined ? os.homedir() : home;
  let out = src;

  for (const v of hostPathVariants(homeDir)) out = out.split(v).join('~');

  const user = String(homeDir || '').split(/[\\/]/).filter(Boolean).pop() || '';
  if (user.length >= REDACT_MIN_USERNAME) out = out.split(user).join('~user');

  const extra = (Array.isArray(tokens) ? tokens : configuredRedactTokens(repoRoot))
    .slice()
    .sort((a, b) => b.length - a.length);
  for (const t of extra) out = out.split(t).join('~user');

  return out;
}

module.exports = { redactHostPaths, hostPathVariants, configuredRedactTokens, REDACT_MIN_USERNAME };
