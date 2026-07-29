#!/usr/bin/env node
/**
 * tandem-source-resolution.test.js — behavioural test for the Tandem tab's package-source
 * resolution chain (STORY-22.3.01 / BUG-20260729-01 / ADR-0090 / TESTPLAN-22.3.01).
 *
 * Drives the REAL generate-dashboard.js against staged fixtures through the PM_DASH_ROOT seam,
 * in a CHILD process per case (REPO_ROOT/PM_ROOT are resolved once at module load).
 *
 * HOME SANDBOXING is the load-bearing detail: the resolution chain's last step probes
 * ~/.claude/plugins/cache/, so a test that did not override the home directory would silently
 * pick up the operator's real installed plugins and pass (or fail) for the wrong reason. Every
 * case sets HOME **and** USERPROFILE — os.homedir() consults USERPROFILE on Windows.
 *
 * Modes:
 *   order      — TC-01: resolution precedence, and the recorded origin
 *   consumer   — TC-02: a consumer install renders the installed plugin
 *   parity     — TC-03: CLAUDE_PLUGIN_ROOT set vs unset agree
 *   hrefs      — TC-04: published hrefs, no home-directory paths, empty sourceDir
 *   fallback   — TC-06: nothing resolvable => useful panel, no kit-dev instruction
 *   resilience — TC-07: missing / unreadable / malformed cache never throws
 *
 * Exit 0 = pass. Dependency-free (Node stdlib only). Cleans up temp dirs on success and failure.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GENERATOR = path.join(__dirname, '..', 'generate-dashboard.js');
const KIT_BUILD_SCRIPT = ['npm', 'run', 'build:tandem'].join(' ');

let failures = 0;
const temps = [];
function check(name, cond, detail) {
  if (cond) console.log('  ok  - ' + name);
  else { console.log('  FAIL- ' + name + (detail ? ('  [' + detail + ']') : '')); failures += 1; }
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(f, o) { mkdirp(path.dirname(f)); fs.writeFileSync(f, JSON.stringify(o, null, 2)); }
function tmp(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(d); return d; }
function cleanup() { for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_e) { /* best effort */ } } }

/* ------------------------------ fixtures ------------------------------ */

// A plugin tree: manifest + marketplace + N skills + M hooks + rendered docs.
function makePluginTree(root, opts) {
  const o = Object.assign({ name: 'tandem', version: '9.9.9', skills: 3, hooks: 2, docs: ['guide.html', 'playbook.html'] }, opts || {});
  writeJson(path.join(root, '.claude-plugin', 'plugin.json'), {
    name: o.name, version: o.version, description: 'fixture plugin',
    repository: 'https://github.com/DATA-AI-XYZ/Tandem', homepage: 'https://github.com/DATA-AI-XYZ/Tandem',
    license: 'MIT',
  });
  writeJson(path.join(root, '.claude-plugin', 'marketplace.json'), { name: 'data-ai-xyz', plugins: [{ name: o.name }] });
  for (let i = 1; i <= o.skills; i++) {
    const d = path.join(root, 'skills', 'fixture-skill-' + i);
    mkdirp(d);
    fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: fixture-skill-' + i + '\ndescription: fixture skill ' + i + '\n---\n\nbody\n');
  }
  const hooks = {};
  if (o.hooks > 0) hooks.PostToolUse = Array.from({ length: o.hooks }, (_x, i) => ({ matcher: 'M' + i, hooks: [{ command: 'node hook.js ' + i }] }));
  writeJson(path.join(root, 'hooks', 'hooks.json'), { hooks });
  mkdirp(path.join(root, 'docs'));
  for (const d of o.docs) fs.writeFileSync(path.join(root, 'docs', d), '<html></html>');
  // index.html must never be listed as a doc — it is the board itself
  fs.writeFileSync(path.join(root, 'docs', 'index.html'), '<html></html>');
  return root;
}

// A consumer project: PM tree only. No .claude-plugin/, no dist/tt, no build:tandem.
function makeConsumerProject() {
  const root = tmp('tandem-src-consumer-');
  mkdirp(path.join(root, '_00-Project-Management'));
  writeJson(path.join(root, 'package.json'), { name: 'consumer-fixture', version: '0.1.0', scripts: { 'pm:dash': 'node x.js' } });
  return root;
}

// A sandboxed HOME carrying an installed plugin cache at the given versions.
function makeHome(versions, pluginOpts) {
  const home = tmp('tandem-src-home-');
  for (const v of versions || []) {
    const root = path.join(home, '.claude', 'plugins', 'cache', 'data-ai-xyz', 'tandem', v);
    mkdirp(root);
    makePluginTree(root, Object.assign({ version: v }, pluginOpts || {}));
  }
  return home;
}

/* ------------------------------ driver ------------------------------ */

