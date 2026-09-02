#!/usr/bin/env node
'use strict';

/**
 * release-producer.js — STORY-25.6.02 (EPIC-25 / FEAT-25.6)
 *
 * The missing PRODUCER for `13-Releases/`. The consumer was already wired end to end
 * (installer manifest entry, RELEASE.template.md, path mapping, dashboard scanner at
 * generate-dashboard.js SCAN_DIRS.release, and the Cadence -> Releases renderer); only
 * the step that WRITES a release artefact was absent, which is why the panel read 0.
 *
 * Two modes, one renderer:
 *
 *   1. --version vX.Y.Z [--since ISO --until ISO]
 *      The release step proper. Derives the in-window stories, bugs and decisions from
 *      artefact frontmatter under the PM root, the same corpus close-phase reads.
 *
 *   2. --all-from-changelog
 *      The one-off backfill. Emits one artefact per version heading in CHANGELOG.md,
 *      deriving each record's content from THAT VERSION'S OWN SECTION.
 *
 * CONTENT CORRECTNESS IS THE WHOLE POINT (CHAT-08 review, parseReviewVerdict).
 * That defect took the first verdict-shaped word ANYWHERE in a file, so 35 of 105 cards
 * showed a verdict the document never gave. The identical trap is available here: a
 * changelog scraper that searches the whole file rather than one version's own slice
 * would attribute v2.7.0's stories to v2.6.1 and still produce 15 plausible files.
 *
 * The guard is structural, not stylistic:
 *   - sliceSections() cuts each version's body STRICTLY between its own heading and the
 *     next version heading. Nothing reads across a boundary. There is no whole-file scan.
 *   - Every derived field (summary, story ids, bug ids, ADR ids) is a pure function of
 *     that one slice, so a record can be checked against its source rather than merely
 *     counted. tests/release-producer.test.js pins exactly that.
 *
 * Section headings are read FROM the template rather than hardcoded, so "the output
 * matches RELEASE.template.md" is guaranteed by construction and survives a template
 * edit instead of silently drifting from it.
 *
 * Exit codes: 0 ok · 1 failure · 2 usage error.
 */

const fs = require('fs');
const path = require('path');

const PM_ROOT_DEFAULT = path.resolve(__dirname, '..');
const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..', '..');

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

// An empty flag value exits 2 rather than being read as "absent". `--version ''`
// is a caller mistake, and silently producing RELEASE-v.md for it is how a probe
// ends up asserting against a file nobody meant to write.
function value(argv, i, flag) {
  const v = argv[i];
  if (v === undefined || String(v).indexOf('--') === 0) {
    throw new UsageError(flag + ' expects a value');
  }
  if (String(v).trim() === '') {
    throw new UsageError(flag + ' was given an EMPTY value; refusing to guess what was meant');
  }
  return String(v);
}

function parseArgs(argv) {
  const out = {
    pmRoot: PM_ROOT_DEFAULT,
    repoRoot: null,
    version: null,
    allFromChangelog: false,
    changelog: null,
    outDir: null,
    since: null,
    until: null,
    force: false,
    // Versions cut in the changelog but not actually published. Cannot be derived from
    // git tags: this repo has 5 tags for 15 shipped versions, so tag-absence proves
    // nothing. Stated explicitly so a record never asserts a release that did not ship.
    unpublished: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') { out.pmRoot = path.resolve(value(argv, ++i, a)); }
    else if (a === '--repo-root') { out.repoRoot = path.resolve(value(argv, ++i, a)); }
    else if (a === '--version') { out.version = value(argv, ++i, a); }
    else if (a === '--all-from-changelog') { out.allFromChangelog = true; }
    else if (a === '--changelog') { out.changelog = path.resolve(value(argv, ++i, a)); }
    else if (a === '--out') { out.outDir = path.resolve(value(argv, ++i, a)); }
    else if (a === '--since') { out.since = value(argv, ++i, a); }
    else if (a === '--until') { out.until = value(argv, ++i, a); }
    else if (a === '--force') { out.force = true; }
    else if (a === '--unpublished') {
      const v = value(argv, ++i, a);
      if (!/^v\d+\.\d+\.\d+$/.test(v)) throw new UsageError('--unpublished must look like v1.2.3, got: ' + v);
      out.unpublished.push(v);
    }
    else throw new UsageError('unknown flag: ' + a);
  }
  if (!out.version && !out.allFromChangelog) {
    throw new UsageError('one of --version <vX.Y.Z> or --all-from-changelog is required');
  }
  if (out.version && !/^v\d+\.\d+\.\d+$/.test(out.version)) {
    throw new UsageError('--version must look like v1.2.3, got: ' + out.version);
  }
  if (!out.repoRoot) out.repoRoot = out.pmRoot === PM_ROOT_DEFAULT ? REPO_ROOT_DEFAULT : path.dirname(out.pmRoot);
  if (!out.changelog) out.changelog = path.join(out.repoRoot, 'CHANGELOG.md');
  if (!out.outDir) out.outDir = path.join(out.pmRoot, '13-Releases');
  return out;
}

