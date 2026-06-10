'use strict';

/**
 * dashboard-css.js -- CSS for the enhanced dev dashboard generator.
 *
 * Extracted verbatim from generate-dashboard.js (STORY-15.3.03) so that the
 * CSS rules and the renderer arrays live in SEPARATE source files. This makes
 * the recurring anchor-collision bug family structurally impossible: a
 * class-name token (e.g. .tile-grid) no longer appears both as a CSS selector
 * and in a renderer within the same file, so static-analysis testplans that
 * anchor on a class name resolve to the builder unambiguously. Realises
 * ADR-0060's deferred alternative 2 (see ADR-0071).
 *
 * Root-only: the scaffold ships a lean portable generator with its own inline
 * CSS, so this module has no scaffold mirror (see check-mirror.js ALLOW).
 */

module.exports = `
:root {
  /* Foundation */
  --cream:#F5F0E8; --cream-2:#EBE5D8;
  --surface:#FAF8F4; --surface-2:#F1ECE3;
  --ink:#1A1714; --ink-2:#3D3831; --ink-3:#6B6358; --ink-faint:#9E9589;
  --border:#DDD6C8; --line:#DDD6C8;

  /* Brand accents */
  --red:#D63031; --red-soft:#F8E0E0;
  --yellow:#F0B429; --yellow-soft:#FAE9C0;
  --blue:#2D6CDF; --blue-soft:#DCE7F8;
  --teal:#0D9488; --teal-soft:#CFEAE6;

  /* Semantic */
  --olive:var(--red);
  --success:var(--teal); --success-soft:var(--teal-soft);
  --warn:var(--yellow); --warn-soft:var(--yellow-soft);
  --danger:var(--red); --danger-soft:var(--red-soft);
  --info:var(--blue); --info-soft:var(--blue-soft);

  /* Shape */
  --r:12px; --r-sm:10px; --r-lg:16px; --r-pill:100px;

  /* Shadow */
  --shadow-sm:0 1px 2px rgba(26,23,20,0.06);
  --shadow:0 4px 14px rgba(26,23,20,0.08);
  --shadow-lg:0 18px 40px rgba(26,23,20,0.16);

  /* Type */
  --serif:'Instrument Serif', Georgia, 'Times New Roman', serif;
  --sans:'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
  --mono:'JetBrains Mono', Consolas, ui-monospace, monospace;

  /* Motion */
  --ease:cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast:160ms;
  --dur:320ms;
  --dur-slow:520ms;

  /* Focus */
  --focus-ring:rgba(214,48,49,0.45);

  /* Scrollbar */
  --sb-thumb:#CFC6B7;

  /* Always-light token for dark-surface code blocks */
  --code-fg:#F5F0E8;
}

html[data-theme="dark"] {
  --cream:#15120F; --cream-2:#1C1814;
  --surface:#1A1612; --surface-2:#221D17;
  --ink:#F1ECE3; --ink-2:#D8CFC0; --ink-3:#9E9589; --ink-faint:#6B6358;
  --border:#312A22; --line:#312A22;
  --red:#E25558; --red-soft:rgba(226,85,88,0.16);
  --yellow:#F2C24A; --yellow-soft:rgba(242,194,74,0.16);
  --blue:#5B8DE8; --blue-soft:rgba(91,141,232,0.18);
  --teal:#2BB3A6; --teal-soft:rgba(43,179,166,0.18);
  --shadow-sm:0 1px 2px rgba(0,0,0,0.35);
  --shadow:0 6px 18px rgba(0,0,0,0.45);
  --shadow-lg:0 26px 50px rgba(0,0,0,0.55);
  --focus-ring:rgba(226,85,88,0.5);
  --sb-thumb:#2E2820;
}

* { box-sizing:border-box; margin:0; padding:0; }
html { scroll-behavior:smooth; }
body { font-family:var(--sans); color:var(--ink); background:var(--cream); line-height:1.55; font-size:14.5px; -webkit-font-smoothing:antialiased; transition:background var(--dur) var(--ease), color var(--dur) var(--ease); }

::selection { background:var(--yellow); color:var(--ink); }
:focus-visible { outline:none; box-shadow:0 0 0 3px var(--focus-ring); border-radius:var(--r-sm); }

/* Scrollbar */
* { scrollbar-width:thin; scrollbar-color:var(--sb-thumb) transparent; }
*::-webkit-scrollbar { width:10px; height:10px; }
*::-webkit-scrollbar-track { background:transparent; }
*::-webkit-scrollbar-thumb { background:var(--sb-thumb); border-radius:var(--r-pill); }
*::-webkit-scrollbar-button { display:none; }
.nohscroll::-webkit-scrollbar { display:none; }
.nohscroll { scrollbar-width:none; -ms-overflow-style:none; }

/* Skip link */
.skip { position:absolute; left:-9999px; top:0; background:var(--ink); color:var(--cream); padding:0.5rem 0.85rem; border-radius:var(--r-sm); z-index:100; }
.skip:focus { left:1rem; top:1rem; }

/* Header */
header.app-header { background:var(--surface); border-bottom:1px solid var(--border); padding:1.5rem 0 1.25rem; position:relative; z-index:50; }
.app-header-inner { max-width:1500px; margin:0 auto; padding:0 1.75rem; display:flex; align-items:center; justify-content:space-between; gap:1.5rem; flex-wrap:wrap; }
.brand-wrap { display:flex; align-items:center; gap:0.85rem; }
.brand-mark { display:flex; align-items:center; }
.brand-logo { width:38px; height:38px; display:block; }
.app-title { font-family:var(--serif); font-size:2.05rem; font-weight:400; line-height:1; letter-spacing:-0.01em; color:var(--ink); }
.app-title em { color:var(--red); font-style:italic; }
.app-sub { display:block; font-family:var(--sans); font-size:0.72rem; font-weight:600; color:var(--blue); margin-top:0.3rem; letter-spacing:0.14em; }
.app-tools { display:flex; align-items:center; gap:0.75rem; }
.icon-btn { background:transparent; border:1px solid var(--border); color:var(--ink-2); width:38px; height:38px; border-radius:50%; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:all var(--dur-fast) var(--ease); }
.icon-btn:hover { background:var(--surface-2); color:var(--ink); border-color:var(--ink-faint); }
.icon-btn svg { width:18px; height:18px; }
.app-meta { font-size:0.7rem; color:var(--ink-3); font-family:var(--mono); }

/* Diagnostics banner */
.diag { max-width:1500px; margin:0 auto; padding:0.65rem 1.75rem; }
.diag-inner { background:var(--red-soft); border:1px solid var(--red); border-radius:var(--r); padding:0.75rem 1rem; color:var(--ink); font-size:0.85rem; display:flex; gap:0.85rem; align-items:flex-start; }
.diag-inner strong { color:var(--red); }
.diag-inner ul { margin:0.35rem 0 0 1.1rem; padding:0; }
.diag-inner code { font-family:var(--mono); font-size:0.78rem; }

/* Two-row navigation */
nav.group-nav { background:var(--cream); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:40; }
.group-inner { max-width:1500px; margin:0 auto; padding:0 1.75rem; display:flex; gap:0; overflow-x:auto; }
.gtab { background:transparent; border:none; padding:1.05rem 1.25rem 0.95rem; cursor:pointer; font-family:var(--sans); font-size:0.95rem; color:var(--ink-2); border-bottom:2px solid transparent; white-space:nowrap; font-weight:500; transition:color var(--dur-fast) var(--ease), border-color var(--dur) var(--ease); position:relative; }
.gtab:hover { color:var(--ink); }
.gtab.active { color:var(--red); border-bottom-color:var(--red); }
.gtab-count { display:inline-block; background:var(--surface-2); color:var(--ink-2); font-size:0.66rem; padding:0.08rem 0.45rem; border-radius:var(--r-pill); margin-left:0.4rem; font-family:var(--mono); font-weight:500; vertical-align:1px; }
.gtab.active .gtab-count { background:var(--red); color:#fff; }

nav.sub-nav { background:var(--surface); border-bottom:1px solid var(--border); }
.sub-inner { max-width:1500px; margin:0 auto; padding:0 1.75rem; display:flex; gap:0; overflow-x:auto; align-items:center; min-height:42px; }
.stab { background:transparent; border:none; padding:0.55rem 1rem; cursor:pointer; font-family:var(--sans); font-size:0.82rem; color:var(--ink-3); white-space:nowrap; font-weight:500; transition:color var(--dur-fast) var(--ease); border-bottom:2px solid transparent; }
.stab:hover { color:var(--ink); }
.stab.active { color:var(--ink); border-bottom-color:var(--ink); }
.stab-count { display:inline-block; font-size:0.65rem; padding:0 0.4rem; color:var(--ink-faint); font-family:var(--mono); margin-left:0.25rem; }
.sub-inner:empty { display:none; }
nav.sub-nav:has(.sub-inner:empty), nav.sub-nav.hidden { display:none; }

/* Main */
main { max-width:1500px; margin:0 auto; padding:1.5rem 1.75rem 4rem; }
section.tab-section { display:none; }
section.tab-section.active { display:block; }

.controls { display:flex; gap:0.75rem; margin-bottom:1.25rem; align-items:center; flex-wrap:wrap; padding:0.85rem 1rem; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); }
.search { flex:1; min-width:220px; padding:0.55rem 0.9rem; border:1px solid var(--border); border-radius:var(--r-sm); background:var(--cream); font-family:var(--sans); font-size:0.9rem; color:var(--ink); transition:all var(--dur-fast) var(--ease); }
.search:focus { outline:none; border-color:var(--red); background:var(--surface); }
.filter-group { display:flex; gap:0.35rem; flex-wrap:wrap; align-items:center; }
.filter-label { font-size:0.66rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); margin-right:0.25rem; font-weight:600; }

/* Pills */
.pill { display:inline-block; padding:0.18rem 0.65rem; border-radius:var(--r-pill); font-size:0.7rem; font-family:var(--mono); font-weight:500; letter-spacing:0.02em; white-space:nowrap; user-select:none; line-height:1.55; }
.pill.filterable { cursor:pointer; transition:all var(--dur-fast) var(--ease); }
.pill.filterable.off { opacity:0.32; }
.pill.filterable:hover { transform:translateY(-1px); }
.pill[data-status="not-started"] { background:var(--surface-2); color:var(--ink-2); }
.pill[data-status="ready"]       { background:var(--info-soft);    color:var(--info); }
.pill[data-status="in-progress"] { background:var(--warn-soft);    color:var(--ink); border:1px solid var(--yellow); }
.pill[data-status="in-review"]   { background:var(--blue-soft);    color:var(--blue); }
.pill[data-status="done"]        { background:var(--success-soft); color:var(--success); }
.pill[data-status="blocked"]     { background:var(--danger-soft);  color:var(--red); border:1px solid var(--red); }
.pill[data-status="active"]      { background:var(--success-soft); color:var(--success); }
.pill[data-status="wontfix"]     { background:var(--surface-2);    color:var(--ink-faint); text-decoration:line-through; }
.pill[data-status="duplicate"]   { background:var(--surface-2);    color:var(--ink-faint); }
.pill[data-status="archived"]    { background:var(--surface-2);    color:var(--ink-faint); opacity:0.7; }

.sev { display:inline-block; padding:0.1rem 0.55rem; border-radius:var(--r-sm); font-size:0.68rem; font-family:var(--mono); font-weight:600; letter-spacing:0.04em; text-transform:uppercase; }
.sev.critical { background:var(--red); color:#fff; }
.sev.high     { background:var(--red-soft); color:var(--red); border:1px solid var(--red); }
.sev.medium   { background:var(--yellow-soft); color:var(--ink); border:1px solid var(--yellow); }
.sev.low      { background:var(--surface-2); color:var(--ink-2); }

.tag { display:inline-block; padding:0.1rem 0.55rem; border-radius:var(--r-pill); font-size:0.66rem; font-family:var(--mono); background:var(--surface-2); color:var(--ink-2); white-space:nowrap; }
.tag.star { background:var(--yellow-soft); color:#7a5a00; border:1px solid var(--yellow); }
.tag.must { background:var(--red); color:#fff; }
.tag.source { background:transparent; border:1px solid var(--border); color:var(--ink-3); }
.tag.cat.exclusive { cursor:pointer; transition:all var(--dur-fast) var(--ease); }
.tag.cat.exclusive:hover { background:var(--ink); color:var(--cream); }
.tag.cat.exclusive.active { background:var(--ink); color:var(--cream); }

/* Cards */
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1.2rem 1.3rem; box-shadow:var(--shadow-sm); transition:box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease), border-color var(--dur) var(--ease); }
.card.hover { cursor:pointer; }
.card.hover:hover { box-shadow:var(--shadow); transform:translateY(-1px); border-color:var(--ink-faint); }

.card-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:1rem; }
.card-grid.tight { grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); }

/* Tile grid (shared compact tile layout — ~2–3 across) */
.tile-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:0.7rem; }
.tile { display:flex; flex-direction:column; gap:0.4rem; padding:0.85rem 1rem; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-sm); cursor:pointer; transition:all var(--dur-fast) var(--ease); }
.tile:hover { border-color:var(--ink-faint); background:var(--surface-2); transform:translateY(-1px); box-shadow:var(--shadow-sm); }
.tile:has(.pill[data-status="blocked"]) { border-color:var(--red); }
.tile:has(.pill[data-status="blocked"]):hover { border-color:var(--red); }
.tile-head { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
.tile-id { font-family:var(--mono); font-size:0.76rem; color:var(--ink-2); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tile-extra { display:flex; gap:0.35rem; align-items:center; flex-shrink:0; }
.tile-title { font-size:0.92rem; color:var(--ink); font-weight:500; line-height:1.3; }
.tile-title .meta { display:block; color:var(--ink-3); font-size:0.76rem; font-weight:400; margin-top:0.2rem; }
.tile .tp-link { font-family:var(--mono); font-size:0.7rem; color:var(--blue); }
@media (max-width:560px) { .tile-grid { grid-template-columns:1fr; } }
/* Implementation view: fixed 3-up, wider chat cards (user request — was auto-fill minmax(320px)). */
.impl-tiles { grid-template-columns:repeat(3, minmax(0, 1fr)); }
@media (max-width:1100px) { .impl-tiles { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
@media (max-width:680px)  { .impl-tiles { grid-template-columns:1fr; } }
/* Plan view: wider story tiles inside an expanded feature (user request — was minmax(320px)). */
.plan-stories { grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); }
/* Work view hierarchical grouping (STORY-04.6.01): nested Epic→Feature→Story→(Testplan/Bug) section headers above each tile-grid */
.work-group { margin-bottom:1.1rem; }
.work-group .group-head { display:flex; align-items:baseline; gap:0.5rem; flex-wrap:wrap; padding:0.35rem 0 0.5rem; border-bottom:1px solid var(--border); margin-bottom:0.65rem; }
.work-group .group-path { font-family:var(--mono); font-size:0.78rem; color:var(--ink-2); }
.work-group .group-path .crumb-sep { color:var(--ink-faint); margin:0 0.15rem; }
.work-group .group-path .crumb-unassigned { color:var(--ink-3); font-style:italic; }
.work-group .group-count { font-family:var(--mono); font-size:0.72rem; color:var(--ink-3); }
.metric { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1.1rem 1.2rem; box-shadow:var(--shadow-sm); }
.metric-val { font-family:var(--serif); font-size:2.4rem; font-weight:400; color:var(--ink); line-height:1; letter-spacing:-0.02em; }
.metric-lab { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.14em; color:var(--ink-faint); margin-top:0.5rem; font-weight:600; }
.metric-sub { font-size:0.78rem; color:var(--ink-3); margin-top:0.45rem; font-family:var(--mono); }

.progress { height:6px; background:var(--surface-2); border-radius:var(--r-pill); overflow:hidden; margin-top:0.6rem; }
.progress > span { display:block; height:100%; background:linear-gradient(90deg, var(--teal), var(--blue)); border-radius:var(--r-pill); transition:width var(--dur-slow) var(--ease); }
.progress.danger > span { background:linear-gradient(90deg, var(--red), var(--yellow)); }

/* Plan tree */
.plan-toolbar { display:flex; gap:0.5rem; margin-bottom:1rem; }
.plan-toolbar button { background:transparent; border:1px solid var(--border); color:var(--ink-2); padding:0.45rem 0.85rem; border-radius:var(--r-pill); font-size:0.78rem; font-family:var(--sans); cursor:pointer; transition:all var(--dur-fast) var(--ease); }
.plan-toolbar button:hover { background:var(--surface-2); border-color:var(--ink-faint); }
.epic-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); margin-bottom:0.85rem; overflow:hidden; transition:box-shadow var(--dur) var(--ease); }
.epic-card.open { box-shadow:var(--shadow); }
.epic-head { display:grid; grid-template-columns:36px minmax(92px,116px) minmax(0,1fr) 336px minmax(0,auto); gap:0.85rem; padding:1rem 1.2rem; cursor:pointer; align-items:center; user-select:none; }
.epic-head:hover { background:var(--surface-2); }
.disclose { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; color:var(--ink-3); transition:transform var(--dur) var(--ease); }
.epic-card.open .disclose { transform:rotate(90deg); }
.epic-id { font-family:var(--mono); font-size:0.85rem; color:var(--ink-2); }
.epic-title { font-family:var(--serif); font-size:1.25rem; color:var(--ink); font-weight:400; letter-spacing:-0.01em; }
.epic-badges { display:flex; gap:0.35rem; align-items:center; min-width:0; overflow:hidden; }
.epic-badges .tag { max-width:200px; overflow:hidden; text-overflow:ellipsis; }
.epic-progress { display:flex; align-items:center; gap:0.7rem; min-width:0; }
.epic-progress .progress { flex:1; margin-top:0; height:9px; }
.epic-progress .ratio { font-family:var(--mono); font-size:0.74rem; color:var(--ink-3); white-space:nowrap; flex-shrink:0; }
.epic-body { display:none; padding:0.4rem 1.2rem 1.2rem; border-top:1px solid var(--border); }
.epic-card.open .epic-body { display:block; }
.feat-card { background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-sm); margin:0.65rem 0; }
.feat-head { display:grid; grid-template-columns:24px 130px 1fr auto; gap:0.65rem; padding:0.65rem 0.85rem; cursor:pointer; align-items:center; }
.feat-head:hover { background:var(--cream-2); }
.feat-id { font-family:var(--mono); font-size:0.78rem; color:var(--ink-2); }
.feat-title { font-size:0.95rem; color:var(--ink); font-weight:500; }
.feat-body { display:none; padding:0.2rem 0.85rem 0.85rem; }
.feat-card.open .feat-body { display:block; }
.feat-card.open .disclose { transform:rotate(90deg); }
.empty { color:var(--ink-faint); font-size:0.85rem; padding:0.5rem 0; font-style:italic; }
.view-intro { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:0.9rem 1.1rem; margin-bottom:1.1rem; }
/* vi-* (not view-intro__*): TESTPLAN-11.2.02 TC-03 splits source on "view-intro" — keep prefix non-overlapping */
.view-intro .vi-title { font-family:var(--serif); font-size:1.05rem; font-weight:500; color:var(--ink); margin-bottom:0.4rem; letter-spacing:-0.01em; }
.view-intro .vi-source { font-size:0.82rem; color:var(--ink-2); line-height:1.55; margin-bottom:0.25rem; }
.view-intro .vi-source code { font-family:var(--mono); font-size:0.78rem; color:var(--ink); background:var(--surface-2); padding:0.05rem 0.3rem; border-radius:var(--r-sm); }
.view-intro .vi-why { font-size:0.82rem; color:var(--ink-3); line-height:1.55; font-style:italic; }

/* Overview */
.overview-hero { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:1rem; margin-bottom:1.5rem; }
.overview-panels { display:grid; grid-template-columns:1.4fr 1fr; gap:1rem; margin-bottom:1.5rem; }
@media (max-width:920px) { .overview-panels { grid-template-columns:1fr; } }
.panel { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1.15rem 1.25rem; }
.panel h3 { font-family:var(--serif); font-size:1.3rem; font-weight:400; margin-bottom:0.85rem; color:var(--ink); letter-spacing:-0.01em; }
.panel h3 .count-bubble { font-family:var(--mono); font-size:0.72rem; background:var(--surface-2); color:var(--ink-3); padding:0.1rem 0.55rem; border-radius:var(--r-pill); margin-left:0.5rem; vertical-align:2px; }
.kv { display:grid; grid-template-columns:auto 1fr; gap:0.3rem 0.85rem; font-size:0.86rem; color:var(--ink-2); }
.kv dt { color:var(--ink-faint); font-size:0.74rem; text-transform:uppercase; letter-spacing:0.1em; font-weight:600; align-self:center; }
.kv dd { font-family:var(--mono); color:var(--ink); }

/* AI Catalogue cards */
.ai-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1rem 1.1rem; cursor:pointer; transition:all var(--dur-fast) var(--ease); display:flex; flex-direction:column; gap:0.55rem; }
.ai-card:hover { border-color:var(--ink-faint); box-shadow:var(--shadow); transform:translateY(-2px); }
.ai-card .name { font-family:var(--serif); font-size:1.15rem; color:var(--ink); letter-spacing:-0.01em; line-height:1.2; }
.ai-card .desc { font-size:0.82rem; color:var(--ink-2); line-height:1.5; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.ai-card .footer { display:flex; gap:0.35rem; flex-wrap:wrap; align-items:center; margin-top:auto; }
.ai-card.curated { border-color:var(--yellow); }

/* Fit badges (ADR-0029 relevance overlays — HIGH/MED/LOW) */
.fit-badge { display:inline-block; padding:0.1rem 0.5rem; border-radius:var(--r-sm); font-size:0.66rem; font-family:var(--mono); font-weight:700; letter-spacing:0.06em; text-transform:uppercase; line-height:1.55; }
.fit-badge.HIGH { background:var(--teal-soft); color:var(--teal); border:1px solid var(--teal); }
.fit-badge.MED  { background:var(--blue-soft);  color:var(--blue);  border:1px solid var(--blue); }
.fit-badge.LOW  { background:var(--surface-2);  color:var(--ink-3); border:1px solid var(--border); }
/* AI fit grouping (recommendedVsOther — ADR-0033) */
.ai-fit-group { margin-bottom:1.25rem; }
.ai-fit-group-head { display:flex; align-items:baseline; gap:0.5rem; flex-wrap:wrap; padding:0.3rem 0 0.5rem; border-bottom:1px solid var(--border); margin-bottom:0.75rem; }
.ai-fit-group-label { font-family:var(--mono); font-size:0.78rem; font-weight:600; color:var(--ink-2); text-transform:uppercase; letter-spacing:0.08em; }
.ai-fit-group-count { font-family:var(--mono); font-size:0.72rem; color:var(--ink-3); }

/* Drawer */
.mask { display:none; position:fixed; inset:0; background:rgba(26,23,20,0.5); z-index:80; backdrop-filter:blur(4px); }
.mask.open { display:block; animation:fade var(--dur) var(--ease); }
aside.drawer { position:fixed; top:0; right:0; bottom:0; width:clamp(360px, 60vw, 96vw); background:var(--cream); border-left:1px solid var(--border); box-shadow:var(--shadow-lg); z-index:90; transform:translateX(105%); transition:transform var(--dur) var(--ease); overflow-y:auto; display:flex; flex-direction:column; }
aside.drawer.open { transform:translateX(0); }
.drawer-head { padding:1.25rem 1.5rem 0.95rem; border-bottom:1px solid var(--border); background:var(--surface); position:sticky; top:0; z-index:2; display:flex; gap:1rem; align-items:flex-start; }
.drawer-head .titles { flex:1; min-width:0; }
.drawer-back { background:transparent; border:1px solid var(--border); width:34px; height:34px; border-radius:50%; cursor:pointer; color:var(--ink-2); display:none; align-items:center; justify-content:center; }
.drawer-back.show { display:inline-flex; }
.drawer-close { background:transparent; border:1px solid var(--border); width:34px; height:34px; border-radius:50%; cursor:pointer; color:var(--ink-2); display:inline-flex; align-items:center; justify-content:center; }
.drawer-close:hover, .drawer-back:hover { background:var(--surface-2); }
.drawer-id { font-family:var(--mono); font-size:0.78rem; color:var(--ink-3); }
.drawer-title { font-family:var(--serif); font-size:1.6rem; color:var(--ink); margin-top:0.3rem; font-weight:400; letter-spacing:-0.01em; line-height:1.2; }
.drawer-meta { display:flex; gap:0.4rem; flex-wrap:wrap; margin-top:0.75rem; }
.drawer-body { padding:1.25rem 1.5rem 2.5rem; flex:1; }
.drawer-body h1 { font-family:var(--serif); font-size:1.6rem; margin:1.4rem 0 0.7rem; font-weight:400; letter-spacing:-0.01em; }
.drawer-body h2 { font-family:var(--serif); font-size:1.35rem; margin:1.25rem 0 0.55rem; font-weight:400; }
.drawer-body h3 { font-family:var(--sans); font-size:0.78rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); margin:1.2rem 0 0.45rem; font-weight:600; }
.drawer-body h4 { font-size:0.95rem; margin:0.85rem 0 0.35rem; color:var(--ink); }
.drawer-body p { margin:0.65rem 0; color:var(--ink-2); line-height:1.7; }
.drawer-body ul, .drawer-body ol { margin:0.55rem 0 0.65rem 1.4rem; color:var(--ink-2); }
.drawer-body li { margin:0.25rem 0; line-height:1.65; }
.drawer-body blockquote { border-left:3px solid var(--red); padding:0.5rem 0.9rem; background:var(--surface-2); border-radius:var(--r-sm); margin:0.8rem 0; color:var(--ink-2); font-style:italic; }
.drawer-body code { font-family:var(--mono); font-size:0.85em; background:var(--surface-2); padding:0.1rem 0.35rem; border-radius:4px; }
.drawer-body pre { background:var(--surface-2); padding:0.85rem 1rem; border-radius:var(--r-sm); overflow-x:auto; white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere; font-family:var(--mono); font-size:0.82rem; margin:0.7rem 0; border:1px solid var(--border); }
.drawer-body pre code { background:transparent; padding:0; font-size:inherit; }
.drawer-body a { color:var(--blue); text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; }
.drawer-body a:hover { color:var(--red); }
.drawer-body hr { border:none; border-top:1px solid var(--border); margin:1.2rem 0; }
.drawer-body .md-table-wrap { overflow-x:auto; margin:0.8rem 0; }
.drawer-body table { border-collapse:collapse; width:100%; font-size:0.84rem; }
.drawer-body th, .drawer-body td { padding:0.5rem 0.7rem; border:1px solid var(--border); text-align:left; vertical-align:top; }
.drawer-body th { background:var(--surface-2); font-weight:600; }

.drawer-section { padding:1rem 1.5rem; border-top:1px solid var(--border); background:var(--surface); }
.drawer-section h3 { font-size:0.74rem; text-transform:uppercase; letter-spacing:0.14em; color:var(--ink-faint); margin-bottom:0.55rem; font-weight:600; }
.drawer-overlay { background:var(--yellow-soft); border-left:3px solid var(--yellow); padding:0.95rem 1.2rem; border-radius:var(--r-sm); margin-bottom:1rem; }
.drawer-overlay .label { font-size:0.68rem; text-transform:uppercase; letter-spacing:0.16em; color:#7a5a00; font-weight:700; margin-bottom:0.35rem; }
.xref { display:flex; gap:0.4rem; flex-wrap:wrap; }
.xref-pill { background:transparent; border:1px solid var(--border); padding:0.25rem 0.7rem; border-radius:var(--r-pill); font-family:var(--mono); font-size:0.74rem; color:var(--ink-2); cursor:pointer; text-decoration:none; }
.xref-pill:hover { background:var(--surface-2); border-color:var(--ink-faint); }

/* Drawer AI detail: descriptions, sub-commands, bundles, examples */
.drawer-ai-desc { color:var(--ink-2); line-height:1.7; margin:0.4rem 0 0.9rem; }
.subitems { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:0.6rem; margin:0.5rem 0 1.1rem; }
.subitem { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-sm); padding:0.7rem 0.85rem; cursor:pointer; transition:border-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); display:flex; flex-direction:column; gap:0.3rem; }
.subitem:hover, .subitem:focus-visible { border-color:var(--ink-faint); transform:translateY(-1px); box-shadow:var(--shadow-sm); outline:none; }
.subitem-name { font-family:var(--mono); font-size:0.82rem; font-weight:600; color:var(--ink); word-break:break-word; }
.subitem-title { font-family:var(--sans); font-weight:500; color:var(--ink-3); font-size:0.78rem; }
.subitem-desc { font-size:0.78rem; color:var(--ink-2); line-height:1.5; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
.subitem-cta { font-size:0.68rem; font-weight:600; letter-spacing:0.02em; color:var(--red); margin-top:auto; opacity:0; transition:opacity var(--dur-fast) var(--ease); }
.subitem:hover .subitem-cta, .subitem:focus-visible .subitem-cta { opacity:1; }
.bundle-group { margin:0.4rem 0 1.1rem; }
.bundle-title { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); font-weight:700; margin:0.6rem 0 0.45rem; }
.drawer-example { border:1px solid var(--border); border-radius:var(--r-sm); padding:0.85rem 1rem; margin:0.6rem 0; background:var(--surface); }
.ex-label { font-size:0.64rem; text-transform:uppercase; letter-spacing:0.14em; color:var(--ink-faint); font-weight:700; margin:0.55rem 0 0.2rem; }
.ex-label:first-child { margin-top:0; }
.ex-body { font-size:0.84rem; color:var(--ink-2); line-height:1.6; }
.ex-body.ex-user { font-family:var(--mono); font-size:0.8rem; color:var(--ink); background:var(--surface-2); border-radius:var(--r-sm); padding:0.4rem 0.6rem; }

/* Session flow timeline (SOP plugin drawer) */
.flow { display:grid; grid-template-columns:1fr; gap:0; margin:0.5rem 0 1rem; }
.flow-row { display:grid; grid-template-columns:170px 1fr; gap:1rem; padding:0.6rem 0; border-left:2px solid var(--border); padding-left:1rem; position:relative; }
.flow-row::before { content:''; position:absolute; left:-7px; top:1rem; width:12px; height:12px; border-radius:50%; background:var(--surface); border:2px solid var(--ink-faint); }
.flow-row.skill::before { border-color:var(--blue); background:var(--blue-soft); }
.flow-row.lifecycle::before { border-color:var(--ink); background:var(--ink); }
.flow-label { font-family:var(--mono); font-size:0.78rem; color:var(--ink); font-weight:600; }
.flow-detail { font-size:0.84rem; color:var(--ink-2); line-height:1.55; }
.flow-aside { background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r); padding:0.85rem 1rem; margin-top:0.85rem; }
.flow-aside .head { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.14em; color:var(--ink-faint); font-weight:700; margin-bottom:0.45rem; }

/* Reveal-on-scroll */
@media (prefers-reduced-motion: no-preference) {
  .reveal { opacity:0; transform:translateY(8px); transition:opacity var(--dur-slow) var(--ease), transform var(--dur-slow) var(--ease); }
  .reveal.visible { opacity:1; transform:translateY(0); }
  .stagger > * { opacity:0; transform:translateY(6px); animation:brand-fade-up var(--dur-slow) var(--ease) forwards; }
  .stagger > *:nth-child(1) { animation-delay:0ms; }
  .stagger > *:nth-child(2) { animation-delay:50ms; }
  .stagger > *:nth-child(3) { animation-delay:100ms; }
  .stagger > *:nth-child(4) { animation-delay:150ms; }
  .stagger > *:nth-child(5) { animation-delay:200ms; }
}
@keyframes brand-fade-up { to { opacity:1; transform:translateY(0); } }
@keyframes fade { from { opacity:0; } to { opacity:1; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition:none !important; animation:none !important; }
}

/* About */
.about-grid { display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; }
@media (max-width:760px) { .about-grid { grid-template-columns:1fr; } .epic-head { grid-template-columns:36px 1fr; } .epic-head .epic-progress, .epic-head .epic-badges { display:none; } .feat-head { grid-template-columns:24px 1fr; } }
.about-grid pre { white-space:pre-wrap; word-break:break-word; }
.kbd { font-family:var(--mono); font-size:0.78rem; background:var(--surface-2); padding:0.15rem 0.5rem; border-radius:var(--r-sm); border:1px solid var(--border); }

/* Reports view (STORY-04.6.04) */
.report-kind-group { margin-bottom:1.25rem; }
.report-kind-head { display:flex; align-items:baseline; gap:0.5rem; flex-wrap:wrap; padding:0.35rem 0 0.5rem; border-bottom:1px solid var(--border); margin-bottom:0.65rem; }
.report-kind-label { font-family:var(--mono); font-size:0.78rem; font-weight:600; color:var(--ink-2); text-transform:uppercase; letter-spacing:0.08em; }
.report-kind-count { font-family:var(--mono); font-size:0.72rem; color:var(--ink-3); }
.report-tile { display:flex; flex-direction:column; gap:0.35rem; padding:0.75rem 0.9rem; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-sm); text-decoration:none; color:inherit; transition:all var(--dur-fast) var(--ease); }
.report-tile:hover { border-color:var(--blue); background:var(--surface-2); transform:translateY(-1px); box-shadow:var(--shadow-sm); }
.report-tile:hover .report-name { color:var(--blue); }
.report-name { font-size:0.88rem; color:var(--ink); font-weight:500; line-height:1.3; word-break:break-all; }
.report-ext { font-family:var(--mono); font-size:0.68rem; color:var(--ink-3); text-transform:uppercase; letter-spacing:0.05em; }
.report-open { font-size:0.68rem; font-weight:600; letter-spacing:0.02em; color:var(--blue); margin-top:auto; opacity:0; transition:opacity var(--dur-fast) var(--ease); }
.report-tile:hover .report-open { opacity:1; }

/* Implementation Strategy (FEAT-03.3) */
.impl-head { margin-bottom:1.25rem; }
.impl-epic-title { font-family:var(--serif); font-size:1.5rem; font-weight:400; color:var(--ink); letter-spacing:-0.01em; }
.impl-meta { font-family:var(--mono); font-size:0.76rem; color:var(--ink-3); margin-top:0.3rem; }
.impl-note { font-size:0.82rem; color:var(--ink-2); margin-top:0.55rem; background:var(--surface-2); border-radius:var(--r-sm); padding:0.6rem 0.85rem; }
.impl-phase { margin-bottom:1.75rem; }
.impl-phase-title { font-family:var(--serif); font-size:1.2rem; font-weight:400; color:var(--ink); margin:0 0 0.85rem; letter-spacing:-0.01em; }
.impl-phase-sub { font-size:0.9rem; color:var(--ink-2); margin:-0.55rem 0 0.95rem; line-height:1.5; max-width:62ch; }
.chat-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(440px, 1fr)); gap:1rem; }
.chat-card { background:var(--surface); border:1px solid var(--ink-faint); border-radius:var(--r); padding:1.1rem 1.2rem; display:flex; flex-direction:column; gap:0.6rem; box-shadow:var(--shadow); }
.chat-card.executed { border:1.5px solid var(--blue); }
.chat-card.pending { border:1px solid var(--ink-faint); }
.chat-head { display:flex; align-items:center; gap:0.6rem; }
.chat-id { font-family:var(--mono); font-size:0.72rem; font-weight:600; background:var(--ink); color:var(--surface); padding:0.12rem 0.5rem; border-radius:var(--r-pill); letter-spacing:0.04em; white-space:nowrap; flex-shrink:0; }
.chat-est { font-family:var(--mono); font-size:0.72rem; color:var(--ink-3); margin-left:auto; }
.chat-badge { font-family:var(--mono); font-size:0.64rem; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; padding:0.18rem 0.6rem; border-radius:var(--r-pill); white-space:nowrap; flex-shrink:0; }
.chat-badge.exec { background:var(--blue); color:#fff; }
.chat-badge.exec.exec-derived { background:var(--teal); color:#fff; }
.chat-badge.pend { background:transparent; color:var(--ink-3); border:1px solid var(--border); }
.chat-title { font-family:var(--serif); font-size:1.15rem; font-weight:400; color:var(--ink); letter-spacing:-0.01em; line-height:1.25; }
.chat-stories { display:flex; flex-wrap:wrap; gap:0.3rem; }
.impl-story { font-family:var(--mono); font-size:0.7rem; background:var(--surface-2); color:var(--ink-2); padding:0.1rem 0.45rem; border-radius:var(--r-sm); }
.impl-story.unready { background:var(--warn-soft); color:var(--ink); border:1px solid var(--yellow); }
.impl-story.done { background:var(--success-soft); color:var(--success); border:1px solid var(--teal); }
.impl-story.blocked { background:var(--danger-soft); color:var(--red); border:1px solid var(--red); font-weight:600; }
.chat-line { font-size:0.82rem; color:var(--ink-2); }
.chat-line .lab, .chat-edges .lab, .chat-block .lab { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); font-weight:700; margin-right:0.35rem; }
.impl-agent { font-family:var(--mono); font-size:0.7rem; background:var(--teal-soft); color:var(--teal); padding:0.08rem 0.45rem; border-radius:var(--r-sm); margin-right:0.25rem; }
.chat-block .lab { display:block; margin-bottom:0.3rem; }
.chat-block summary.lab { cursor:pointer; }
.chat-outcome { font-size:0.9rem; color:var(--ink); margin:0.15rem 0 0.5rem; line-height:1.45; }
.chat-outcome .lab { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--teal); font-weight:700; margin-right:0.4rem; }
.drawer-outcome { font-size:0.92rem; color:var(--ink-2); margin:0 0 0.6rem; line-height:1.5; }
.drawer-outcome .lab { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); font-weight:700; margin-right:0.4rem; }
.chat-block pre { background:var(--ink); color:var(--code-fg); padding:0.7rem 0.85rem; border-radius:var(--r-sm); overflow-x:auto; font-family:var(--mono); font-size:0.74rem; line-height:1.6; white-space:pre-wrap; word-break:normal; overflow-wrap:break-word; }
html[data-theme="dark"] .chat-block pre { background:#0d0b09; }
.chat-edges { font-family:var(--mono); font-size:0.72rem; color:var(--ink-3); border-top:1px solid var(--border); padding-top:0.5rem; }

/* v1.1 — ADR-0048 additions: Now-page widgets, age ribbons, Cmd-K palette */
.now-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:1rem; margin-bottom:1.25rem; }
.now-widget { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1.1rem 1.25rem; box-shadow:var(--shadow-sm); }
.now-widget h3 { font-family:var(--sans); font-size:0.74rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); margin-bottom:0.7rem; font-weight:600; display:flex; align-items:baseline; gap:0.5rem; }
.now-widget h3 .count-bubble { background:var(--surface-2); color:var(--ink-2); font-family:var(--mono); font-size:0.66rem; font-weight:700; padding:0.08rem 0.45rem; border-radius:var(--r-pill); }
.now-widget.has-pending h3 .count-bubble { background:var(--red); color:#fff; }
.now-widget .empty { font-size:0.82rem; color:var(--ink-3); font-style:italic; padding:0.3rem 0; }

/* Story lifecycle flow (Now hero — live counts + clickable stages) */
.flow-panel { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1.1rem 1.25rem; box-shadow:var(--shadow-sm); margin-bottom:1.5rem; }
.flow-panel > h3 { font-family:var(--sans); font-size:0.74rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); margin-bottom:0.75rem; font-weight:600; display:flex; align-items:baseline; gap:0.55rem; flex-wrap:wrap; }
.flow-panel > h3 .flow-variant-tag { font-family:var(--mono); font-size:0.62rem; color:var(--ink-3); background:var(--surface-2); padding:0.1rem 0.5rem; border-radius:var(--r-pill); text-transform:none; letter-spacing:0.02em; font-weight:500; }
.flow-row { display:flex; align-items:stretch; gap:0; flex-wrap:wrap; }
.flow-stage { flex:1 1 0; min-width:88px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0.22rem; padding:0.65rem 0.55rem; background:var(--cream); border:1px solid var(--border); border-radius:var(--r-sm); text-align:center; transition:background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease); }
.flow-stage.click { cursor:pointer; }
.flow-stage.click:hover { background:var(--surface-2); border-color:var(--ink-faint); transform:translateY(-1px); box-shadow:var(--shadow-sm); }
.flow-stage-count { font-family:var(--mono); font-size:1.4rem; font-weight:600; color:var(--ink); line-height:1; }
.flow-stage-label { font-family:var(--sans); font-size:0.74rem; color:var(--ink-2); font-weight:500; }
.flow-stage[data-stage="done"] { background:var(--success-soft); border-color:var(--teal); }
.flow-stage[data-stage="done"] .flow-stage-count { color:var(--teal); }
.flow-stage[data-stage="in-progress"] { border-color:var(--yellow); }
.flow-stage[data-stage="in-review"] { border-color:var(--blue); }
.flow-arrow { display:flex; align-items:center; justify-content:center; padding:0 0.35rem; color:var(--ink-faint); font-family:var(--mono); font-size:1rem; flex:0 0 auto; align-self:stretch; }
.flow-arrow.with-gate { flex-direction:column; gap:0.18rem; padding:0 0.45rem; }
.flow-gate-label { font-family:var(--mono); font-size:0.6rem; color:var(--red); background:var(--red-soft); padding:0.05rem 0.4rem; border-radius:var(--r-pill); letter-spacing:0.04em; font-weight:600; line-height:1.4; }
.flow-loop { margin-top:0.55rem; padding:0.5rem 0.75rem; background:var(--surface-2); border-left:3px solid var(--red); border-radius:var(--r-sm); font-family:var(--sans); font-size:0.78rem; color:var(--ink-2); display:flex; align-items:center; gap:0.55rem; }
.flow-loop-glyph { font-family:var(--mono); color:var(--red); font-weight:600; flex-shrink:0; }
@media (max-width:720px) {
  .flow-row { flex-direction:column; }
  .flow-arrow { transform:rotate(90deg); padding:0.25rem 0; }
}

/* Command process flow (Toolkit → Plugin · Tandem) */
.cmd-flow-panel { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:1.15rem 1.3rem; box-shadow:var(--shadow-sm); margin-bottom:1.5rem; }
.cmd-flow-head { display:flex; align-items:baseline; gap:0.6rem; margin-bottom:0.9rem; flex-wrap:wrap; }
.cmd-flow-title { font-family:var(--sans); font-size:0.74rem; text-transform:uppercase; letter-spacing:0.12em; color:var(--ink-faint); font-weight:600; }
.cmd-flow-sub { font-family:var(--sans); font-size:0.78rem; color:var(--ink-3); font-weight:400; margin-left:auto; }
.cmd-flow-phases { display:flex; align-items:stretch; gap:0; overflow-x:auto; padding:0.25rem 0 0.75rem; }
.cmd-phase { flex:1 1 0; min-width:175px; display:flex; flex-direction:column; gap:0.55rem; padding:0.85rem 0.85rem 0.95rem; background:var(--cream); border:1px solid var(--border); border-radius:var(--r-sm); }
.cmd-phase-head { display:flex; flex-direction:column; gap:0.2rem; padding-bottom:0.45rem; border-bottom:1px dashed var(--border); }
.cmd-phase-top { display:flex; align-items:baseline; gap:0.4rem; flex-wrap:wrap; }
.cmd-phase-label { font-family:var(--sans); font-size:0.92rem; color:var(--ink); font-weight:600; }
.cmd-phase-hat { font-family:var(--mono); font-size:0.6rem; color:var(--ink-3); background:var(--surface-2); padding:0.05rem 0.4rem; border-radius:var(--r-pill); letter-spacing:0.04em; text-transform:uppercase; font-weight:500; }
.cmd-phase-gate { font-family:var(--mono); font-size:0.62rem; color:var(--red); background:var(--red-soft); padding:0.05rem 0.4rem; border-radius:var(--r-pill); letter-spacing:0.04em; font-weight:600; margin-left:auto; }
.cmd-phase-desc { font-family:var(--sans); font-size:0.74rem; color:var(--ink-3); line-height:1.5; }
.cmd-phase-pills { display:flex; flex-direction:column; gap:0.35rem; }
.cmd-pill { display:flex; flex-direction:column; align-items:flex-start; gap:0.2rem; padding:0.5rem 0.7rem; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-sm); cursor:pointer; transition:all var(--dur-fast) var(--ease); text-align:left; min-width:0; font-family:inherit; }
.cmd-pill:hover { background:var(--surface-2); border-color:var(--ink-faint); transform:translateY(-1px); box-shadow:var(--shadow-sm); }
.cmd-pill-name { font-family:var(--mono); font-size:0.76rem; color:var(--ink); font-weight:500; word-break:break-word; line-height:1.35; max-width:100%; }
.cmd-pill-note { font-family:var(--sans); font-size:0.68rem; color:var(--ink-3); font-style:italic; line-height:1.4; }
.cmd-pill[data-advisory="1"] { border-style:dashed; }
.cmd-pill[data-advisory="1"] .cmd-pill-name::after { content:" · advisory"; color:var(--ink-faint); font-family:var(--sans); font-size:0.66rem; font-weight:400; font-style:italic; }
.cmd-pill[data-ambient="1"] { background:var(--surface-2); }
.cmd-pill[data-ambient="1"] .cmd-pill-name { color:var(--ink-2); }
.cmd-phase-pills .cmd-pill { align-self:stretch; }
.cmd-phase-arrow { display:flex; align-items:center; justify-content:center; padding:0 0.4rem; color:var(--ink-faint); font-family:var(--mono); font-size:1.05rem; flex:0 0 auto; align-self:stretch; }
.cmd-rail { margin-top:1rem; padding:0.85rem 1rem; background:var(--cream-2); border:1px dashed var(--border); border-radius:var(--r-sm); display:flex; gap:0.85rem; align-items:flex-start; flex-wrap:wrap; }
.cmd-rail-head { display:flex; flex-direction:column; gap:0.15rem; min-width:160px; }
.cmd-rail-label { font-family:var(--sans); font-size:0.78rem; color:var(--ink); font-weight:600; }
.cmd-rail-desc { font-family:var(--sans); font-size:0.7rem; color:var(--ink-3); line-height:1.45; }
.cmd-rail-pills { display:flex; gap:0.4rem; flex-wrap:wrap; flex:1; }
.cmd-rail .cmd-pill { background:var(--surface); }
.cmd-pill-when { font-family:var(--sans); font-size:0.66rem; color:var(--ink-faint); font-style:italic; }

/* View selector (segmented control above the process flow) */
.cmd-view-tabs { display:flex; gap:0; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-pill); padding:0.2rem; margin-bottom:1rem; flex-wrap:wrap; }
.cmd-view-tab { background:transparent; border:none; padding:0.35rem 0.85rem; cursor:pointer; font-family:var(--sans); font-size:0.78rem; color:var(--ink-3); font-weight:500; border-radius:var(--r-pill); transition:all var(--dur-fast) var(--ease); white-space:nowrap; }
.cmd-view-tab:hover { color:var(--ink); }
.cmd-view-tab.active { background:var(--ink); color:var(--cream); box-shadow:var(--shadow-sm); }
.cmd-view-tab-count { font-family:var(--mono); font-size:0.62rem; opacity:0.7; margin-left:0.3rem; vertical-align:1px; }
@media (max-width:920px) {
  .cmd-flow-phases { flex-direction:column; }
  .cmd-phase-arrow { transform:rotate(90deg); padding:0.3rem 0; }
}

/* Tandem plugin tab */
.tandem-header { display:grid; grid-template-columns:auto 1fr auto; gap:1.25rem; align-items:start; padding:1.5rem 1.6rem; background:linear-gradient(135deg, var(--surface) 0%, var(--cream-2) 100%); border:1px solid var(--border); border-radius:var(--r); box-shadow:var(--shadow); margin-bottom:1.5rem; }
.tandem-mark { width:64px; height:64px; border-radius:50%; background:var(--ink); color:var(--cream); display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow); overflow:hidden; }
.tandem-mark svg { width:100%; height:100%; display:block; }
.tandem-meta h2 { font-family:var(--serif); font-size:2rem; font-weight:400; line-height:1.1; color:var(--ink); letter-spacing:-0.01em; display:flex; align-items:baseline; gap:0.65rem; flex-wrap:wrap; margin-bottom:0.5rem; }
.tandem-version { font-family:var(--mono); font-size:0.78rem; color:var(--red); background:var(--red-soft); padding:0.12rem 0.55rem; border-radius:var(--r-pill); font-weight:500; letter-spacing:0.02em; }
.tandem-desc { font-family:var(--sans); font-size:0.92rem; color:var(--ink-2); line-height:1.6; max-width:720px; margin-bottom:0.85rem; }
.tandem-links { display:flex; gap:0.85rem; align-items:center; flex-wrap:wrap; font-size:0.78rem; color:var(--ink-3); }
.tandem-links a { color:var(--blue); text-decoration:none; font-weight:500; border-bottom:1px dashed var(--blue); padding-bottom:1px; }
.tandem-links a:hover { color:var(--ink); border-bottom-color:var(--ink); }
.tandem-links .tandem-author, .tandem-links .tandem-license { font-family:var(--mono); font-size:0.7rem; color:var(--ink-3); padding:0.08rem 0.5rem; background:var(--surface-2); border-radius:var(--r-pill); }
.tandem-counts { display:flex; flex-direction:column; gap:0.55rem; align-items:flex-end; padding-left:1rem; border-left:1px dashed var(--border); min-width:120px; }
.tandem-counts span { font-family:var(--sans); font-size:0.78rem; color:var(--ink-3); white-space:nowrap; }
.tandem-counts strong { font-family:var(--mono); font-size:1.35rem; color:var(--ink); font-weight:600; margin-right:0.35rem; }
.tandem-source { font-family:var(--mono); font-size:0.68rem; color:var(--ink-faint); margin-top:0.4rem; }
.tandem-skill-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:0.75rem; }
.tandem-skill { padding:0.85rem 1rem; background:var(--cream); border:1px solid var(--border); border-radius:var(--r-sm); cursor:pointer; transition:all var(--dur-fast) var(--ease); display:flex; flex-direction:column; gap:0.4rem; }
.tandem-skill:hover { background:var(--surface-2); border-color:var(--ink-faint); transform:translateY(-1px); box-shadow:var(--shadow-sm); }
.tandem-skill-name { font-family:var(--mono); font-size:0.84rem; font-weight:500; color:var(--ink); }
.tandem-skill-desc { font-family:var(--sans); font-size:0.78rem; color:var(--ink-3); line-height:1.5; }
.tandem-hook-list { display:flex; flex-direction:column; gap:0.5rem; }
.tandem-hook { display:flex; gap:0.75rem; align-items:flex-start; padding:0.55rem 0.75rem; background:var(--cream); border:1px solid var(--border); border-radius:var(--r-sm); font-family:var(--mono); font-size:0.78rem; }
.tandem-hook-event { color:var(--red); font-weight:600; min-width:130px; flex-shrink:0; }
.tandem-hook-matcher { color:var(--ink); flex-shrink:0; min-width:90px; }
.tandem-hook-cmd { color:var(--ink-3); flex:1; word-break:break-word; }
.tandem-docs { display:flex; gap:0.6rem; flex-wrap:wrap; }
.tandem-doc { padding:0.4rem 0.75rem; background:var(--cream); border:1px solid var(--border); border-radius:var(--r-sm); font-family:var(--mono); font-size:0.78rem; color:var(--blue); text-decoration:none; transition:all var(--dur-fast) var(--ease); }
.tandem-doc:hover { background:var(--surface-2); border-color:var(--ink-faint); color:var(--ink); }
@media (max-width:760px) {
  .tandem-header { grid-template-columns:1fr; }
  .tandem-counts { border-left:none; border-top:1px dashed var(--border); padding-left:0; padding-top:0.85rem; align-items:flex-start; }
}

.age-ribbon { display:inline-block; padding:0.08rem 0.45rem; border-radius:var(--r-pill); font-family:var(--mono); font-size:0.66rem; font-weight:600; letter-spacing:0.02em; margin-left:0.35rem; }
.age-ribbon.warn { background:var(--yellow-soft); color:#7a5a00; }
.age-ribbon.danger { background:var(--red-soft); color:var(--red); }
.stream-line { display:flex; align-items:center; gap:0.45rem; padding:0.35rem 0; border-bottom:1px dashed var(--border); font-size:0.82rem; }
.stream-line:last-child { border-bottom:none; }
.stream-when { font-family:var(--mono); font-size:0.7rem; color:var(--ink-3); min-width:78px; }
.stream-why { font-family:var(--mono); font-size:0.66rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--ink-faint); min-width:74px; }
.stream-id { font-family:var(--mono); font-size:0.74rem; color:var(--ink-2); }
.stream-title { color:var(--ink); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* Cmd-K search palette */
.cmdk-backdrop { position:fixed; inset:0; background:rgba(26,23,20,0.45); z-index:200; display:none; align-items:flex-start; justify-content:center; padding:8vh 1rem 1rem; backdrop-filter:blur(4px); }
.cmdk-backdrop.open { display:flex; }
.cmdk { width:min(720px, 100%); background:var(--surface); border:1px solid var(--border); border-radius:var(--r-lg); box-shadow:var(--shadow-lg); overflow:hidden; animation:palette-in var(--dur) var(--ease); }
@keyframes palette-in { from { transform:translateY(-8px); opacity:0; } to { transform:translateY(0); opacity:1; } }
@media (prefers-reduced-motion: reduce) { .cmdk { animation:none; } }
.cmdk-input { width:100%; padding:1rem 1.25rem; border:none; outline:none; background:transparent; font-family:var(--sans); font-size:1.05rem; color:var(--ink); border-bottom:1px solid var(--border); }
.cmdk-input::placeholder { color:var(--ink-faint); }
.cmdk-list { max-height:55vh; overflow-y:auto; padding:0.25rem 0; }
.cmdk-item { display:flex; align-items:center; gap:0.65rem; padding:0.55rem 1.1rem; cursor:pointer; border-left:3px solid transparent; }
.cmdk-item:hover, .cmdk-item.focused { background:var(--surface-2); border-left-color:var(--red); }
.cmdk-kind { font-family:var(--mono); font-size:0.62rem; text-transform:uppercase; letter-spacing:0.08em; color:var(--ink-faint); min-width:64px; font-weight:600; }
.cmdk-id { font-family:var(--mono); font-size:0.74rem; color:var(--ink-2); min-width:140px; }
.cmdk-title { color:var(--ink); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.9rem; }
.cmdk-empty { padding:1.25rem; color:var(--ink-3); font-size:0.85rem; text-align:center; }
.cmdk-foot { padding:0.55rem 1.1rem; border-top:1px solid var(--border); display:flex; gap:0.85rem; font-family:var(--mono); font-size:0.66rem; color:var(--ink-faint); }
.cmdk-foot kbd { font-family:var(--mono); background:var(--surface-2); border:1px solid var(--border); border-bottom-width:2px; border-radius:4px; padding:0.05rem 0.35rem; color:var(--ink-2); }

/* Spec / Template / Prompt / Script / Audit / Review cards (reuse .tile but add ext badge) */
.ext-badge { font-family:var(--mono); font-size:0.62rem; padding:0.06rem 0.4rem; border-radius:var(--r-sm); background:var(--surface-2); color:var(--ink-3); text-transform:uppercase; letter-spacing:0.05em; font-weight:600; }
.ext-badge.html { background:var(--blue-soft); color:var(--blue); }
.ext-badge.md { background:var(--surface-2); color:var(--ink-3); }
.ext-badge.json { background:var(--yellow-soft); color:#7a5a00; }
.ext-badge.js, .ext-badge.cjs, .ext-badge.mjs { background:var(--teal-soft); color:var(--teal); }
.ext-badge.ps1, .ext-badge.sh { background:var(--red-soft); color:var(--red); }

/* Reviews grouped by linked artefact */
.review-group { background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:0.95rem 1.1rem; margin-bottom:0.85rem; }
.review-group-head { display:flex; align-items:baseline; gap:0.6rem; margin-bottom:0.5rem; padding-bottom:0.45rem; border-bottom:1px dashed var(--border); }
.review-group-id { font-family:var(--mono); font-size:0.82rem; color:var(--ink); font-weight:600; }
.review-group-count { font-family:var(--mono); font-size:0.7rem; color:var(--ink-faint); }
.review-row { display:flex; align-items:center; gap:0.6rem; padding:0.3rem 0; font-size:0.82rem; }
.review-row .name { font-family:var(--mono); font-size:0.74rem; color:var(--ink-2); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.review-row a { color:var(--blue); text-decoration:none; }
.review-row a:hover { text-decoration:underline; }
`;