function runGenerator(projectRoot, home, extraEnv) {
  const pmRoot = path.join(projectRoot, '_00-Project-Management');
  const env = Object.assign({}, process.env, { PM_DASH_ROOT: pmRoot, HOME: home, USERPROFILE: home }, extraEnv || {});
  // Never let the caller's own environment bleed into a case that is meant to be unset.
  for (const k of ['PM_DASH_TANDEM_DIST', 'PM_DASH_TANDEM_DOCS_BASE', 'CLAUDE_PLUGIN_ROOT']) {
    if (!(extraEnv && Object.prototype.hasOwnProperty.call(extraEnv, k))) delete env[k];
  }
  const res = spawnSync(process.execPath, [GENERATOR], { env, encoding: 'utf8' });
  const htmlPath = path.join(pmRoot, '42-Monitor', 'DASHBOARD.html');
  const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  return { status: res.status, stderr: res.stderr, html };
}

// Brace-depth scan of window.__DATA — never a non-greedy regex (the payload embeds artefact prose
// containing "};" and several distinct "docs" keys).
function extractEmbeddedData(html) {
  const marker = 'window.__DATA = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('window.__DATA marker not found');
  const jsonStart = start + marker.length;
  let depth = 0, inString = false, escape = false, i = jsonStart;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return JSON.parse(html.slice(jsonStart, i));
}

function pkgOf(projectRoot, home, extraEnv) {
  const { status, stderr, html } = runGenerator(projectRoot, home, extraEnv);
  if (status !== 0) throw new Error('generator exited ' + status + ': ' + stderr);
  return extractEmbeddedData(html);
}

/* ------------------------------ modes ------------------------------ */

function modeOrder() {
  const proj = makeConsumerProject();
  const home = makeHome(['1.0.0', '2.7.2', '2.10.0']);       // 2.10.0 > 2.7.2 numerically, not lexically
  const pluginRoot = makePluginTree(tmp('tandem-src-root-'), { version: '5.0.0' });
  const override = makePluginTree(tmp('tandem-src-override-'), { version: '7.0.0' });

  let d = pkgOf(proj, home, { PM_DASH_TANDEM_DIST: override, CLAUDE_PLUGIN_ROOT: pluginRoot });
  check('override wins over CLAUDE_PLUGIN_ROOT and the cache', d.tandemPackage && d.tandemPackage.origin === 'override' && d.tandemPackage.manifest.version === '7.0.0',
    d.tandemPackage && d.tandemPackage.origin);

  d = pkgOf(proj, home, { CLAUDE_PLUGIN_ROOT: pluginRoot });
  check('CLAUDE_PLUGIN_ROOT wins over the cache', d.tandemPackage && d.tandemPackage.origin === 'plugin-root' && d.tandemPackage.manifest.version === '5.0.0',
    d.tandemPackage && d.tandemPackage.origin);

  d = pkgOf(proj, home, {});
  check('cache is used when nothing else resolves', d.tandemPackage && d.tandemPackage.origin === 'plugin-cache',
    d.tandemPackage && d.tandemPackage.origin);
  check('cache picks the highest SEMVER (2.10.0 > 2.7.2), not lexical order', d.tandemPackage && d.tandemPackage.manifest.version === '2.10.0',
    d.tandemPackage && d.tandemPackage.manifest.version);

  if (!failures) console.log('\nORDER-OK');
}

function modeConsumer() {
  const proj = makeConsumerProject();
  const home = makeHome(['2.7.2'], { skills: 30, hooks: 3 });
  const { status, html } = runGenerator(proj, home, {});
  check('generator exits 0', status === 0);
  const d = extractEmbeddedData(html);
  const tp = d.tandemPackage;
  check('consumer install resolves a package (not null)', !!tp);
  check('isKitRepo stays false — the gate is untouched', d.isKitRepo === false);
  check('skill count matches the installed version', tp && tp.skills.length === 30, tp && tp.skills.length);
  check('hook count matches the installed version', tp && tp.hooks.length === 3, tp && tp.hooks.length);
  // Anchored negatives, NOT whole-file greps of a bare token (grep-confound rule): `build:tandem`
  // legitimately appears in the always-present glossary entry describing the release pipeline, and
  // the bare string "Not applicable." is a dead client-side default in RENDERERS.tandem. Match the
  // exact retired sentence and the full instructional sentence instead — same discipline as
  // tandem-tab-gate.test.js.
  check('the retired consumer copy is gone from the artefact',
    !html.includes('Not applicable — the Tandem build pipeline runs only in the kit'));
  check('no un-followable kit-dev build instruction is rendered',
    !html.includes('Run <code>' + KIT_BUILD_SCRIPT + '</code> to publish the plugin'));
  check('the resolved package is what drives the tab (empty state unused)',
    !!tp && !/Not applicable/i.test(d.tandemEmptyStateHtml || ''));
  if (!failures) console.log('\nCONSUMER-OK skills=' + tp.skills.length + ' hooks=' + tp.hooks.length);
}