// ---------------------------------------------------------------------------
// template
// ---------------------------------------------------------------------------

function readTemplate(pmRoot) {
  const p = path.join(pmRoot, '91-Templates', 'RELEASE.template.md');
  if (!fs.existsSync(p)) {
    throw new Error('RELEASE.template.md not found at ' + p + ' — the producer writes FROM the template, so it cannot proceed without it');
  }
  return fs.readFileSync(p, 'utf8');
}

// The ordered list of `## ` headings the template declares. Output follows this list,
// so the produced artefact's section set is the template's by construction.
function templateHeadings(tpl) {
  const body = tpl.replace(/^---[\s\S]*?\n---\n/, '');
  const out = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// changelog
// ---------------------------------------------------------------------------

const VERSION_HEADING = /^##\s+\[(\d+\.\d+\.\d+)\][^\S\n]*[—\-–][^\S\n]*(\d{4}-\d{2}-\d{2})\s*$/gm;

/**
 * Cut CHANGELOG.md into one slice per version heading.
 *
 * The boundary discipline is the anti-parseReviewVerdict guard: `body` runs from the
 * end of this heading to the start of the NEXT version heading (or EOF). No derived
 * field ever sees text belonging to another version, so "v2.7.0's summary" cannot be
 * satisfied by v2.6.1's prose the way a whole-file search would allow.
 */
function sliceSections(text) {
  const heads = [];
  let m;
  VERSION_HEADING.lastIndex = 0;
  while ((m = VERSION_HEADING.exec(text)) !== null) {
    heads.push({ version: m[1], date: m[2], start: m.index, bodyStart: m.index + m[0].length });
  }
  return heads.map((h, i) => ({
    version: h.version,
    date: h.date,
    body: text.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].start : text.length).trim(),
  }));
}

// The version's own lede: the first non-empty paragraph of its slice. This is the
// one-paragraph "what ships and what it unlocks" the template's Summary asks for,
// and the changelog already writes it in bold as the section's opening line.
function ledeOf(body) {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  for (const p of paras) {
    if (/^###\s/.test(p)) break;
    if (p) return p.replace(/\s*\n\s*/g, ' ');
  }
  return '';
}

/**
 * The card title, derived from THIS version's own lede.
 *
 * Every changelog entry opens with a bold theme phrase; that phrase is what an operator
 * scanning Cadence -> Releases actually needs, and 15 cards all reading "Release vX.Y.Z"
 * would be a panel that renders without informing. Same boundary rule as everything else
 * here: the lede is already this version's slice, so the title cannot come from a
 * neighbour. Falls back to the plain version when a section has no bold phrase, rather
 * than inventing one.
 */
function titleFromLede(lede, version) {
  const bold = /\*\*(.+?)\*\*/.exec(lede || '');
  if (!bold) return 'Release v' + version;
  let t = bold[1]
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:;,\s]+$/, '');
  if (t.length > 120) t = t.slice(0, 117).replace(/\s+\S*$/, '') + '…';
  return t || ('Release v' + version);
}

// Ids this version's slice LITERALLY names. Ranges written as prose ("ADR-0098..0102",
// "0079-0085") are deliberately NOT expanded — a backfilled record states what the
// changelog substantiates and nothing more (AC-4).
function idsIn(body) {
  const uniq = (re) => {
    const seen = [];
    let m;
    const r = new RegExp(re.source, 'g');
    while ((m = r.exec(body)) !== null) if (seen.indexOf(m[0]) === -1) seen.push(m[0]);
    return seen.sort();
  };
  return {
    stories: uniq(/STORY-\d+\.\d+\.\d+/),
    bugs: uniq(/BUG-\d{8}-\d+/),
    adrs: uniq(/ADR-\d{4}/),
  };
}

