#!/usr/bin/env node
/**
 * batch-check.js — disjoint-file batch-safety static check (STORY-17.1.02)
 *
 * Enforces the disjoint-file precondition from ADR-0075: a set of stories is safe
 * to fan out in parallel ONLY if no two stories' `files_touched:` sets overlap.
 *
 * Usage:
 *   node _00-Project-Management/93-Scripts/batch-check.js STORY-17.1.03 STORY-17.1.04
 *   npm run pm:batch-check -- STORY-17.1.03 STORY-17.1.04
 *
 * Verdict / exit codes:
 *   0  SAFE      — every pair of stories is provably file-disjoint.
 *   1  NOT SAFE  — at least one CONFLICT (shared file) OR at least one UNKNOWN
 *                  (cannot prove disjoint). UNKNOWN is never silently passed (AC-3).
 *   2  USAGE     — no story IDs given, a malformed ID, or an ID that did not resolve.
 *
 * Overlap rules (ADR-0075), on canonicalised, case-folded paths:
 *   - file × file      → CONFLICT iff equal.
 *   - file × directory → CONFLICT iff the file is under the directory subtree; else disjoint (provable).
 *   - directory × directory → CONFLICT iff equal/nested; else UNKNOWN (cannot prove file-level disjoint).
 *   - empty / absent files_touched → UNKNOWN (conservative).
 *
 * Classification is lexical (NOT disk-based): a `files_touched:` entry frequently names a
 * file the story will *create*, so it may not exist yet. An entry is a directory-granularity
 * entry if it ends in `/` OR its basename has no extension (e.g. `40-Decisions`, `93-Scripts`);
 * an un-classifiable entry is therefore treated as a directory (conservative), never silently
 * as a unique file — closing the "directory typed without a trailing slash" false-SAFE hole.
 *
 * Dependency-free (Node stdlib only). Reuses lib/frontmatter.js (parser) and
 * lib/pm-paths.js (layout resolver) so it works on full/flattened/custom layouts.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { parseFrontmatter } = require('./lib/frontmatter');
const { loadPaths } = require('./lib/pm-paths');

const PM_ROOT = path.resolve(__dirname, '..');
const PATHS = loadPaths(PM_ROOT).map;
const STORIES_DIR = path.join(PM_ROOT, PATHS.stories);

// ---------- path canonicalisation ----------

// Collapse `.` / `..` / empty segments without touching the filesystem and without
// `path.normalize` (which would emit `\` on win32). Repo-relative output, OS-agnostic.
function collapseSegments(s) {
  const out = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

// Canonical display form: trim, backslashes → '/', strip a leading '/', collapse
// './' and '../' segments. Trailing-slash intent (directory marker) is preserved.
function norm(p) {
  const raw = String(p).trim().replace(/\\/g, '/');
  const hadTrailing = raw.endsWith('/');
  let s = collapseSegments(raw.replace(/^\/+/, ''));
  if (hadTrailing && s !== '') s += '/';
  return s;
}

// Classify + build the comparison form. `kind` is 'dir' for a directory-granularity
// entry (trailing slash OR extension-less basename), else 'file'. `cf` is the
// case-folded comparison key (dirs always carry a trailing slash); `raw` is the
// original-case display form (dirs shown with their trailing slash).
function entryOf(p) {
  const n = norm(p);
  const base = n.replace(/\/+$/, '').split('/').pop() || '';
  const kind = (n.endsWith('/') || !base.includes('.')) ? 'dir' : 'file';
  let cf = n.toLowerCase();
  let disp = n;
  if (kind === 'dir' && !cf.endsWith('/')) { cf += '/'; disp += '/'; }
  return { raw: disp, cf, kind };
}

// Is the file (case-folded) under the directory (case-folded, trailing-slashed)?
function fileUnderDir(fileCf, dirCf) {
  return fileCf === dirCf.slice(0, -1) || fileCf.startsWith(dirCf);
}

// ---------- story index ----------

function walk(dir, list = []) {
  if (!fs.existsSync(dir)) return list;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, list);
    else if (entry.isFile() && entry.name.endsWith('.md')) list.push(full);
  }
  return list;
}

// Build id → { id, file, entries: [{raw,cf,kind}], rawCount }.
function indexStories() {
  const byId = {};
  for (const f of walk(STORIES_DIR)) {
    const fm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    if (!fm || !fm.id || fm.type !== 'story') continue;
    let files = fm.files_touched;
    if (!Array.isArray(files)) files = files ? [files] : []; // '' or scalar → []/[scalar]
    files = files.map(s => String(s).trim()).filter(Boolean);
    byId[fm.id] = { id: fm.id, file: f, entries: files.map(entryOf), rawCount: files.length };
  }
  return byId;
}

// Compare two stories' entry sets → { conflicts:[displayPath], unknowns:[reason] }.
function comparePair(a, b) {
  const conflicts = [];
  const unknowns = [];
  for (const ea of a.entries) {
    for (const eb of b.entries) {
      if (ea.kind === 'file' && eb.kind === 'file') {
        if (ea.cf === eb.cf) conflicts.push(ea.raw);
      } else if (ea.kind === 'dir' && eb.kind === 'file') {
        if (fileUnderDir(eb.cf, ea.cf)) conflicts.push(eb.raw);
      } else if (ea.kind === 'file' && eb.kind === 'dir') {
        if (fileUnderDir(ea.cf, eb.cf)) conflicts.push(ea.raw);
      } else {
        // dir × dir
        if (ea.cf === eb.cf || ea.cf.startsWith(eb.cf) || eb.cf.startsWith(ea.cf)) {
          conflicts.push(ea.cf.length >= eb.cf.length ? ea.raw : eb.raw);
        } else {
          unknowns.push(`'${ea.raw}' vs '${eb.raw}' (both directory-granularity — cannot prove file-level disjoint)`);
        }
      }
    }
  }
  return { conflicts, unknowns };
}

// ---------- main ----------

function main(argv) {
  const tokens = argv.filter(a => !a.startsWith('-'));
  if (tokens.length < 1) {
    console.error('✗ batch-check: give at least one story ID, e.g. `node batch-check.js STORY-17.1.03 STORY-17.1.04`');
    return 2;
  }

  // Normalise to STORY-* form, validate shape, de-duplicate (a repeated ID is a usage
  // slip, not a file conflict — dropping it avoids a bogus self-conflict).
  const seen = new Set();
  const wanted = [];
  for (const t of tokens) {
    const id = t.startsWith('STORY-') ? t : `STORY-${t}`;
    if (!/^STORY-\d/.test(id)) {
      console.error(`✗ batch-check: '${t}' is not a story ID (expected STORY-NN.M.PP)`);
      return 2;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    wanted.push(id);
  }

  const byId = indexStories();
  const stories = [];
  const unresolved = [];
  for (const id of wanted) {
    if (byId[id]) stories.push(byId[id]);
    else unresolved.push(id);
  }
  if (unresolved.length) {
    console.error(`✗ batch-check: could not resolve to a story file: ${unresolved.join(', ')}`);
    return 2;
  }

  const conflictMsgs = [];
  const unknownMsgs = [];

  // Empty/absent files_touched → the whole story is unprovable-disjoint (AC-3).
  for (const s of stories) {
    if (s.rawCount === 0) {
      unknownMsgs.push(`UNKNOWN — cannot prove disjoint: ${s.id} declares no files_touched`);
    }
  }

  // Pairwise comparison across all story pairs.
  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      const { conflicts, unknowns } = comparePair(stories[i], stories[j]);
      for (const p of conflicts) {
        conflictMsgs.push(`CONFLICT: ${stories[i].id} ↔ ${stories[j].id} share '${p}'`);
      }
      for (const u of unknowns) {
        unknownMsgs.push(`UNKNOWN — cannot prove disjoint: ${stories[i].id} ↔ ${stories[j].id} — ${u}`);
      }
    }
  }

  const batch = stories.map(s => s.id).join(', ');

  if (conflictMsgs.length) {
    console.error(`✗ batch NOT SAFE to fan out — ${conflictMsgs.length} file conflict(s):`);
    conflictMsgs.forEach(m => console.error('  ' + m));
    unknownMsgs.forEach(m => console.error('  ' + m));
    console.error(`Batch: ${batch}. Run these serially (execute-batch), not in parallel.`);
    return 1;
  }
  if (unknownMsgs.length) {
    console.error('✗ batch UNKNOWN — cannot prove file-disjoint (treating conservatively, not passing):');
    unknownMsgs.forEach(m => console.error('  ' + m));
    console.error(`Batch: ${batch}. Declare file-level files_touched: or run serially.`);
    return 1;
  }

  console.log(`✓ SAFE batch — file-disjoint, safe to fan out in parallel: ${batch}`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, comparePair, norm, entryOf, fileUnderDir, collapseSegments };