function modeParity() {
  const proj = makeConsumerProject();
  const home = makeHome(['2.7.2'], { skills: 30, hooks: 3 });
  const cacheRoot = path.join(home, '.claude', 'plugins', 'cache', 'data-ai-xyz', 'tandem', '2.7.2');
  const viaHook = pkgOf(proj, home, { CLAUDE_PLUGIN_ROOT: cacheRoot }).tandemPackage;
  const viaManual = pkgOf(proj, home, {}).tandemPackage;
  const shape = (p) => JSON.stringify({
    name: p && p.manifest.name, version: p && p.manifest.version,
    skills: p && p.skills.map((s) => s.name), hooks: p && p.hooks.length,
    docs: p && p.docs.map((x) => x.href), sourceDir: p && p.sourceDir,
  });
  check('hook-driven and manual regeneration produce the same package', shape(viaHook) === shape(viaManual));
  check('origins differ but content does not', viaHook.origin === 'plugin-root' && viaManual.origin === 'plugin-cache');
  if (!failures) console.log('\nPARITY-OK');
}

function modeHrefs() {
  const proj = makeConsumerProject();
  const home = makeHome(['2.7.2']);
  const tp = pkgOf(proj, home, {}).tandemPackage;
  const hrefs = (tp.docs || []).map((x) => x.href);
  check('docs were found', hrefs.length > 0);
  check('every doc href is an absolute published URL', hrefs.every((h) => h.startsWith('https://')), hrefs.join(','));
  check('hrefs use the Pages base derived from the manifest repository',
    hrefs.every((h) => h.startsWith('https://data-ai-xyz.github.io/Tandem/')), hrefs[0]);
  check('index.html is not listed as a doc', !hrefs.some((h) => /index\.html$/i.test(h)));
  check('no href leaks the sandboxed home directory', !hrefs.some((h) => h.includes(home) || h.includes('..')));
  check('sourceDir is empty for a non-local origin', tp.sourceDir === '', JSON.stringify(tp.sourceDir));
  if (!failures) console.log('\nHREFS-OK');
}

function modeFallback() {
  const proj = makeConsumerProject();
  const home = tmp('tandem-src-emptyhome-');   // no cache at all
  const { status, html } = runGenerator(proj, home, {});
  check('generator exits 0 with nothing resolvable', status === 0);
  const d = extractEmbeddedData(html);
  check('tandemPackage is null when nothing resolves', d.tandemPackage === null);
  const copy = d.tandemEmptyStateHtml || '';
  check('fallback links the published Guide', copy.includes('guide.html'));
  check('fallback links the Playbook', copy.includes('playbook.html'));
  check('fallback drops the old "Not applicable" wording', !/Not applicable/i.test(copy));
  check('fallback carries no kit-dev build instruction', !copy.includes(KIT_BUILD_SCRIPT));
  if (!failures) console.log('\nFALLBACK-OK');
}

function modeResilience() {
  const proj = makeConsumerProject();

  // (a) home with no .claude at all
  let r = runGenerator(proj, tmp('tandem-src-nohome-'), {});
  check('missing cache directory: generator exits 0', r.status === 0, r.stderr);

  // (b) cache dir exists but holds no plugin manifests
  const bare = tmp('tandem-src-barecache-');
  mkdirp(path.join(bare, '.claude', 'plugins', 'cache', 'data-ai-xyz', 'tandem', '1.2.3'));
  r = runGenerator(proj, bare, {});
  check('cache entry without a manifest: generator exits 0', r.status === 0, r.stderr);
  check('cache entry without a manifest yields no package', extractEmbeddedData(r.html).tandemPackage === null);

  // (c) malformed manifest JSON
  const bad = tmp('tandem-src-badcache-');
  const badRoot = path.join(bad, '.claude', 'plugins', 'cache', 'data-ai-xyz', 'tandem', '3.0.0', '.claude-plugin');
  mkdirp(badRoot);
  fs.writeFileSync(path.join(badRoot, 'plugin.json'), '{ this is not json');
  r = runGenerator(proj, bad, {});
  check('malformed manifest: generator exits 0 (never throws)', r.status === 0, r.stderr);

  // (d) CLAUDE_PLUGIN_ROOT pointing at a non-plugin directory falls through, does not crash
  r = runGenerator(proj, tmp('tandem-src-nohome2-'), { CLAUDE_PLUGIN_ROOT: tmp('tandem-src-notaplugin-') });
  check('bogus CLAUDE_PLUGIN_ROOT: generator exits 0 and falls through', r.status === 0, r.stderr);
  check('bogus CLAUDE_PLUGIN_ROOT yields no package', extractEmbeddedData(r.html).tandemPackage === null);

  if (!failures) console.log('\nRESILIENCE-OK');
}

/* ------------------------------ entry ------------------------------ */

const MODES = { order: modeOrder, consumer: modeConsumer, parity: modeParity, hrefs: modeHrefs, fallback: modeFallback, resilience: modeResilience };
const mode = (process.argv[2] || '').replace(/^--/, '');
if (!MODES[mode]) {
  console.error('Usage: node tandem-source-resolution.test.js <' + Object.keys(MODES).join('|') + '>');
  process.exit(1);
}
try {
  MODES[mode]();
} catch (e) {
  console.log('  FAIL- harness threw: ' + e.message);
  failures += 1;
} finally {
  cleanup();
}
if (failures === 0) { console.log('✓ tandem-source-resolution — all checks passed (' + mode + ').'); process.exit(0); }
console.log('✗ tandem-source-resolution — ' + failures + ' check(s) failed (' + mode + ').');
process.exit(1);