// A subsection of the slice, e.g. "### Changed". Same boundary rule as sliceSections:
// it stops at the next `###`, so it cannot bleed into a sibling subsection.
// `name` is matched as a PREFIX of the heading text, because real headings carry
// qualifiers ("### Migration notes (from v1.0.0)", "### Migration from v1.1.0") that an
// anchored exact match silently misses — which is how 4 of 15 records got the wrong
// migration content.
function subsection(body, name) {
  const re = new RegExp('^###\\s+' + name + '.*$', 'mi');
  const m = re.exec(body);
  if (!m) return '';
  const rest = body.slice(m.index + m[0].length);
  const next = /^###\s+/m.exec(rest);
  // A trailing `---` is the changelog's horizontal rule between VERSIONS, not content
  // of this subsection; carrying it into the record renders a stray divider.
  return (next ? rest.slice(0, next.index) : rest).replace(/\n\s*-{3,}\s*$/, '').trim();
}

/**
 * The migration / breaking-changes content for a version.
 *
 * CHAT-09 review MAJOR-1. This used to read `### Changed`, which is a different claim
 * entirely: `### Changed` lists internal changes, while the migration question is "what
 * must a consumer DO to upgrade". The two disagree in both directions and did:
 *   - v2.3.0 and v2.1.0 carry a `### Migration notes` section that says **"No breaking
 *     changes."** while their `### Changed` lists internal edits — the record asserted
 *     breaking changes that its own source denies.
 *   - v2.0.0 and v1.1.0 carry REAL migration steps under a qualified heading
 *     ("### Migration from v1.1.0") that the old exact-match regex never found, so the
 *     records dropped instructions like "Add `ai_review: pending` to all existing STORY
 *     frontmatter" — exactly what a release record exists to carry.
 *
 * So migration content now comes ONLY from a genuine migration heading. There is no
 * fallback to `### Changed`: when a release records no migration section, the honest
 * answer is that it recorded none, not a paraphrase of a different section.
 */
const MIGRATION_HEADINGS = ['Migration', 'Breaking change', 'Upgrading', 'Upgrade'];

function migrationOf(body) {
  for (const h of MIGRATION_HEADINGS) {
    const text = subsection(body, h);
    if (text) return text;
  }
  return '';
}

// ---------------------------------------------------------------------------
// artefact window scan (mode 1)
// ---------------------------------------------------------------------------

function readFrontmatter(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  // CRLF checkouts (BUG-20260819-01 remediation): the working copy is CRLF on Windows, and
  // an unnormalised read makes every frontmatter parse fail silently — which would turn the
  // derived window (newestRecordDate below) back into the genesis sweep it exists to end.
  text = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  return fm;
}

function walk(dir, acc) {
  acc = acc || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

function inWindow(stamp, since, until) {
  if (!stamp) return false;
  const t = Date.parse(stamp);
  if (Number.isNaN(t)) return false;
  if (since && t < Date.parse(since)) return false;
  if (until && t > Date.parse(until)) return false;
  return true;
}

// id -> title over the artefact corpus, so a backfilled record can name what a bug or
// decision id actually refers to instead of printing a bare id (review m-3). Missing
// ids simply stay missing; nothing is invented for one.
function artefactTitles(pmRoot) {
  const out = {};
  for (const sub of ['32-Stories', '34-Bugs', '40-Decisions']) {
    for (const f of walk(path.join(pmRoot, sub))) {
      const fm = readFrontmatter(f);
      if (fm && fm.id && fm.title) out[fm.id] = fm.title;
    }
  }
  return out;
}

function scanWindow(pmRoot, since, until) {
  const pick = (sub, stampKey) => walk(path.join(pmRoot, sub))
    .map((f) => ({ file: f, fm: readFrontmatter(f) }))
    .filter((r) => r.fm && r.fm.id)
    .filter((r) => inWindow(r.fm[stampKey] || r.fm.created_at, since, until))
    .map((r) => ({ id: r.fm.id, title: r.fm.title || '', status: r.fm.status || '' }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  return {
    stories: pick('32-Stories', 'completed_at'),
    bugs: pick('34-Bugs', 'completed_at'),
    adrs: pick('40-Decisions', 'created_at'),
  };
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function yamlQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function releaseType(version, previous) {
  const [ma, mi] = version.split('.').map(Number);
  if (!previous) return 'major';
  const [pa, pi] = previous.split('.').map(Number);
  if (ma !== pa) return 'major';
  if (mi !== pi) return 'minor';
  return 'patch';
}

function storyTable(rows) {
  if (!rows.length) return '_The changelog entry for this release names no story ids._';
  return ['| Story | Title | Status |', '|---|---|---|']
    .concat(rows.map((r) => '| ' + r.id + ' | ' + (r.title || '—') + ' | ' + (r.status || 'done') + ' |'))
    .join('\n');
}

// m-3 — a bare id tells a reader nothing. Where the referenced artefact exists in the
// corpus its title is pulled in; where it does not, the record SAYS so rather than
// implying the id is resolvable. Injected titles are stripped of id-shaped tokens so
// enriching a record can never change the id set a fidelity check compares.
function scrubIds(s) {
  return String(s || '')
    .replace(/STORY-\d+\.\d+\.\d+/g, 'a story')
    .replace(/BUG-\d{8}-\d+/g, 'a bug')
    .replace(/ADR-\d{4}/g, 'a decision')
    .replace(/\|/g, '/')
    .trim();
}

function bugTable(rows) {
  if (!rows.length) return '_The changelog entry for this release names no bug ids._';
  return ['| Bug | Summary |', '|---|---|']
    .concat(rows.map((r) => '| ' + r.id + ' | ' +
      (r.title ? scrubIds(r.title) : 'Named in this release’s CHANGELOG entry; no artefact for this id in `34-Bugs/`.') + ' |'))
    .join('\n');
}

// m-2 — the template heading is "Decisions ratified", but what the backfill can honestly
// derive is which ADR ids the entry NAMES. Mention is not ratification, and the record
// says which of the two it is asserting rather than letting the heading overclaim.
function adrList(rows) {
  if (!rows.length) return '- _The changelog entry for this release names no ADR ids._';
  return ['_ADR ids named in this release’s changelog entry. Naming is not by itself ratification — see each ADR for its own `adr_status`._', '']
    .concat(rows.map((r) => '- ' + r.id + (r.title ? ' — ' + scrubIds(r.title) : ''))).join('\n');
}

/**
 * Build the artefact. `headings` comes from the template, and every heading is emitted
 * in the template's own order; SECTION_BODY supplies content for the ones this producer
 * knows how to fill and an explicit honest note for the rest. An unknown heading added
 * to the template later still appears in output rather than being silently dropped.
 */
function renderRelease(spec, headings) {
  const bodies = {
    'Summary': spec.summary,
    'Stories included': storyTable(spec.stories),
    'Bugs fixed': bugTable(spec.bugs),
    'Decisions ratified': adrList(spec.adrs),
    'Migration / breaking changes': spec.migration && spec.migration.trim()
      ? spec.migration.trim()
      : '- The changelog entry for this release records no migration or breaking-changes section.',
    'Smoke-test checklist': [
      '- [ ] `npm run pm:lint` exits 0',
      '- [ ] `npm run pm:dash` regenerates the board without diagnostics',
      '- [ ] Cadence → Releases lists this version',
    ].join('\n'),
    'Rollback plan': spec.backfilled
      ? 'Not applicable — this is a backfilled record of a release that already shipped.'
      : '1. Revert the release commit\n2. Re-run `npm run pm:dash`\n\n**Time budget for rollback:** 10 minutes',
    'Communication': [
      '- [x] Recorded in `CHANGELOG.md`',
      spec.published
        ? '- [ ] External release notes drafted (if customer-facing)'
        : '- [ ] **NOT YET PUBLISHED.** This version is cut in `CHANGELOG.md` and the manifests, but no ' +
          'git tag has been pushed and the public build has not shipped. The record describes what the ' +
          'version CONTAINS; it does not assert that it was released.',
    ].join('\n'),
    'Metrics to watch (post-deploy)': '- Board renders this release under Cadence → Releases',
    'Retro hook': 'Items to surface in the monthly retro:\n- see `CHANGELOG.md` for the full entry',
  };

  const fm = [
    '---',
    'type: release',
    'id: RELEASE-' + spec.version,
    'title: ' + yamlQuote(spec.title),
    'status: ' + spec.status,
    'created_at: ' + yamlQuote(spec.createdAt),
    'started_at: ' + yamlQuote(spec.startedAt || ''),
    'completed_at: ' + yamlQuote(spec.completedAt || ''),
    'version: ' + spec.version,
    'target_date: ' + spec.date,
    'release_type: ' + spec.releaseType,
    'changelog_substantiated: ' + (spec.substantiated ? 'true' : 'false'),
    'published: ' + (spec.published ? 'true' : 'false'),
    'html_context: []',
    '---',
    '',
    '# RELEASE-' + spec.version + ' · ' + spec.title,
    '',
    '',
  ].join('\n');

  const sections = headings.map((h) => {
    const body = Object.prototype.hasOwnProperty.call(bodies, h)
      ? bodies[h]
      : '_Not recorded for this release._';
    return '## ' + h + '\n' + body + '\n';
  }).join('\n');

  return fm + sections;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function produceFromChangelog(cfg, headings) {
  if (!fs.existsSync(cfg.changelog)) {
    throw new Error('CHANGELOG.md not found at ' + cfg.changelog);
  }
  const sections = sliceSections(fs.readFileSync(cfg.changelog, 'utf8'));
  if (!sections.length) {
    throw new Error('no version headings matched in ' + cfg.changelog + ' — expected lines like "## [1.2.3] — 2026-01-31"');
  }
  const written = [];
  const unsubstantiated = [];
  const titles = artefactTitles(cfg.pmRoot);
  // sections are newest-first in the file; previous version = the NEXT entry.
  sections.forEach((s, i) => {
    const prev = sections[i + 1] ? sections[i + 1].version : null;
    const ids = idsIn(s.body);
    const lede = ledeOf(s.body);
    const substantiated = lede.length >= 20;
    if (!substantiated) unsubstantiated.push(s.version);
    const stamp = s.date + 'T12:00:00+01:00';
    const published = cfg.unpublished.indexOf('v' + s.version) === -1;
    const md = renderRelease({
      version: 'v' + s.version,
      date: s.date,
      title: titleFromLede(lede, s.version),
      summary: substantiated
        ? lede
        : '_The CHANGELOG entry for this version carries no summary paragraph; nothing has been invented here. See `CHANGELOG.md`._',
      stories: ids.stories.map((id) => ({ id, title: titles[id] || '', status: 'done' })),
      bugs: ids.bugs.map((id) => ({ id, title: titles[id] || '' })),
      adrs: ids.adrs.map((id) => ({ id, title: titles[id] || '' })),
      migration: migrationOf(s.body),
      // An unpublished version is NOT done. Its completion stamp stays empty so the
      // record cannot claim a finish date for something that has not finished.
      status: published ? 'done' : 'in-review',
      createdAt: stamp,
      startedAt: stamp,
      completedAt: published ? stamp : '',
      releaseType: releaseType(s.version, prev),
      substantiated,
      published,
      backfilled: true,
    }, headings);
    const file = path.join(cfg.outDir, 'RELEASE-v' + s.version + '.md');
    if (fs.existsSync(file) && !cfg.force) { written.push({ file, skipped: true }); return; }
    fs.writeFileSync(file, md, 'utf8');
    written.push({ file, skipped: false });
  });
  return { written, unsubstantiated, count: sections.length };
}

/**
 * The newest existing release record's date, for default-window derivation
 * (BUG-20260819-01 / ADR-0223 amendment 2026-08-19). The target version's own file is
 * excluded so a --force regeneration cannot derive its window from itself (an empty
 * window would silently produce an empty record).
 */
function newestRecordDate(outDir, excludeVersion) {
  let best = null;
  let entries;
  try { entries = fs.readdirSync(outDir); } catch (e) { return null; }
  for (const name of entries) {
    if (!/^RELEASE-v\d+\.\d+\.\d+\.md$/.test(name)) continue;
    if (name === 'RELEASE-' + excludeVersion + '.md') continue;
    const fm = readFrontmatter(path.join(outDir, name));
    if (!fm) continue;
    const stamp = fm.created_at || fm.target_date || '';
    const t = Date.parse(stamp);
    if (Number.isNaN(t)) continue;
    if (!best || t > best.t) best = { t, date: stamp, id: fm.id || name.replace(/\.md$/, '') };
  }
  return best;
}

function produceOne(cfg, headings) {
  const file = path.join(cfg.outDir, 'RELEASE-' + cfg.version + '.md');
  // BUG-20260819-01 (E31 review BLOCKER-1): NEVER overwrite an existing record unless the
  // caller passed --force. This mode is now auto-invoked by the release path (ADR-0223), so
  // an unconditional write here was armed against the curated live record on every real
  // build. Mirrors produceFromChangelog's own skip and writeWaiveStub's refusal shape: an
  // existing record is strictly better evidence than a regeneration.
  if (fs.existsSync(file) && !cfg.force) {
    return { file, skipped: true };
  }
  // Default window (same bug, second half): with no --since, derive it from the newest
  // existing release record instead of sweeping the whole corpus — an auto-run record must
  // describe the work since the LAST release, never everything since genesis. An explicit
  // --since always wins; a root with no prior records keeps the unwindowed scan (a first
  // release genuinely covers everything).
  let since = cfg.since;
  let derivedFrom = null;
  if (!since) {
    const prev = newestRecordDate(cfg.outDir, cfg.version);
    if (prev) { since = prev.date; derivedFrom = prev.id; }
  }
  const win = scanWindow(cfg.pmRoot, since, cfg.until);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()) +
    sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  const md = renderRelease({
    version: cfg.version,
    date: stamp.slice(0, 10),
    title: 'Release ' + cfg.version,
    summary: 'Release ' + cfg.version + ' bundles the work completed in the window ' +
      (since || 'the start of the project') + ' to ' + (cfg.until || 'now') +
      (derivedFrom ? ' (window derived from ' + derivedFrom + ')' : '') + '. ' +
      win.stories.length + ' story/stories, ' + win.bugs.length + ' bug(s) and ' +
      win.adrs.length + ' decision(s) fall inside it.',
    stories: win.stories,
    bugs: win.bugs,
    adrs: win.adrs,
    migration: '',
    status: 'not-started',
    createdAt: stamp,
    startedAt: '',
    completedAt: '',
    releaseType: releaseType(cfg.version.replace(/^v/, ''), null),
    substantiated: true,
    // A release step runs BEFORE the version is published, so a freshly-produced record
    // is unpublished by definition. Nothing to derive from --unpublished here.
    published: false,
    backfilled: false,
  }, headings);
  fs.writeFileSync(file, md, 'utf8');
  return {
    file,
    counts: { stories: win.stories.length, bugs: win.bugs.length, adrs: win.adrs.length },
    window: { since: since || null, until: cfg.until || null, derivedFrom },
  };
}

function main(argv) {
  let cfg;
  try { cfg = parseArgs(argv); }
  catch (e) {
    if (e instanceof UsageError) { console.error('[release-producer] usage: ' + e.message); return 2; }
    throw e;
  }
  try {
    const headings = templateHeadings(readTemplate(cfg.pmRoot));
    if (!headings.length) throw new Error('RELEASE.template.md declares no `## ` sections');
    fs.mkdirSync(cfg.outDir, { recursive: true });

    if (cfg.allFromChangelog) {
      const res = produceFromChangelog(cfg, headings);
      const wrote = res.written.filter((w) => !w.skipped).length;
      const skipped = res.written.length - wrote;
      console.log('[release-producer] ' + res.count + ' version(s) in changelog; wrote ' + wrote +
        (skipped ? ', skipped ' + skipped + ' existing (use --force to overwrite)' : ''));
      if (res.unsubstantiated.length) {
        console.log('[release-producer] NOT SUBSTANTIATED by the changelog (flagged in-file, not invented): ' +
          res.unsubstantiated.join(', '));
      }
      return 0;
    }
    const res = produceOne(cfg, headings);
    if (res.skipped) {
      // BUG-20260819-01: success-with-notice, never a silent overwrite and never a brick.
      console.log('[release-producer] record already exists at ' + res.file + ' — NOT overwritten ' +
        '(an existing record is better evidence than a regeneration; pass --force to overwrite ' +
        'deliberately). The existing record stands.');
      return 0;
    }
    console.log('[release-producer] wrote ' + res.file + ' (' + res.counts.stories + ' stories, ' +
      res.counts.bugs + ' bugs, ' + res.counts.adrs + ' decisions in window)' +
      (res.window && res.window.derivedFrom
        ? ' — window derived: since ' + res.window.since + ' from ' + res.window.derivedFrom
        : ''));
    return 0;
  } catch (e) {
    console.error('[release-producer] FAILED: ' + (e && e.message ? e.message : String(e)));
    return 1;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  parseArgs, templateHeadings, sliceSections, ledeOf, idsIn, subsection, migrationOf,
  scanWindow, renderRelease, releaseType, titleFromLede, main,
};
