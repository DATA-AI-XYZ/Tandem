const __boardAssembleUrl = require('node:url').pathToFileURL(__filename).href;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// assemble-entry.mjs
var assemble_entry_exports = {};
__export(assemble_entry_exports, {
  assemble: () => assemble,
  assertNoRemoteUrls: () => assertNoRemoteUrls,
  brandFontFaces: () => brandFontFaces,
  buildBoardConfig: () => buildBoardConfig,
  buildCss: () => buildCss,
  countRecords: () => countRecords,
  escapeForScript: () => escapeForScript,
  escapeHtml: () => escapeHtml,
  extractPayloadJson: () => extractPayloadJson,
  mermaidBundle: () => mermaidBundle,
  mermaidFont: () => mermaidFont,
  mermaidThemeVars: () => mermaidThemeVars
});
module.exports = __toCommonJS(assemble_entry_exports);

// lib/payload.mjs
var import_node_fs = __toESM(require("node:fs"), 1);
var DATA_OPEN = "<script>window.__DATA = ";
var DATA_CLOSE = ";</script>";
function extractPayloadJson(htmlPath) {
  const html = import_node_fs.default.readFileSync(htmlPath, "utf8");
  const i = html.indexOf(DATA_OPEN);
  if (i === -1) {
    throw new Error(
      "no window.__DATA payload in " + htmlPath + " \u2014 the generator output this build reads is missing or is not a generate-dashboard.js document"
    );
  }
  const j = html.indexOf(DATA_CLOSE, i + DATA_OPEN.length);
  if (j === -1) throw new Error("unterminated window.__DATA payload in " + htmlPath);
  return html.slice(i + DATA_OPEN.length, j);
}
function countRecords(data) {
  const per = {};
  let total = 0;
  for (const k of Object.keys(data)) {
    if (Array.isArray(data[k])) {
      per[k] = data[k].length;
      total += data[k].length;
    }
  }
  return { total, per };
}
var LINE_SEP = new RegExp("[\u2028\u2029]", "g");
function escapeForScript(json) {
  return String(json).replace(/</g, "\\u003c").replace(LINE_SEP, (c) => c === "\u2028" ? "\\u2028" : "\\u2029");
}

// lib/assemble.mjs
var FAVICON = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function assemble(o) {
  const title = escapeHtml((o.config && o.config.project ? o.config.project + " " : "") + "Command Center");
  const data = escapeForScript(o.payloadJson);
  const config = escapeForScript(JSON.stringify(o.config || {}));
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + title + '</title>\n<link rel="icon" href="' + FAVICON + '">\n<style>' + o.css + '</style>\n</head>\n<body>\n<div id="app"></div>\n<script>window.__DATA = ' + data + ";</script>\n<script>window.__BOARD_CONFIG = " + config + ";</script>\n" + (o.mermaidJs ? "<script>" + o.mermaidJs + "</script>\n" : "<!-- mermaid bundle absent: diagrams degrade visibly -->\n") + "<script>" + o.runtimeJs + "</script>\n</body>\n</html>\n";
}

// lib/styles.mjs
var import_node_module = require("node:module");

// lib/status-tokens.mjs
var STATUS_ORDER = Object.freeze([
  "in-progress",
  "in-review",
  "ready",
  "done",
  "blocked",
  "not-started"
]);
var STATUS_TOKENS = Object.freeze({
  "in-progress": Object.freeze({ hue: "#F0B429", fill: "#FAE9C0", ink: "#12161C", ring: null, neutral: false }),
  "in-review": Object.freeze({ hue: "#B48618", fill: "#FFFFFF", ink: "#7A5A00", ring: "#B48618", neutral: false }),
  ready: Object.freeze({ hue: "#2861C9", fill: "#DCE7F8", ink: "#2861C9", ring: null, neutral: false }),
  done: Object.freeze({ hue: "#0A6F66", fill: "#CFEAE6", ink: "#0A6F66", ring: null, neutral: false }),
  blocked: Object.freeze({ hue: "#C12B2C", fill: "#F8E0E0", ink: "#C12B2C", ring: null, neutral: false }),
  "not-started": Object.freeze({ hue: "#5A6472", fill: "#EEF1EF", ink: "#5A6472", ring: null, neutral: true })
});
var CHROMATIC_STATUSES = Object.freeze(
  STATUS_ORDER.filter((s) => !STATUS_TOKENS[s].neutral)
);
var FAMILY_DELTA_E = 17;
function statusTokenDeclarations() {
  const lines = [`  --st-family-band:${FAMILY_DELTA_E};`];
  for (const status of STATUS_ORDER) {
    const t = STATUS_TOKENS[status];
    lines.push(`  --st-${status}-hue:${t.hue}; --st-${status}-fill:${t.fill}; --st-${status}-ink:${t.ink};${t.ring ? ` --st-${status}-ring:${t.ring};` : ""} --st-${status}-neutral:${t.neutral ? 1 : 0};`);
  }
  return lines.join("\n");
}
function statusCss() {
  const rules = [];
  for (const status of STATUS_ORDER) {
    const t = STATUS_TOKENS[status];
    const sel = `.pill[data-status="${status}"],.tile .pill[data-status="${status}"],.card-grid .card .pill[data-status="${status}"]`;
    const ring = t.ring ? `box-shadow:inset 0 0 0 1px var(--st-${status}-ring);border-color:var(--st-${status}-ring)` : "border-color:transparent";
    rules.push(`${sel}{background:var(--st-${status}-fill);color:var(--st-${status}-ink);${ring}}`);
  }
  rules.push('.progress > span[data-status-metric="in-progress"]{background:var(--st-in-progress-hue)}');
  return rules.join("\n");
}

// lib/styles.mjs
var require2 = (0, import_node_module.createRequire)(__boardAssembleUrl);
var SHIPPED_CSS_CANDIDATES = [
  "./brand-fonts.css.js",
  "../../_00-Project-Management/93-Scripts/lib/brand-fonts.css.js"
];
function shippedCss() {
  for (const spec of SHIPPED_CSS_CANDIDATES) {
    let resolved;
    try {
      resolved = require2.resolve(spec);
    } catch (_e) {
      continue;
    }
    return require2(resolved);
  }
  throw new Error("the shipped brand-fonts.css.js is neither beside this module nor in the kit tree above it (tried " + SHIPPED_CSS_CANDIDATES.join(" \xB7 ") + ") \u2014 the six brand faces have exactly one source (ADR-0092 / CF-46), and re-declaring them here is not a fallback this build is allowed to take");
}
function brandFontFaces() {
  const faces = shippedCss().match(/@font-face\{[^}]*\}/g) || [];
  if (faces.length === 0) {
    throw new Error("no @font-face rules found in the shipped brand-fonts.css.js \u2014 the board cannot be built on-brand offline (CF-46)");
  }
  return faces.join("");
}
function assertNoRemoteUrls(css) {
  const remote = [];
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m;
  while ((m = re.exec(css)) !== null) {
    const u = m[2].trim();
    if (u && !/^data:/i.test(u) && u.charAt(0) !== "#") remote.push(m[0]);
  }
  if (remote.length) {
    throw new Error("stylesheet reaches outside the document: " + remote.slice(0, 3).join(" \xB7 "));
  }
  return css;
}
var SHELL = `
:root{
  --ink:#12161c; --ink-dim:#5a6472; --paper:#fbfaf8; --panel:#ffffff;
  --line:#e3e0da; --accent:#2f5d50; --accent-ink:#ffffff;
  --hover:#f2efe9; --chip:#eef1ef;
  /* The group-header dot's two states (CF-55): a resolved epic, and the muted
     Unassigned bucket. Tokens rather than literals at the call site, so the
     dot's colour is a palette decision in one place \u2014 the same rule
     STORY-33.9.04's token regime generalises. */
  --red:#a8382e; --ink-faint:#9aa1ac;
  /* THE BRAND RED, AND THE ONE ROLE THAT WEARS IT HERE (STORY-34.4.02 \xB7 R10).
     #C12B2C is the Brand Guidelines value. It is NOT the mockup's lighter, pinker
     red, which the critique flagged as off-brand and which TESTPLAN-34.4.02 TC-05
     asserts appears nowhere under board/ - a SOURCE grep, never a DASHBOARD.html
     prose grep, because the payload embeds every artefact body and would match the
     token's own name. That gate is strict enough to catch this comment spelling the
     forbidden literal, and it did on the first run: the source was corrected and the
     gate left alone, because a value that survives in a comment is a value one
     copy-paste from surviving in a rule.
     One VALUE, named once; the ROLE gets its own token so a rule says what it
     means rather than what colour it is. --focus-ring is the keyboard's ring and
     the reason it is solid rather than the 45%-alpha the critique found: an alpha
     ring composites toward whatever is behind it, so its contrast is a property of
     the row it lands on rather than of the ring. STORY-34.4.03 adds the second
     role (Now's urgency chip) against the same value.
     BACKTICK-FREE ZONE: this comment is inside a template literal. */
  --brand-red:#C12B2C; --focus-ring:var(--brand-red);
  /* The rail's urgency chip (STORY-34.4.03 \xB7 R11) - the SECOND role on the same
     value, named separately for the reason --focus-ring is: a rule should say what
     it means. White on this red measures 5.80:1, above AA at the 11px floor. */
  --urgent-bg:var(--brand-red); --urgent-ink:#ffffff;
  /* THE QUIET-BUT-LEGIBLE TIER \u2014 one token, carrying the whole quiet tier
     (STORY-34.3.02 \xB7 ADR-0293). --ink-faint is 2.6:1 on white, below AA at any
     size, and is ornament-only; --ink-dim (6.00:1 on white) is the ordinary text
     tier, so text painted with it does not read as de-emphasised at all.
     BUG-20260826-09 minted this token at #667085 for a verdict-strip zero and two
     stragglers. This story makes it carry the tier, and the value MOVED to the
     mockup's #6F6960 on measurement, not on taste:
       ground        #6F6960   #667085
       --paper cream  5.21      4.77
       --panel white  5.43      4.97
       --chip         4.78      4.37   <- below AA
       --hover        4.73      4.33   <- below AA
     Quiet text lands on chips and hover rows, so the shipped value could not carry
     the tier without breaching AA on two of the four grounds it has to survive.
     #6F6960 is also in the board's own warm cream family (--paper, --line) rather
     than a cool grey-blue reading as a foreign hue. The de-emphasis hierarchy
     survives the move, which BUG-20260826-09's ACs required: on white,
     quiet 5.43 < dim 6.00 < ink 18.15.
     DE-EMPHASIS BY TOKEN, NOT BY OPACITY. The derived sweep found three sub-AA
     elements whose colour declarations were fine and whose ANCESTOR OPACITY put
     them under the floor - a count at .85, a caret at .7, a separator at .55.
     Opacity de-emphasis is invisible to every declaration-layer check and only a
     composited reading sees it, so those rules now say what they mean with this
     token instead. BACKTICK-FREE ZONE: this comment is inside a template literal. */
  --ink-quiet:#6F6960;
  /* The severity pill's colour pair. One pair, not one per value: the value
     rides on data-severity (the same shape .pill[data-status] already uses) and
     the CONTRAST floor is what STORY-33.6.04 asserts, over the composited
     rendering rather than over these declarations. */
  --sev-bg:#f3ded9; --sev-ink:#7d281f;
  --scrim:rgba(18,22,28,.42); --shadow-modal:0 18px 48px rgba(18,22,28,.22);
  --rail-w:232px; --rail-w-narrow:64px;
  /* THE DRAWER IS SIZED TO ITS MEASURE (ADR-0201 / CF-28). The cap is DERIVED
     from the reading column plus the body's own horizontal padding, so the
     content box lands ON the measure: change --measure and the drawer follows,
     and the two cannot drift into the blank right-hand third BUG-20260801-08 /
     UAT item 2 reported. The 360px floor still wins on narrow viewports, where
     the prose already fills the panel and there is no dead band to remove. */
  --drawer-pad:18px; --measure:74ch;
  --drawer-w:clamp(360px, 60vw, calc(var(--measure) + 2 * var(--drawer-pad)));
  --history-max-h:56vh;
  --slice-lab-w:104px; --slice-gap:12px;
  --col-id:180px; --col-title:460px; --col-status:130px; --col-type:130px;
  --col-when:190px; --col-source:320px;
  --font-display:'Instrument Serif', Georgia, serif;
  --font-body:'Manrope', ui-sans-serif, system-ui, sans-serif;
  --font-mono:'JetBrains Mono', ui-monospace, Menlo, monospace;
/* THE STATUS MAP, GENERATED INTO THIS BLOCK (STORY-34.3.01 \xB7 ADR-0292). One palette,
   not a palette and an annex - css-token-gate.test.js requires exactly one :root
   block because "a second one is a second palette", which is this story's own
   argument one field over. The values come from board/lib/status-tokens.mjs and are
   never typed here; the rules that consume them are generated from the same object
   and appended after the shell. BACKTICK-FREE ZONE: inside a template literal. */
${statusTokenDeclarations()}
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%}
body{background:var(--paper);color:var(--ink);font-family:var(--font-body);font-size:14px;line-height:1.5}
.shell{display:flex;min-height:100vh}

/* ---- the rail --------------------------------------------------------- */
.rail{flex:0 0 var(--rail-w);background:var(--panel);border-right:1px solid var(--line);
  display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.rail-head{display:flex;align-items:center;gap:8px;padding:16px 14px;border-bottom:1px solid var(--line)}
.logo-slot{display:inline-flex;width:24px;height:24px;flex:0 0 auto}
.logo-slot svg{width:100%;height:100%}
/* The rail's identity lockup (STORY-34.4.03). It is the PRODUCT's name and it is
   hidden at the collapsed width, which is what leaves the badge alone up there. */
.rail-lockup{font-family:var(--font-display);font-size:17px;letter-spacing:.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.app-title{font-family:var(--font-display);font-size:19px;letter-spacing:.01em;white-space:nowrap;overflow:hidden}
.rail-scroll{flex:1 1 auto;overflow-y:auto;padding:8px 6px;display:flex;flex-direction:column;gap:2px}
.rail-lab{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-quiet);
  padding:10px 10px 4px}
.nav-item{display:flex;align-items:center;gap:8px;width:100%;
  min-height:32px;padding:6px 10px;border:0;border-radius:6px;background:transparent;
  color:var(--ink-dim);font:inherit;text-align:left;cursor:pointer}
.nav-item:hover{background:var(--hover);color:var(--ink)}
.nav-item.active{background:var(--accent);color:var(--accent-ink)}
.nav-item .nico{width:16px;height:16px;flex:0 0 auto;stroke-width:1.6}
.nav-item .lbl{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-item{position:relative}
/* THE RAIL'S ONE BADGE (STORY-34.4.03 \xB7 R11). A nav badge means "this needs you",
   so this is an urgency chip and not an inventory count - and there is exactly one
   on the rail. White on the brand red measures 5.80:1, above AA at the 11px
   functional-text floor CHAT-07 set. The brand red is the VALUE; the ROLE gets its
   own token so a rule says what it means.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.rail-urgency{font-family:var(--font-mono);font-size:11px;line-height:1;flex:0 0 auto;
  min-width:18px;padding:3px 6px;border-radius:9px;text-align:center;
  background:var(--urgent-bg);color:var(--urgent-ink)}
.nav-item.active .rail-urgency{background:var(--panel);color:var(--urgent-bg)}
.nav-item .cnt{font-family:var(--font-mono);font-size:11px;color:var(--ink-quiet);flex:0 0 auto}
/* THE COUNT IS QUIET RELATIVE TO ITS ROW, not absolutely (STORY-34.3.02). The
   quiet token is a de-emphasis against the PAPER; on the selected row the ground
   is the accent and the same token lands 1.38:1 - dark on dark. Measured, by the
   derived sweep, on a change made three edits earlier in this same story: the
   opacity these rules used to carry composited toward whatever was behind it and
   therefore could not make this mistake, which is exactly why the replacement had
   to be verdicted on the rendered board rather than reasoned about.
   The override says inherit rather than re-naming --accent-ink: the selected row
   already states its ink once. BACKTICK-FREE ZONE: inside a template literal. */
.nav-item.active .cnt{color:inherit}
/* THE RAIL'S OWN FOCUS RING (STORY-34.4.02 AC-4 \xB7 BUG-20260901-04).
   The rail is the FIRST thing a keyboard user tabs into and it had no
   ":focus-visible" rule at all, so it wore the UA default black ring - measured
   at "1px auto rgb(16, 16, 16)" by --modality-probe's live arm, which is what
   found it. Two focus vocabularies on one board is the defect R10 names.
   The offset is negative so the ring sits INSIDE the item: at the collapsed
   width the rail is 64px and an outward ring would be clipped by the overlay.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.nav-item:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}

/* ---- the stage -------------------------------------------------------- */
/* "min-width:0" is the whole frame contract in one declaration: without it a
   flex child refuses to be narrower than its content, and a wide table inflates
   the page instead of scrolling inside its own column. */
.stage{flex:1 1 auto;min-width:0;padding:20px 24px 48px}
.stage-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;
  padding-bottom:12px;border-bottom:1px solid var(--line);margin-bottom:18px}
.stage-title{font-family:var(--font-display);font-size:22px}
.stage-snapshot{color:var(--ink-dim);font-size:12px}
.tab-section{display:none}
.tab-section.active{display:block}

/* ---- the reading frame (CF-07) --------------------------------------- */
.view-frame{min-width:0;max-width:100%}
/* The ONE place horizontal scrolling is allowed to live. A ".wide" child
   scrolls itself; the page never does. */
.wide{overflow-x:auto;overflow-y:hidden;max-width:100%}
.view-title{font-family:var(--font-display);font-weight:400;font-size:20px;margin:0 0 4px}
.view-count{color:var(--ink-dim);font-size:12px;margin:0 0 14px}
.view-count-n{font-family:var(--font-mono)}
.view-empty{color:var(--ink-dim);font-size:13px;margin:0}

/* ---- the pill sub-nav ------------------------------------------------- */
.sub-nav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
.pill{display:inline-flex;align-items:center;gap:7px;min-height:28px;padding:3px 11px;
  border:1px solid var(--line);border-radius:999px;background:var(--panel);
  color:var(--ink-dim);font:inherit;font-size:13px;cursor:pointer}
.pill:hover{background:var(--hover);color:var(--ink)}
.pill.active{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.pill .cnt{font-family:var(--font-mono);font-size:11px;color:var(--ink-quiet)}
.pill.active .cnt{color:inherit}

/* ---- the slicer (STORY-33.4.01 \xB7 CF-23 \xB7 STORY-33.4.02 \xB7 CF-16) -------- */
/* THREE OF THESE RULES ARE ASSERTED GEOMETRY, not taste, and each one is a
   named failure mode from the band the old board shipped first:
     1. .slice-band is a GRID with a label track. --assert-label-column-exclusive
        requires the band's own label to sit at the band's content edge and
        NOTHING else to start there; the flex layout that preceded it let a
        wrapped value fall into the label column and read as a heading.
     2. .slice-clear is justify-self:end in the last track, so its right edge is
        the row's content-box right edge. --assert-rightmost measures exactly that,
        with a 2px tolerance, and its named failure is the control landing in the
        label column.
     3. the menu is display:none while shut. --dropdown-filter-walk reads client
        rects to decide the control is a real disclosure, and a menu hidden only
        visually would still put its options in the tab order.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.slicer-panel{display:none}
.slicer-panel.active{display:block;border:1px solid var(--line);border-radius:8px;
  background:var(--panel);padding:8px 12px;margin:0 0 18px}
.slice-band,.slice-actions{display:grid;
  grid-template-columns:var(--slice-lab-w) minmax(0,1fr);
  align-items:center;column-gap:var(--slice-gap);padding:5px 0}
.slice-band + .slice-band,.slice-actions{border-top:1px solid var(--line)}
.slice-lab{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-quiet);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slice-dd{position:relative;justify-self:start}
.slice-dd-trigger{display:inline-flex;align-items:center;gap:7px;min-height:28px;padding:3px 11px;
  border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--ink-dim);
  font:inherit;font-size:13px;cursor:pointer}
.slice-dd-trigger:hover{background:var(--hover);color:var(--ink)}
.slice-dd-trigger.sel{border-color:var(--accent);color:var(--ink)}
.slice-dd-trigger:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.dd-lab{max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dd-badge{font-family:var(--font-mono);font-size:11px;min-width:16px;text-align:center;
  border-radius:999px;background:var(--accent);color:var(--accent-ink);padding:0 5px}
.dd-caret{font-size:11px;color:var(--ink-quiet)}
.slice-dd-menu{position:absolute;z-index:40;top:calc(100% + 4px);left:0;
  min-width:240px;max-width:min(440px,80vw);
  border:1px solid var(--line);border-radius:8px;background:var(--panel);
  box-shadow:var(--shadow-modal);padding:6px}
.slice-dd-menu[hidden]{display:none}
.slice-opts{max-height:min(46vh,320px);overflow-y:auto;display:flex;flex-direction:column;gap:1px}
.slice-opt{display:flex;align-items:center;gap:8px;width:100%;min-height:28px;padding:3px 8px;
  border:0;border-radius:6px;background:transparent;color:var(--ink-dim);font:inherit;font-size:13px;
  text-align:left;cursor:pointer}
.slice-opt:hover{background:var(--hover);color:var(--ink)}
.slice-opt:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
.slice-box{flex:0 0 auto;width:13px;height:13px;border:1px solid var(--line);border-radius:3px;
  background:var(--panel)}
.slice-opt.sel{color:var(--ink)}
.slice-opt.sel .slice-box{background:var(--accent);border-color:var(--accent)}
.slice-opt-lab{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The in-slice count and the zero-result state (STORY-34.5.01 \xB7 AC-2).
   --ink-quiet at 11px is the board's established count treatment (.pill .cnt,
   .nav-item .cnt) and both figures are already in the DERIVED contrast sweep, so
   the number arrives measured rather than styled.
   NO OPACITY on the dead row, deliberately: an ancestor opacity is exactly what
   put three correctly-declared colours under the AA floor in STORY-34.3.02, and
   both waiver tables are empty. A quieter TOKEN says the same thing and stays
   measurable. The dashed box carries the "you cannot tick this" signal without
   relying on colour alone. */
.slice-opt-n{flex:0 0 auto;font-family:var(--font-mono);font-size:11px;color:var(--ink-quiet)}
.slice-opt.dead{color:var(--ink-quiet);cursor:default}
.slice-opt.dead:hover{background:transparent;color:var(--ink-quiet)}
.slice-opt.dead .slice-box{border-style:dashed}
.slice-dd-clear{width:100%;margin-top:6px;min-height:26px;border:1px solid var(--line);
  border-radius:6px;background:var(--panel);color:var(--ink-dim);font:inherit;font-size:12px;
  cursor:pointer}
.slice-dd-clear:hover:enabled{background:var(--hover);color:var(--ink)}
.slice-dd-clear[disabled]{opacity:.45;cursor:default}
.slice-clear{justify-self:end;min-height:28px;padding:3px 14px;border:1px solid var(--line);
  border-radius:999px;background:var(--panel);color:var(--ink-dim);font:inherit;font-size:13px;
  cursor:pointer}
.slice-clear:hover:enabled{background:var(--hover);color:var(--ink)}
.slice-clear[disabled]{opacity:.45;cursor:default}
.slice-empty{margin:14px 0 0;color:var(--ink-dim);font-size:13px}
.view-count-of{color:var(--ink-dim)}

/* ---- the records table ----------------------------------------------- */
/* The table's min-width is the SUM of its eight declared column minimums, so
   the two can never disagree: widen a column and the table widens with it.
   These are legibility floors \u2014 an ISO stamp does not read at 90px and a
   repo-relative path does not read at 140px \u2014 which is why the table is wider
   than the reading column at every tested viewport and scrolls inside ".wide". */
.record-table{border-collapse:collapse;width:100%;font-size:13px;
  min-width:calc(var(--col-id) + var(--col-title) + var(--col-status) + var(--col-type)
    + (3 * var(--col-when)) + var(--col-source))}
.record-table th{text-align:left;font-weight:600;font-size:11px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-dim);border-bottom:1px solid var(--line);
  padding:6px 10px;white-space:nowrap}
.record-table td{border-bottom:1px solid var(--line);padding:7px 10px;vertical-align:top}
.record-table .col-id{width:var(--col-id);min-width:var(--col-id)}
.record-table .col-title{width:var(--col-title);min-width:var(--col-title)}
.record-table .col-status{width:var(--col-status);min-width:var(--col-status)}
.record-table .col-type{width:var(--col-type);min-width:var(--col-type)}
.record-table .col-when{width:var(--col-when);min-width:var(--col-when)}
.record-table .col-source{width:var(--col-source);min-width:var(--col-source)}
.cell-id{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
.cell-status{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--chip);color:var(--ink-dim)}
.cell-date{font-family:var(--font-mono);font-size:11px;color:var(--ink-quiet)}
.cell-source{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);overflow-wrap:anywhere}
/* ---- THE ROW HEIGHT BOUND (BUG-20260831-08) ---------------------------
   A record row's height was a function of the longest string page one happened
   to hold: the title (460px) and the repo-relative source path (320px) both
   wrapped freely, and the SAME view moved from 2,141px to 2,767px on a sort
   change alone. Measured drivers at 1440x900: source paths reached FOUR lines,
   titles two. The bound: the title clamps to TWO lines (readable, and the
   census found no third line in any order), the path to ONE. A page of thirty
   worst-case rows is then 30 x 54px of rows against a ~540px view chrome \u2014
   about 2,160px, inside the 2,700px budget WHATEVER the order puts on page one.
   The path elides its MIDDLE, not its tail: the head span (folders) carries a
   giant flex-shrink so it collapses behind its ellipsis first, and the tail
   span (the filename, the half that discriminates) gives way only when it
   alone cannot fit. The drawer carries the full value of both cells.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.record-table td.col-title .cell-title{display:-webkit-box;-webkit-box-orient:vertical;
  -webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
/* The max-width is LOAD-BEARING, not belt-and-braces: white-space:nowrap makes
   the unclamped flex row's MIN-content the full path length, and an auto-layout
   table column can never go below its min-content \u2014 measured, the source column
   ballooned from its 320px track to 1,063px inside ".wide" and the ellipsis
   never engaged. Capping the content at the track minus the td's 2 x 10px
   padding caps the contribution, so the column stays the width it declares. */
.record-table .cell-source{display:flex;min-width:0;white-space:nowrap;
  max-width:calc(var(--col-source) - 20px)}
.record-table .cell-source .src-head{flex:0 1000000 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis}
.record-table .cell-source .src-tail{flex:0 1 auto;min-width:0;
  overflow:hidden;text-overflow:ellipsis}

/* ---- the glossary (BUG-20260901-09) ----------------------------------
   Term beside definition \u2014 the two-column shape the data actually is, never the
   eight-column artefact table that rendered 30 rows of the generator's title
   fallback. table-layout:fixed + overflow-wrap keeps the widest definition
   wrapping inside the reading column, so the view never grows the horizontal
   scrollbar the no-hscroll arm forbids.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.glossary-table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:13px}
.glossary-table thead th{text-align:left;font-weight:600;font-size:11px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--ink-dim);border-bottom:1px solid var(--line);
  padding:6px 10px}
.glossary-table .col-term{width:200px}
.glossary-table tbody th.glossary-term{text-align:left;font-weight:600;color:var(--ink);
  border-bottom:1px solid var(--line);padding:7px 10px;vertical-align:top;
  overflow-wrap:anywhere}
.glossary-table td.glossary-def{border-bottom:1px solid var(--line);padding:7px 10px;
  vertical-align:top;color:var(--ink-dim);line-height:1.55;overflow-wrap:anywhere}
.glossary-table td.glossary-def code{font-family:var(--font-mono);font-size:12px;
  background:var(--chip);padding:1px 4px;border-radius:4px;overflow-wrap:anywhere}
.glossary .empty{color:var(--ink-dim);font-size:13px;margin:0;line-height:1.55}

/* ---- the sort control (STORY-33.6.02 \xB7 CF-25) ------------------------- */
/* A THIRD TRACK, and deliberately NOT a ".slice-band": every band probe in the
   suite counts ".slice-band" elements and verdicts that count against the lifted
   matrix, so a row answering a different question must not join that census.
   The label sits in the same column the bands' labels do, so the control bar
   reads as one bar rather than two.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.sort-row{display:grid;grid-template-columns:var(--slice-lab-w) minmax(0,1fr) auto;
  align-items:center;column-gap:var(--slice-gap);padding:5px 0;border-top:1px solid var(--line)}
.sort-field{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.sort-key,.sort-dir{min-height:26px;padding:2px 12px;border:1px solid var(--line);
  border-radius:999px;background:var(--panel);color:var(--ink-dim);font:inherit;font-size:13px;
  cursor:pointer;white-space:nowrap}
.sort-key:hover,.sort-dir:hover:enabled{background:var(--hover);color:var(--ink)}
.sort-key:focus-visible,.sort-dir:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.sort-key.sel,.sort-key[aria-pressed="true"]{border-color:var(--accent);color:var(--ink);
  background:var(--chip)}
.sort-dir{justify-self:end;font-family:var(--font-mono);font-size:12px}
.sort-dir[disabled]{opacity:.45;cursor:default}
/* The flattened order a sort produces. A global order and a grouped order are
   different claims about the same list, so the groups are not rendered while
   this is. */
.sort-flat{margin:0}

/* ---- the Build work lists (STORY-33.6.01 \xB7 CF-55 \xB7 CF-56) ------------- */
/* THE GRID IS A GRID, and that is asserted rather than decorative. The card
   walk's --assert-single-expand-reflow-max arm verdicts that expanding one card
   moves no card in a DIFFERENT row, and it refuses to run at all when the
   expanded card has no SAME-row neighbour ("a layout with only one card per row"
   makes the claim vacuous). auto-fill with a 320px minimum gives three columns at
   1440px and one at 420px, so the claim is askable at the widths the testplans
   drive and the list still reads on a phone.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
/* ---- THE LIST IS A COLUMN OF GROUPS, and STORY-34.2.02 MEASURED WHY THAT IS
   THE BOUND (ADR-0289). Each group opens its own 3-column .tile-grid, so a group
   of one tile reserves a full row of three. Under STORY-34.2.02 AC-1 the groups
   survive a sort, and on the live corpus group=build&sub=bug then renders 30
   tiles across 11 groups: 2,803px against the 2,700px budget.
   ONE SHARED GRID WAS TRIED AND MEASURED WORSE, 2,925px - recorded so nobody
   spends the attempt twice. display:contents on .grp and its .tile-grid does put
   every tile in one grid, but a header spanning 1/-1 is itself a ROW BREAK, so
   tiles either side of a header still cannot share a row: 16 tile rows, not 10.
   The partial-row waste is caused by the headers, not by the containers, and no
   layout that draws the headers avoids it.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.work-list{display:flex;flex-direction:column;gap:22px}
.grp{min-width:0}
/* The header row: dot + breadcrumb + count, in one line that never wraps into
   the count column. */
/* ---- List landmarks (STORY-34.1.05 \xB7 PRD R9 \xB7 ADR-0286) ------------------
   STICKY AT A MEASURED OFFSET. --sticky-top is written onto the root at runtime
   by measureStickyTop() in app.jsx, which reads whatever sticky/fixed chrome
   overlaps the top of the stage. On this board that is NOTHING (the rail is
   sticky but sits beside the stage; .stage-head is static), so the value resolves
   to 0px - measured, not assumed. The fallback in the var() is 0 rather than a
   copy of the mockup's 57px, because a wrong constant here is the slit the AC
   forbids.
   THE BACKGROUND IS LOAD-BEARING: a transparent sticky header lets its own rows
   scroll through it, which reads as a rendering fault rather than as pinning.
   z-index 5 sits under the slice dropdown (40), the drawer (70) and the palette
   (80) - the layering TC-05 hit-tests.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.grp-h{position:sticky;top:var(--sticky-top,0px);z-index:5;background:var(--paper)}
.grp-fold{flex:0 0 auto;border:1px solid var(--line);border-radius:6px;
  background:var(--panel);color:var(--ink);font:inherit;font-size:11px;line-height:1;
  padding:3px 6px;cursor:pointer;position:relative}
.grp-fold .chev{display:inline-block;transition:transform .18s ease;color:var(--ink-dim)}
.grp-fold[aria-expanded="false"] .chev{transform:rotate(-90deg)}
.grp-fold:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.grp-fold::after{content:"";position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%);min-width:24px;min-height:24px;width:100%;height:100%}
/* BACK TO TOP. Fixed, above the page and the sticky headers, below every overlay.
   Sized to clear the 24x24 target floor on its own - TARGET_SIZE_WAIVERS is empty
   and this story does not add the first entry. */
.totop{position:fixed;right:22px;bottom:22px;z-index:50;display:inline-flex;
  align-items:center;gap:8px;min-height:40px;padding:0 18px;border-radius:999px;
  background:var(--ink);color:var(--paper);border:0;font:inherit;font-size:13px;
  font-weight:600;cursor:pointer;box-shadow:var(--shadow-modal)}
.totop[hidden]{display:none}
.totop:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.totop .chev{font-size:11px;line-height:1}
.grp-h{display:flex;align-items:center;gap:9px;padding:0 0 8px;
  border-bottom:1px solid var(--line);margin:0 0 12px}
.grp-h .dot{flex:0 0 auto;width:8px;height:8px;border-radius:999px}
.grp-h .path{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;
  font-family:var(--font-mono);font-size:11px;letter-spacing:.03em;color:var(--ink-dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grp-h .path .sep{color:var(--ink-quiet);padding:0 2px}
.grp-h .cnt{flex:0 0 auto;font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
/* ---- THE LIST-HEADER SEARCH (STORY-34.2.03 - AC-1 - ADR-0290) -------------
   Borrows .controls and .search from the Reports finder rather than founding a
   third search chrome: one idiom, three consumers. The clear control is sized to
   clear the 24x24 target floor on its own - TARGET_SIZE_WAIVERS is empty and this
   story does not add the first entry.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.view-search-row{display:flex;align-items:center;gap:8px;margin:0 0 14px}
.view-search{flex:0 1 320px;min-width:0}
.view-search-clear{flex:0 0 auto;min-height:28px;padding:0 12px;border:1px solid var(--line);
  border-radius:6px;background:var(--panel);color:var(--ink);font:inherit;font-size:12px;
  cursor:pointer;position:relative}
.view-search-clear:hover{background:var(--hover)}
.view-search-clear:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.view-search-clear::after{content:"";position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%);min-width:24px;min-height:24px;width:100%;height:100%}
.view-search-note{color:var(--ink-dim)}
.tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));
  gap:12px;align-items:start}
.tile{min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:7px}
.tile:hover{background:var(--hover)}
.tile:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
/* The card's one-line head. Both children sit on one row and neither wraps \u2014
   --assert-single-line reads exactly this, and it is what CF-01's "bounded
   one-liner" means on a card. */
/* align-items:STRETCH, not center, and that is measured rather than stylistic.
   The id is 11px mono and the pills are 20-24px boxes, so under align-items:center
   the two children sit on one visual row while their BOX TOPS differ by 3.75px \u2014
   and --assert-single-line reads tops, with a 2px tolerance. Stretching both to
   the row height makes them share a top exactly; each then centres its own
   content inside its own box, so the row reads identically and measures honestly.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.tile-head{display:flex;align-items:stretch;gap:10px;min-width:0}
.tile-id{flex:1 1 auto;min-width:0;display:flex;align-items:center;
  font-family:var(--font-mono);font-size:11px;
  color:var(--ink-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile-id > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile-extra{flex:0 0 auto;display:flex;align-items:center;gap:6px}
/* Clamped, never truncated to a single line: a two-line title reads, a
   mid-word cut does not. overflow:hidden is what --assert-computed-style reads
   to prove the clamp is real rather than a class name. */
.tile-title{min-width:0;font-size:13px;line-height:1.4;overflow:hidden;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;
  overflow-wrap:anywhere}
/* THE BASE RULE, not just the scoped one. The port had only a .tile-scoped .tag
   rule, so every tag outside a .tile rendered unstyled - 304 cost tags and 283
   source tags on the Toolkit alone, plus the ones cadence.jsx and work-list.jsx
   already emitted. The shipped stylesheet colours all of them; this carries that
   across. BACKTICK-FREE ZONE: this comment is inside a template literal. */
.tag{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  border:1px solid var(--line);border-radius:4px;padding:1px 5px;white-space:nowrap}
.tag.star{color:var(--accent);border-color:var(--accent)}
.tag.must{color:var(--red);border-color:var(--red)}
.tag.source{color:var(--ink-quiet)}
.tile .tag{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  border:1px solid var(--line);border-radius:4px;padding:1px 5px;white-space:nowrap}
/* The status/severity pills INSIDE a card are read-only labels, not controls:
   the whole card is the affordance. They keep the .pill name because
   --assert-sliced reads .pill[data-status] inside a tile. */
.tile .pill{min-height:20px;padding:1px 8px;font-size:11px;cursor:inherit;
  background:var(--chip);border-color:var(--line);color:var(--ink-dim);white-space:nowrap}
.tile .pill-severity{background:var(--sev-bg);color:var(--sev-ink);border-color:var(--sev-bg)}

/* ---- the card disclosure (STORY-33.6.03 \xB7 CF-31 \xB7 CF-17) -------------- */
/* THE HIDDEN ATTRIBUTE IS THE STATE CARRIER, and this rule pins it so a later
   display declaration on .card-slot cannot silently un-hide every collapsed
   card. The attribute (rather than a class) also collapses the slot to
   display:none with no stylesheet dependency at all, which is what keeps it
   invisible to the harness's shared visibility helper rather than merely
   transparent.
   The port paints the control at 24px square outright. The old board could not:
   it is pinned to 16.80px so every collapsed grid keeps the height its
   pre-change baseline recorded, and it grows the HIT AREA with a transparent
   overlay instead. The port has no such baseline to preserve, so the simpler
   thing is available \u2014 the painted box IS the target.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.card-slot[hidden]{display:none !important}
.card-slot{margin-top:2px;padding-top:8px;border-top:1px solid var(--line);
  font-size:12px;color:var(--ink-dim);line-height:1.5;min-width:0;overflow-wrap:anywhere}
.card-disclose{flex:0 0 auto;width:24px;height:24px;min-width:24px;min-height:24px;
  padding:0;margin:0;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;border:1px solid var(--line);border-radius:6px;
  color:var(--ink-dim);cursor:pointer;line-height:1}
.card-disclose::before{content:"";width:5px;height:5px;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:translateY(-1px) rotate(45deg)}
.card-disclose[aria-expanded="true"]::before{transform:translateY(1px) rotate(-135deg)}
.card-disclose:hover{background:var(--hover);color:var(--ink);border-color:var(--ink-faint)}
.card-disclose:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
/* min-width:0 on the part is the "a long unbroken token in a flex child refuses
   to shrink" lesson \u2014 without it a Windows path or a bare URL overflows the card
   and --assert-no-clip-expanded reports it, correctly. */
.cs-part{min-width:0;margin-bottom:6px}
.cs-part:last-child{margin-bottom:0}
.cs-part .lab{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.1em;
  color:var(--ink-quiet);font-weight:700;margin-bottom:1px}
.cs-part .cs-absent{color:var(--ink-quiet);font-style:italic}
/* The clamp is BORROWED, not authored: .pa-rec is the treatment the shipped
   board already uses for exactly this kind of summarised body text, so the port
   founds no additional clamp pattern. */
.pa-rec{display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical;
  overflow:hidden;overflow-wrap:anywhere;white-space:normal}

/* ---- the paging control (CF-56) --------------------------------------- */
/* gap: since STORY-34.1.02 the wrap can hold TWO controls - the pager and its undo.
   The mockup spaces them the same way. */
.show-more-wrap{display:flex;justify-content:center;gap:10px;padding:4px 0 0}
.show-more-btn,.show-fewer-btn{min-height:30px;padding:4px 18px;border:1px solid var(--line);
  border-radius:999px;background:var(--panel);color:var(--ink-dim);font:inherit;
  font-size:13px;cursor:pointer}
.show-more-btn:hover,.show-fewer-btn:hover{background:var(--hover);color:var(--ink)}
.show-more-btn:focus-visible,.show-fewer-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}

/* ---- the topbar burger, and the scrim it opens (STORY-34.4.01 \xB7 R8) ---- */
/* The burger is ALWAYS in the markup and hidden here at wide widths, so a probe
   can find it before it has driven a viewport - and so the breakpoint stays a
   fact this stylesheet owns rather than one the runtime re-declares.
   34x34 is the hit target, above WCAG 2.2 SC 2.5.8's 24x24 floor by measurement
   rather than by intent: --target-size-probe hit-tests it at the narrow width.
   BACKTICK-FREE ZONE: inside a template literal. */
.nav-burger{display:none;flex:0 0 auto;align-items:center;justify-content:center;
  width:34px;height:34px;margin-right:4px;border:1px solid var(--line);border-radius:8px;
  background:var(--panel);color:var(--ink-dim);cursor:pointer;padding:0}
.nav-burger:hover{background:var(--hover);color:var(--ink)}
.nav-burger:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.nav-burger .nico{width:18px;height:18px}
/* Mounted only while the overlay is open, so there is no closed scrim. z-index
   sits UNDER the rail and OVER everything else on the page: the drawer (70) and
   the palette (80) are not open at the same time as the rail overlay, and the
   sticky list headers this board grew in FEAT-34.1 are in the stage's own
   stacking context. */
.rail-scrim{position:fixed;inset:0;z-index:85;background:var(--scrim)}

/* ---- narrow viewports: the rail becomes an off-canvas overlay ---------- */
/* THE BREAKPOINT IS 900px AND THE RULE IS LIVE (STORY-34.4.01 AC-3).
   The critique's P0 was a "max-width:900px" rail rule that existed and never
   applied. This block is asserted from COMPUTED style at BOTH widths by
   --narrow-rail-walk --case narrow-rule-live: a rule dead by source order cannot
   pass both arms.

   THE RAIL IS NEVER "display:none" (AC-2). It stays a rendered flex column and
   goes off-canvas by transform; "visibility:hidden" is what takes its eleven
   nav items out of the tab order, which is STORY-34.4.02's contract stated in
   the one place that can make it true. There is deliberately NO transition: a
   visibility transition needs a delay to hide after the slide, and that delay is
   a race every probe reading computed style would have to know about.

   At <=900px the overlay is the NARROW rail - icons only, 64px - so the reading
   column is the whole viewport when it is closed. Measured on this board at
   760x900: the stage went from 513px wide to 760px. "aria-label" on every
   nav-item carries the accessible name ".lbl" stops rendering.
   BACKTICK-FREE ZONE: inside a template literal. */
@media (max-width:900px){
  .rail{position:fixed;top:0;left:0;bottom:0;height:100vh;width:var(--rail-w-narrow);
    flex-basis:var(--rail-w-narrow);z-index:90;transform:translateX(-100%);visibility:hidden}
  .shell.rail-open .rail{transform:translateX(0);visibility:visible}
  .rail .lbl,.rail-lockup,.rail-lab{display:none}
  /* THE URGENCY BADGE BECOMES A DOT (STORY-34.4.03 AC-2). Not "display:none" - the
     whole point of this badge is that it survives the collapse, because "something
     needs you" is exactly what a reader must still see once the labels are gone. The
     number goes; the signal stays, and the element's own accessible name still
     carries the count for a screen reader. BACKTICK-FREE ZONE: inside a template
     literal. */
  .rail-urgency{position:absolute;top:5px;right:11px;width:8px;height:8px;min-width:0;
    padding:0;border-radius:50%;font-size:0;line-height:0;overflow:hidden}
  .rail-head{justify-content:center;padding:14px 8px}
  .nav-item{justify-content:center;padding:6px 4px}
  .nav-burger{display:inline-flex}
  .stage{padding:16px 12px 40px}
}

/* ---- the Cmd-K palette (CF-53) ---------------------------------------- */
/* Its DOM home is the active view section (so an element assertion can reach
   it); its VISUAL home is the viewport. position:fixed does both, and nothing
   between here and the root sets transform/filter/perspective, which are the
   three properties that would turn a fixed descendant into an absolute one. */
.cmdk-root{position:fixed;inset:0;z-index:80;display:flex;justify-content:center;
  align-items:flex-start;padding:12vh 16px 16px;background:var(--scrim)}
.cmdk{width:min(720px,100%);background:var(--panel);border:1px solid var(--line);
  border-radius:10px;box-shadow:var(--shadow-modal);overflow:hidden;
  display:flex;flex-direction:column;max-height:70vh}
.cmdk-input{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;
  color:var(--ink);font:inherit;font-size:16px;padding:14px 16px;outline:none}
.cmdk-input::placeholder{color:var(--ink-dim)}
.cmdk-list{flex:1 1 auto;overflow-y:auto;padding:6px}
.cmdk-item{display:flex;align-items:baseline;gap:10px;padding:7px 10px;border-radius:6px;cursor:pointer}
.cmdk-item.focused{background:var(--accent);color:var(--accent-ink)}
.cmdk-item .cmdk-kind{font-family:var(--font-mono);font-size:11px;letter-spacing:.05em;
  text-transform:uppercase;opacity:.75;flex:0 0 84px}
.cmdk-item .cmdk-id{font-family:var(--font-mono);font-size:11px;flex:0 0 auto}
.cmdk-item .cmdk-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cmdk-empty{padding:18px 16px;color:var(--ink-dim);font-size:13px}
.cmdk-foot{display:flex;gap:14px;padding:8px 16px;border-top:1px solid var(--line);
  color:var(--ink-dim);font-size:11px}
.cmdk-foot kbd{font-family:var(--font-mono);font-size:11px;border:1px solid var(--line);
  border-radius:4px;padding:0 4px;margin-right:3px}

/* ---- the record row as an affordance (STORY-33.3.01) ------------------ */
/* THE ROW KEEPS THE ANCHOR AND LOSES THE BOX (BUG-20260831-03).
   ".tile" is carried on the <tr> deliberately: "--slicer-walk" counts
   ".tile[data-type]" and "--assert-sliced" reads the status pill inside one. But
   ".tile" is also the CARD BOX, and "display:flex;flex-direction:column" on a
   table row blockifies its eight cells into a single column - measured at 368px
   per row, so Decisions rendered 200 records as an 79,673px page and no page size
   this story could pick would bring it inside the 2,700px budget. The anchor is a
   class name; the box is presentation, and only the presentation is reset here.
   Background is deliberately NOT reset, so every contrast reading the sweep
   records against these rows is unchanged.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.record-table tr.tile{display:table-row;padding:0;gap:0;border:0;border-radius:0}
.record-row{cursor:pointer}
.record-row:hover{background:var(--hover)}
.record-row:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}

/* ---- the drawer host (STORY-33.3.01 \xB7 STORY-33.5.01) ------------------ */
/* Top-level chrome, fixed to the right edge, ALWAYS MOUNTED. ".open" is the
   state and display:none is what a closed drawer looks like \u2014 so
   "#drawer.open, .drawer.open" still counts zero when it is shut, while
   --assert-opens-drawer can still find the element before its first click
   (ADR-0249 section 3).
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
/* THE DRAWER IS THE SCROLL CONTAINER, NOT THE BODY, and that is a measurement
   decision rather than a layout preference. A scrollbar on ".drawer-body" sits
   INSIDE its padding box, so the reading column loses the gutter's width while
   the probes' content-box arithmetic (rect.right minus padding-right) does not \u2014
   measured at 15px, which showed up as a 15px dead band AND as nine full-bleed
   surfaces "capped" 15px short of the content box. Scrolling the drawer instead
   takes the gutter out of ".drawer-body"'s own width, so the reading column, the
   tables and the code blocks all land exactly on the content box. This is the
   shipped board's shape too. The head is sticky so Back and Close stay reachable
   at any scroll depth.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
/* A CLOSED OVERLAY COMPUTES visibility:hidden (STORY-34.4.02 AC-1).
   "display:none" already removes its contents from the tab order, so this is not
   what makes the keyboard claim true - the OVERLAY RAIL is the element that needed
   it, and stating the same rule here is what makes "closed overlays are
   visibility:hidden" a property of the board rather than of one element. It costs
   nothing: a display:none element has no visibility to lose, and --modality-probe
   reads both, so a future closed state that stops being display:none cannot quietly
   become tabbable. BACKTICK-FREE ZONE: inside a template literal. */
.drawer{position:fixed;top:0;right:0;bottom:0;width:var(--drawer-w);z-index:70;
  background:var(--panel);border-left:1px solid var(--line);box-shadow:var(--shadow-modal);
  display:none;visibility:hidden;overflow-y:auto;overflow-x:hidden}
.drawer.open{display:block;visibility:visible}
.drawer-head{position:sticky;top:0;z-index:1;background:var(--panel);
  display:flex;align-items:flex-start;gap:12px;padding:14px 18px;
  border-bottom:1px solid var(--line)}
.drawer-ident{flex:1 1 auto;min-width:0}
.drawer-id{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);display:block}
.drawer-title{font-family:var(--font-display);font-weight:400;font-size:20px;margin:2px 0 0}
.drawer-close,.drawer-back{flex:0 0 auto;width:30px;height:30px;border:1px solid var(--line);
  border-radius:6px;background:var(--panel);color:var(--ink-dim);font-size:18px;line-height:1;
  cursor:pointer}
.drawer-close:hover,.drawer-back:hover{background:var(--hover);color:var(--ink)}
/* Back is present in the DOM whenever the drawer is, and SHOWN only when there
   is somewhere to go back to. The class carries the state; the display rule only
   makes the state visible. */
.drawer-back{display:none}
.drawer-back.show{display:inline-flex;align-items:center;justify-content:center}
.drawer-body{padding:var(--drawer-pad)}
.drawer-empty{color:var(--ink-dim);font-size:13px;margin:0}

/* ---- the drawer's chrome sections (STORY-33.5.01) --------------------- */
/* h3, never h2: STORY-33.5.02's fold law is one disclosure per section-leading
   h2 IN THE DRAWER BODY, and --drawer-sections-walk counts both sides of it
   inside .drawer-body. Chrome wearing an h2 would inflate the heading count
   without earning a fold. ".drawer-section" is also the name the dead-band
   measurement excludes as full-bleed, so these blocks may span the content box. */
.drawer-section{margin:1.8em 0 0;padding-top:1em;border-top:1px solid var(--line)}
.drawer-section h3{font-family:var(--font-body);font-weight:600;font-size:11px;
  letter-spacing:.07em;text-transform:uppercase;color:var(--ink-dim);margin:0 0 .6em}
.drawer-section .xref{display:flex;flex-wrap:wrap;gap:6px}
.drawer-source{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  overflow-wrap:anywhere;background:var(--chip);border-radius:4px;padding:.2em .45em;
  display:inline-block;max-width:100%}
.xref-pill{font-family:var(--font-mono);font-size:11px;border:1px solid var(--line);
  border-radius:999px;background:var(--chip);color:var(--ink-dim);padding:2px 9px;cursor:pointer}
.xref-pill:hover{background:var(--hover);color:var(--ink);border-color:var(--accent)}
.xref-pill:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}

/* ---- drawer sections (STORY-33.5.02 \xB7 CF-29 \xB7 ADR-0202) --------------- */
/* NATIVE <details>, and nothing here carries state \u2014 "open" IS the state. Two
   rules are asserted geometry rather than taste:
     1. NO horizontal padding on .drawer-fold-body. A padded fold body would make
        every table and every <pre> inside it narrower than the drawer content
        box, which --drawer-measure-probe reads as a full-bleed surface something
        is capping. The vertical breathing room is safe; the horizontal is not.
     2. NOTHING may set display on .drawer-fold-body. An author rule beats the UA
        rule that hides a closed <details>' content (cascade origin, regardless of
        specificity), and --drawer-sections-walk's own positive control exists to
        catch exactly that: it injects a <details> wearing these class names and
        refuses to verdict if the product's CSS defeats the disclosure.
   The chevron replaces the platform triangle so the board keeps one visual
   language; list-style:none plus the webkit pseudo covers both engines.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.md-body .drawer-fold{border-top:1px solid var(--line)}
.md-body .drawer-fold:first-of-type{border-top:0}
.drawer-fold-head{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:9px;
  border-radius:6px}
.drawer-fold-head::-webkit-details-marker{display:none}
.drawer-fold-head::before{content:"";flex:0 0 auto;width:0;height:0;margin-top:2px;
  border-left:5px solid var(--ink-dim);border-top:4px solid transparent;
  border-bottom:4px solid transparent;transform-origin:25% 50%}
.drawer-fold[open] > .drawer-fold-head::before{transform:rotate(90deg)}
.drawer-fold-head:hover::before{border-left-color:var(--accent)}
.drawer-fold-head:hover h2{color:var(--accent)}
.drawer-fold-head:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.md-body .drawer-fold-head h2{margin:.7em 0 .35em}
.drawer-fold-body{padding-bottom:.4em}
/* The global controls live in the drawer HEAD, which is where the probe reads
   them (".drawer-head .drawer-fold-all[data-fold-action=...]"). They are rendered
   only when the open artefact has folds \u2014 see artefact-body.jsx. */
.drawer-fold-controls{display:flex;gap:6px;margin-top:9px}
.drawer-fold-all{font-family:var(--font-body);font-size:11px;text-transform:uppercase;
  letter-spacing:.09em;font-weight:600;color:var(--ink-dim);background:transparent;
  border:1px solid var(--line);border-radius:999px;padding:3px 10px;cursor:pointer}
.drawer-fold-all:hover{color:var(--accent);border-color:var(--accent);background:var(--hover)}
.drawer-fold-all:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}

/* ---- a reference this board cannot resolve (STORY-33.5.02 AC-3) -------- */
/* It OPENS and it SAYS SO. A click that does nothing is indistinguishable from a
   broken control, which is the failure the testplan's Risks section names. */
.drawer-missing{border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:8px;background:var(--chip);color:var(--ink-dim);padding:12px 14px;font-size:13px}
.drawer-missing p{margin:0 0 .6em}
.drawer-missing p:last-child{margin:0}
.drawer-missing code{font-family:var(--font-mono);font-size:12px;background:var(--panel);
  border-radius:4px;padding:.1em .35em}

/* ---- an .html artefact, framed rather than bounced (ADR-0199 \xB7 CF-30) -- */
/* The frame is capped at min(72vh,900px) so the drawer keeps its own scroll
   rather than growing to the height of the framed document (ADR-0201's sibling
   consequence). It fills the content box because a rendered artefact nobody can
   read is not "rendered in the drawer" \u2014 --html-drawer-sandbox-probe measures it. */
.drawer-html-wrap{border:1px solid var(--line);border-radius:8px;overflow:hidden;
  background:var(--panel)}
/* A TOKEN, never a literal (CF-18). css-token-gate.test.js scans the BUILT stylesheet and
   a raw hex here failed it \u2014 the frame needs an opaque backdrop because a framed artefact
   may be transparent, and --panel is the board own paper colour. */
.drawer-html-frame{display:block;width:100%;height:min(72vh,900px);border:0;background:var(--panel)}
.drawer-html-open{margin:10px 0 0;font-size:12px}
.drawer-html-open a{color:var(--accent)}
.html-note{border:1px solid var(--line);border-radius:8px;background:var(--chip);
  color:var(--ink-dim);padding:12px 14px;font-size:13px}

/* ---- the rendered artefact body (CF-03) ------------------------------- */
/* The reading measure lives on the CONTENT, not on the host, so the same
   .md-body class reads identically wherever a later story places it. */
.md-body{max-width:var(--measure);font-size:14px;line-height:1.62}
.md-body h1,.md-body h2,.md-body h3,.md-body h4{font-family:var(--font-display);
  font-weight:400;line-height:1.25;margin:1.4em 0 .4em}
.md-body h1{font-size:24px}
.md-body h2{font-size:20px}
.md-body h3{font-size:17px}
.md-body h4{font-size:15px}
.md-body p{margin:0 0 .85em}
.md-body ul,.md-body ol{margin:0 0 .85em;padding-left:1.35em}
.md-body li{margin:0 0 .28em}
.md-body ul ul,.md-body ol ol,.md-body ul ol,.md-body ol ul{margin:.28em 0 .28em}
.md-body .task-list{list-style:none;padding-left:1.1em}
.md-body .task-list input[type=checkbox]{margin-right:.5em}
.md-body blockquote{margin:0 0 .9em;padding:.1em 0 .1em 1em;
  border-left:3px solid var(--line);color:var(--ink-dim)}
.md-body code{font-family:var(--font-mono);font-size:12px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.md-body pre{background:var(--chip);border:1px solid var(--line);border-radius:8px;
  padding:12px 14px;overflow-x:auto;margin:0 0 .9em}
.md-body pre code{background:transparent;padding:0;font-size:12px}
.md-body hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
.md-body a{color:var(--accent)}
.md-table-wrap{overflow-x:auto;max-width:100%;margin:0 0 .9em}
/* width:100% is the SHIPPED rule (.md-prose table), carried rather than
   re-decided. Without it a table sizes to its content and stops short of the
   drawer's content box, which --drawer-measure-probe reads \u2014 correctly \u2014 as a
   full-bleed surface something is capping. Measured before this line: one
   table at 492px against a 616px content box, at both probe widths. */
.md-table{border-collapse:collapse;width:100%;font-size:13px}
.md-table th,.md-table td{border:1px solid var(--line);padding:5px 9px;text-align:left;vertical-align:top}
.md-table th{background:var(--chip);font-weight:600}
/* The body's own cross-reference buttons are the SAME affordance as the pills in
   the chrome section below \u2014 resolveCrossRefs emits ".xref-pill.xref-inline" \u2014
   so they inherit the one .xref-pill rule and differ only in sitting in a line
   of prose. */
.md-body .xref-inline{vertical-align:baseline}

/* ---- diagrams (STORY-33.3.03 \xB7 CF-10 \xB7 CF-36) ------------------------- */
/* A figure is the TERMINAL STATE made visible. data-mermaid-state is the
   contract the walk reads; the styling below only makes the two states tell
   themselves apart to a reader.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.mermaid-diagram{margin:0 0 1.1em;padding:0;border:1px solid var(--line);border-radius:8px;
  background:var(--panel);overflow:hidden}
.mermaid-diagram .mermaid-svg{padding:14px;overflow-x:auto;text-align:center}
.mermaid-diagram .mermaid-svg svg{max-width:100%;height:auto}
/* The source is never destroyed \u2014 it is one disclosure away on a rendered
   diagram, and shown outright on a failed one. */
.mermaid-diagram .mermaid-src{border-top:1px solid var(--line)}
.mermaid-diagram .mermaid-src > summary{cursor:pointer;padding:6px 12px;font-size:11px;
  letter-spacing:.05em;text-transform:uppercase;color:var(--ink-dim)}
.mermaid-diagram .mermaid-src pre{margin:0;border:0;border-radius:0}
/* A FAILED diagram must LOOK failed. The note is the difference between
   "broken" and "a collapsed disclosure nobody opened". */
.mermaid-diagram[data-mermaid-state=error]{border-color:var(--accent)}
.mermaid-diagram .mermaid-error-note{padding:8px 12px;font-size:12px;color:var(--ink-dim);
  background:var(--chip);border-bottom:1px solid var(--line)}
.mermaid-diagram[data-mermaid-state=error] pre{margin:0;border:0;border-radius:0}

/* ---- the MONITOR panel (STORY-33.7.03 \xB7 CF-05 \xB7 CF-11) ---------------- */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
.monitor-panel{max-width:var(--measure)}
.monitor-lead{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:14px 16px;margin:0 0 20px}
.monitor-lead-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin:0 0 6px}
.monitor-lead-when{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);flex:0 0 auto}
/* The headline is set in the DISPLAY face on purpose. On the old board it was in
   the code face only by inheriting a definition-list style (ADR-0114). */
.monitor-lead-title{font-family:var(--font-display);font-weight:400;font-size:19px;
  line-height:1.25;margin:0;flex:1 1 260px;min-width:0}
.monitor-lead-body{font-size:14px;line-height:1.6;color:var(--ink)}
.monitor-lead-body code,.monitor-entry code{font-family:var(--font-mono);font-size:12px;
  background:var(--chip);border-radius:4px;padding:.1em .35em}
.monitor-empty,.revision-empty{color:var(--ink-dim);font-size:13px;margin:0}
/* BUG-20260826-09: the 24px hit floor for the two monitor disclosures \u2014 REAL
   padding, not the .stale-notice-toggle overlay, because the revision list is an
   internal scroller (.revision-history, overflow-y:auto) and a transparent
   ::after clips at the scrollport edge: an instance whose summary sits within
   4px of the cut-off keeps a sub-24 hit area however tall the overlay claims to
   be. Hung on these two class-scoped selectors, not on bare summary, for the
   reason .stale-notice-toggle states. 16.5px line + 2 x 4px = 24.5px box. */
.monitor-more > summary,.monitor-entry-more > summary{cursor:pointer;font-size:11px;
  letter-spacing:.05em;text-transform:uppercase;color:var(--ink-dim);margin-top:4px;
  padding:4px 0}
.monitor-full,.monitor-entry-body{font-size:13px;line-height:1.6;margin-top:6px}

.revision-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin:0 0 8px}
.revision-title{font-family:var(--font-display);font-weight:400;font-size:16px;margin:0;
  flex:0 0 auto}
.revision-count{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);margin:0;
  flex:1 1 auto}
.revision-search{flex:0 0 240px;min-height:28px;padding:3px 10px;border:1px solid var(--line);
  border-radius:999px;background:var(--panel);color:var(--ink);font:inherit;font-size:13px}
.revision-search::placeholder{color:var(--ink-dim)}
.revision-search:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}

/* THE GEOMETRIC BOUND. The content bound is the PAGE_SIZE slice in monitor.jsx;
   this is the other half \u2014 the history scrolls inside itself, so the page height
   does not grow with the corpus. STORY-25.6.01 exists because it once did:
   190 entries, 42,716px. --assert-computed-style reads overflow-y here. */
.revision-history{max-height:var(--history-max-h);overflow-y:auto;overflow-x:hidden;
  border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.revision-history:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.monitor-entry{padding:9px 14px;border-bottom:1px solid var(--line)}
.monitor-entry:last-child{border-bottom:0}
.monitor-entry-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:9px}
.monitor-entry-when{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);flex:0 0 auto}
.monitor-entry-title{font-size:13px;flex:1 1 220px;min-width:0}

/* ---- shared surface primitives (STORY-33.7.01) ------------------------ */
/* The insight views all render PANELS rather than the records table, and the
   panel shell, its heading, its count bubble and its empty line are the same
   four things on every one of them. Declared once here so Now, Cadence and
   Reports cannot drift into three slightly different cards.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:14px 16px;min-width:0}
.panel > h3{font-family:var(--font-display);font-weight:400;font-size:16px;margin:0 0 10px;
  display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
/* SCOPED to a panel on purpose. The bare .empty class is already worn by markup
   this story does not own (the slice-empty note, the Build work lists), and an
   unscoped rule at the END of the sheet would silently restyle both \u2014 an
   undeclared visual change outside this story's surface.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.panel .empty{color:var(--ink-dim);font-size:13px;margin:0;line-height:1.55}
.count-bubble{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  background:var(--chip);border-radius:999px;padding:1px 8px}
.metric-val{font-family:var(--font-display);font-size:34px;line-height:1.05;margin:2px 0 0}
.metric-lab{font-size:12px;color:var(--ink-dim);margin:0 0 8px}
.metric-sub{font-size:12px;color:var(--ink-quiet);line-height:1.55;margin-top:6px}
.progress{height:6px;border-radius:999px;background:var(--chip);overflow:hidden}
/* THE BAR'S FALLBACK IS A NEUTRAL, not the brand accent (STORY-34.3.01). It painted
   var(--accent) #2F5D50, which measures CIE76 delta-E 11.8 from the done status's
   #0A6F66 - the same colour to a reader, on a 6px bar, for a metric about the
   statuses done is not. A bar that has DECLARED what it is about takes its colour
   from the status map (the generated block at the end of this sheet); a bar that has
   not declares nothing, and --ink-dim belongs to no status family, so it cannot be
   misread as one. BACKTICK-FREE ZONE: this comment is inside a template literal. */
.progress > span{display:block;height:100%;background:var(--ink-dim)}
dl.kv{margin:0;font-size:13px}
dl.kv .kv-row{display:flex;flex-wrap:wrap;gap:4px 10px;padding:3px 0;
  border-bottom:1px solid var(--line)}
dl.kv .kv-row:last-child{border-bottom:0}
dl.kv dt{font-family:var(--font-mono);font-size:12px;flex:0 0 auto;margin:0}
dl.kv dd{margin:0;color:var(--ink-dim);flex:1 1 200px;min-width:0}

/* ---- the Now page (STORY-33.7.01 \xB7 CF-15 \xB7 CF-06) --------------------- */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
.now-panel{min-width:0}
.flow-panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:14px 16px}
.flow-panel > h3{font-family:var(--font-display);font-weight:400;font-size:16px;
  margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.flow-variant-tag{font-size:11px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-dim)}
.flow-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
/* The stage is a real button: it navigates and presets, so it must be reachable
   by keyboard without a bespoke handler. The visual is a tile; the semantics are
   a control, and the platform supplies Enter and Space for free. */
.flow-stage{flex:1 1 96px;min-width:0;border:1px solid var(--line);border-radius:8px;
  background:var(--panel);color:var(--ink);font:inherit;text-align:left;
  padding:8px 10px;cursor:pointer}
.flow-stage:hover{background:var(--hover)}
.flow-stage:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.flow-stage-count{display:block;font-family:var(--font-display);font-size:22px;line-height:1.1}
.flow-stage-label{display:block;font-size:11px;color:var(--ink-dim);margin-top:2px}
.flow-arrow{flex:0 0 auto;color:var(--ink-quiet);font-size:13px;display:flex;
  flex-direction:column;align-items:center;line-height:1.1}
.flow-gate-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--ink-dim)}
.flow-loop{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;margin-top:10px;
  font-size:12px;color:var(--ink-dim)}
.flow-loop-glyph{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:999px;padding:1px 8px}

/* ONE ROW, two halves (ADR-0126). They wrap on a narrow viewport rather than
   overflowing: the claim is that they are one signal, not that they are always
   literally side by side at 320px. */
.signal-row{display:flex;flex-wrap:wrap;gap:14px;margin:16px 0}
.signal-row > .signal-progress,.signal-row > .signal-usage{flex:1 1 330px;min-width:0}
.signal-usage{display:flex}
.signal-usage > .usage-rollup{flex:1 1 auto}
.signal-share-wrap{margin-top:4px}
/* A DECLARED ABSENCE MUST LOOK DIFFERENT FROM A ZERO (CF-15). The sentence is
   set apart rather than dropped into the same dim run as the window line, so a
   reader can tell "there is nothing to move" from "nothing moved". */
.signal-absent,.usage-absent{color:var(--ink-dim);font-style:italic}
.usage-extras{margin-top:2px}
.usage-cumulative-note{color:var(--red)}

/* ---- the activity stream and the Timeline (STORY-33.7.02 \xB7 CF-04 \xB7 CF-37) --- */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
.now-widget{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:14px 16px;margin-top:16px;min-width:0}
.now-widget > h3{font-family:var(--font-display);font-weight:400;font-size:16px;margin:0 0 10px;
  display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.stream-doorway{margin-left:auto;font-size:12px;color:var(--accent);text-decoration:none;
  white-space:nowrap;position:relative}
/* BUG-20260826-09: the 24px hit area, the .stale-notice-toggle technique carried
   to the doorway link \u2014 the box the pointer hits grows, the glyphs do not. */
.stream-doorway::after{content:"";position:absolute;top:50%;left:0;
  transform:translateY(-50%);min-height:24px;height:100%;width:100%}
.stream-doorway:hover{text-decoration:underline}
.stream-doorway:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.stream-body{min-width:0}
/* THE ROW IS A FOUR-TRACK GRID and the first three tracks are FIXED, so
   .stream-title starts at the same x on every row however long the id is. That is
   the property --assert-column-aligned measures; a content-sized track would make
   it pass on some corpora and fail on others. */
.stream-row{display:grid;grid-template-columns:64px 132px 190px minmax(0,1fr);gap:10px;
  align-items:baseline;padding:5px 4px;border-bottom:1px solid var(--line);cursor:pointer}
.stream-row:last-child{border-bottom:0}
.stream-row:hover{background:var(--hover)}
.stream-row:focus-visible{outline:2px solid var(--focus-ring);outline-offset:-2px}
.stream-when{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
.stream-why{font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-dim)}
.stream-id{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* NOT TRUNCATED. --assert-not-truncated reads this element and fails on a clipped
   one in either axis, so the title WRAPS rather than being cut: overflow is
   visible, and the row's baseline alignment lets a two-line title grow the row. */
.stream-title{font-size:13px;min-width:0;overflow:visible;white-space:normal;
  overflow-wrap:anywhere}
.stream-daysubhead{font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink-dim);padding:10px 4px 4px;
  border-bottom:1px solid var(--line)}
.stream-daysubhead:first-child{padding-top:0}
/* THE HONEST CAP. Every row is in the DOM; the ones outside the window are hidden
   here and the +N more control removes the class, so badge === visible + advertised
   === rows in the DOM stays literally true (CF-04). */
.is-overflow{display:none}
.stream-more-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;padding-top:10px}
.stream-more{min-height:28px;padding:3px 12px;border:1px solid var(--line);border-radius:999px;
  background:var(--panel);color:var(--ink);font:inherit;font-size:12px;cursor:pointer}
.stream-more:hover{background:var(--hover)}
.stream-more:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.timeline-view{margin-top:0}
.timeline-body{max-height:none}

/* ---- the command-flow strip and its affordance (STORY-33.7.02 \xB7 CF-38) ----- */
/* THE FADES ARE PAINTED BY THESE RULES, FROM CLASSES ON THE WRAPPER \u2014 never from
   component state. --strip-affordance-walk plants class lies by hand (adds
   .at-start at the right extreme, drops .can-scroll) and requires the COMPUTED
   OPACITY to follow, because "the class is present" and "the fade paints" are
   different claims and only the second is the feature.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.cmd-flow-panel{margin-top:0}
.cmd-flow-scroller{position:relative;min-width:0}
.cmd-flow-phases{display:flex;align-items:stretch;gap:10px;overflow-x:auto;overflow-y:hidden;
  padding:2px 0 10px;scrollbar-width:thin}
.cmd-flow-phases:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.cmd-phase{flex:0 0 240px;min-width:0;border:1px solid var(--line);border-radius:8px;
  background:var(--panel);padding:9px 11px}
.cmd-phase-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
.cmd-phase-label{font-family:var(--font-display);font-size:15px}
.cmd-phase-hat,.cmd-phase-gate{font-size:11px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink-dim);background:var(--chip);border-radius:999px;padding:1px 7px}
.cmd-phase-desc{font-size:12px;color:var(--ink-dim);line-height:1.5;margin-top:4px}
.cmd-phase-pills{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.cmd-pill{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:999px;padding:1px 7px}
.cmd-pill.ambient{color:var(--ink-dim);font-style:italic}
.cmd-phase-arrow{flex:0 0 auto;align-self:center;color:var(--ink-quiet);font-size:13px}
/* Both fades default to DARK. The affordance is the exception, not the norm \u2014 a
   strip that fits paints neither, which is the third state AC-1 names and the one
   the synthetic-fits arm drives. */
.cmd-flow-fade{position:absolute;top:0;bottom:10px;width:44px;pointer-events:none;
  opacity:0;transition:opacity .18s ease}
.cmd-flow-fade.start{left:0;background:linear-gradient(to right,var(--paper),transparent)}
.cmd-flow-fade.end{right:0;background:linear-gradient(to left,var(--paper),transparent)}
.cmd-flow-scroller.can-scroll:not(.at-start) .cmd-flow-fade.start{opacity:1}
.cmd-flow-scroller.can-scroll:not(.at-end) .cmd-flow-fade.end{opacity:1}

/* ---- Cadence: Releases and Reviews (STORY-33.7.04 \xB7 CF-12 \xB7 CF-13) -------- */
/* THE CARD GRID IS THE UNIFORM SHAPE. It is a separate class from .tile-grid on
   purpose: --assert-cards-with hardcodes ".card-grid .card" as its population, so
   the name is an anchor rather than a styling choice.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  gap:12px;align-items:start}
.card-grid .card{min-width:0;border:1px solid var(--line);border-radius:8px;
  background:var(--panel);padding:11px 13px;cursor:pointer}
.card-grid .card:hover{background:var(--hover)}
.card-grid .card:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.card-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;margin-bottom:6px}
.card-kind-badge{font-size:11px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--ink-dim);background:var(--chip);border-radius:999px;padding:1px 7px}
.ext-badge{font-family:var(--font-mono);font-size:11px;text-transform:uppercase;
  color:var(--ink-dim);border:1px solid var(--line);border-radius:4px;padding:0 4px}
.card-grid .card-title{font-size:14px;line-height:1.35;overflow-wrap:anywhere}
.card-meta-date{font-family:var(--font-mono);font-size:11px;color:var(--ink-quiet);margin-top:4px}
.card-summary{font-size:12px;color:var(--ink-dim);line-height:1.55;margin-top:7px}
.release-version{font-family:var(--font-mono);font-size:12px}
/* A CARD's status pill is not the interactive sub-nav pill. The bare .pill rule is
   the 28px cursor:pointer nav control, and its size-down override is scoped to
   .tile \u2014 a card-grid card is not a tile, so without this the status on every
   release card rendered at nav size and lit up on hover as if it were clickable. */
.card-grid .card .pill{min-height:20px;padding:1px 8px;font-size:11px;cursor:inherit}
.card-grid .card .pill:hover{background:var(--chip)}
.card-date-absent{color:var(--ink-dim);font-style:italic}
.release-status{margin-top:7px}
/* A DECLARED VERDICT and a DECLARED ABSENCE must not look alike (ADR-0131). The
   first is a row of counted severities; the second is a sentence, set apart. */
.card-verdict{display:flex;flex-wrap:wrap;gap:5px;align-items:baseline;margin-top:7px}
.verdict-label{font-size:11px;letter-spacing:.04em;text-transform:uppercase;
  background:var(--chip);border-radius:999px;padding:1px 8px}
.verdict-count{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  border:1px solid var(--line);border-radius:4px;padding:0 5px;white-space:nowrap}
/* DE-EMPHASISE ZEROS \u2014 the SHIPPED contract, not its inverse. The port first
   EMPHASISED non-zeros in the severity palette, which painted "3 nit" in the red a
   blocker gets: a colour asserting a severity the record never declared, which is a
   mild form of the thing CF-13 exists to prevent. data-severity is still emitted,
   for a reader and for a future rule; nothing reads it as urgency today. */
.verdict-count[data-zero="1"]{color:var(--ink-quiet)}
.card-noverdict{font-size:12px;color:var(--ink-dim);font-style:italic;margin-top:7px}
.review-linked{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
.releases-count-line,.reviews-count-line,.audits-count-line{margin:0 0 10px}

/* ---- the Reports finder and its sections (STORY-33.7.05 \xB7 CF-22 \xB7 CF-14) --- */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
.reports-view{min-width:0}
.view-intro{margin:0 0 14px}
.vi-title{font-family:var(--font-display);font-size:18px}
.vi-source,.vi-why{font-size:12px;color:var(--ink-dim);line-height:1.6;margin-top:4px}
.vi-source code,.vi-why code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
/* A cross-link is a BUTTON because it routes through the shell rather than through
   an href \u2014 one navigation mechanism, not two. It is styled as a link so a reader
   reads it as one. */
.reports-xref{border:0;background:none;padding:0;font:inherit;font-size:inherit;
  color:var(--accent);cursor:pointer;text-decoration:underline}
.reports-xref:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.controls{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin:0 0 14px}
.search{flex:1 1 260px;min-height:30px;padding:4px 12px;border:1px solid var(--line);
  border-radius:999px;background:var(--panel);color:var(--ink);font:inherit;font-size:13px}
.search::placeholder{color:var(--ink-dim)}
.search:focus-visible{outline:2px solid var(--focus-ring);outline-offset:1px}
.reports-total,.reports-shown{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
.report-section{margin:0 0 20px}
.report-kind-head{display:flex;align-items:baseline;gap:8px;margin:0 0 8px;
  padding-bottom:4px;border-bottom:1px solid var(--line)}
.report-kind-label{font-family:var(--font-display);font-size:15px}
.report-kind-count{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
/* A DERIVED slot is a stated absence, not the artefact's own words, and it must not
   read like one. The distinction is what CF-14 is about: a card that degraded and a
   card that did not must be tellable apart at a glance. */
.card-title[data-derived="1"],.card-meta-date[data-derived="1"],
.card-summary[data-derived="1"]{color:var(--ink-dim);font-style:italic}
/* ---- Reviews, denser (STORY-34.1.04 \xB7 ADR-0285) --------------------------
   cadence&sub=reviews measured 2,823px from 30 report cards at ~214px in a
   three-column grid \u2014 the same card-height class as the catalogue, and the row
   this story owns in the waiver table. SCOPED TO .reviews-surface, never to
   .card-grid .card : that selector is --assert-cards-with's hardcoded
   population and is shared with Reports and Cadence - Audits, which this story
   has no business restyling. The summary clamps to three lines; the card keeps
   every one of its anchors (.card-head, .card-kind-badge, .card-title,
   .card-meta-date, .card-verdict, .card-verdict-slot, .card-summary).
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.reviews-surface .card-grid{gap:9px}
.reviews-surface .card-grid .card{padding:9px 11px}
.reviews-surface .card-head{margin-bottom:4px}
.reviews-surface .card-grid .card-title{font-size:13px;line-height:1.3}
.reviews-surface .card-meta-date{margin-top:2px}
.reviews-surface .card-summary{margin-top:5px;line-height:1.45;display:-webkit-box;
  -webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}

/* ---- Build - Phases (STORY-33.8.01 - CF-26 - CF-27) ---------------------- */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
/* THE [hidden] OVERRIDE IS LOAD-BEARING, NOT TIDINESS. The .track-pane rule sets
   display, and a class selector beats the UA stylesheet's bare [hidden] rule -
   so without this line the "hidden" pane keeps a layout box, offsetParent stays
   non-null, and --strategy-tracks-walk's three visibility assertions all read the
   wrong answer while the markup looks right. */
.track-pane{display:block}
.track-pane[hidden]{display:none}
.track-switch{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 14px}
.track-btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);
  border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}
.track-btn[aria-selected="true"]{background:var(--accent);color:var(--accent-ink);
  border-color:var(--accent)}
.track-btn:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.track-note{font-size:11px;color:var(--ink-dim)}
.phase-cat{margin:0 0 22px}
.phase-cat-h{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin:0 0 10px;
  padding-bottom:4px;border-bottom:1px solid var(--line)}
.phase-cat-lab{font-family:var(--font-display);font-size:15px}
.phase-cat-count{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
.phase-cat-why{font-size:11px;color:var(--ink-dim);flex:1 1 240px;min-width:0}
.phase-group,.run-group{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:12px;margin:0 0 12px}
/* COLLAPSED IS THE DEFAULT, so it is the state that gets the tight box (STORY-34.1.03).
   A collapsed phase is a ROW, not a card: eighty of them at the expanded box's 12px
   padding + 12px margin is 5,280px of chrome around 28px of content. Expanded phases
   keep the card, because then there is something inside the box to frame. */
.phase-group:not(.expanded){padding:5px 12px;margin:0 0 4px}
.phase-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.phase-toggle{flex:none;border:1px solid var(--line);border-radius:6px;background:var(--panel);
  color:var(--ink);font:inherit;font-size:11px;line-height:1;padding:3px 6px;cursor:pointer;
  position:relative}
.phase-toggle .chev{display:inline-block;transition:transform .18s ease;color:var(--ink-dim)}
.phase-toggle[aria-expanded="true"] .chev{transform:rotate(90deg)}
.phase-toggle:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.phase-body{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)}
.phase-title{font-family:var(--font-display);font-size:14px;min-width:0}
.run-kind-tag{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  border:1px solid var(--line);border-radius:4px;padding:0 5px;white-space:nowrap}
.phase-epic-chip,.story-chip{font-family:var(--font-mono);font-size:11px;cursor:pointer;
  border:1px solid var(--line);border-radius:4px;padding:1px 6px;background:var(--chip);
  color:var(--ink);position:relative}
/* WCAG 2.2 SC 2.5.8 - a 24x24 HIT TARGET without a 24px-tall chip. The overlay is
   the same technique the stale-notice summary uses: the box the pointer hits grows,
   the box the reader sees does not, and --target-size-probe measures the overlay
   because that is what a finger actually lands on. Measured before: 56x17 chips and
   a 53x22.5 Open button, both below the floor. */
.phase-epic-chip::after,.story-chip::after,.phase-open-btn::after,.phase-toggle::after{
  content:"";position:absolute;
  top:50%;left:50%;transform:translate(-50%,-50%);min-width:24px;min-height:24px;
  width:100%;height:100%}
.phase-epic-chip:focus-visible,.story-chip:focus-visible,.phase-open-btn:focus-visible{
  outline:2px solid var(--focus-ring);outline-offset:2px}
.phase-h .cnt{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim)}
.phase-open-btn{margin-left:auto;border:1px solid var(--line);border-radius:999px;
  background:var(--panel);color:var(--ink);font:inherit;font-size:11px;padding:2px 12px;
  cursor:pointer;position:relative}
.phase-outcome{margin:8px 0 0;font-size:12px;color:var(--ink-dim);line-height:1.6}
.phase-chats{margin-top:10px}
.chat-tile{border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:10px;
  cursor:pointer;min-width:0}
.chat-tile:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.chat-tile-head{display:flex;align-items:center;gap:8px;min-width:0}
.chat-tile-title{font-size:13px;margin-top:4px;min-width:0}
.chat-tile-meta{font-size:11px;color:var(--ink-dim);margin-top:6px}
.chat-tile-meta .lab{font-family:var(--font-mono);font-size:11px;text-transform:uppercase;
  letter-spacing:.05em}
/* The kit-only chat telemetry (STORY-34.1.03 AC-5). Figures in full, never
   abbreviated - the rule lives in src/tokens.js (ADR-0255), not here. */
.chat-tok{font-family:var(--font-mono);font-size:11px}
.story-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.run-chats{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.run-chat-chip{font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  border:1px solid var(--line);border-radius:4px;padding:1px 6px}
.phase-drawer-facts{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 12px;
  font-size:12px}
.phase-drawer-facts dt{color:var(--ink-dim);font-family:var(--font-mono);font-size:11px}
.phase-drawer-facts dd{margin:0;min-width:0}
.phase-drawer-lead{font-family:var(--font-display);font-size:16px;margin:0 0 10px}
.phase-drawer-desc,.phase-drawer-outcome,.chat-drawer-outcome,.chat-drawer-trigger{
  font-size:13px;line-height:1.7;margin:0 0 10px}
.chat-drawer-h{font-family:var(--font-display);font-size:14px;margin:14px 0 6px}
.chat-drawer-stories{margin:0;padding-left:20px;font-family:var(--font-mono);font-size:11px}
/* ---- Toolkit: the fit-ordered catalogue (STORY-33.8.02 - CF-41) ---------- */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
/* NO ENTRANCE ANIMATION ON THE CARDS. The old board staggered them from opacity 0
   with per-child delays up to 200ms, against a probe that samples after 70ms - so
   a card still at zero is silently dropped from the ordering census and neither
   passes nor fails. A card nobody counted is a card whose placement was never
   verdicted. */
.ai-catalogue{min-width:0}
.ai-fit-group{margin:0 0 22px}
.ai-fit-group.kit-pinned .grp-h .dot{background:var(--accent)}
/* ---- DENSE RANKED ROWS (STORY-34.1.04 \xB7 PRD R4 \xB7 ADR-0285) ---------------
   The grid becomes a LIST. .card-grid.tight and .tile-grid keep their names
   because both are probe anchors \u2014 --toolkit-tier-order-probe plants its
   ordering mutant into .card-grid / .tile-grid, and --assert-cards-with's
   hardcoded .card-grid .card population is unaffected because a catalogue row
   is not a .card. The one-column override is scoped INSIDE .ai-catalogue so
   Cadence and Reports keep their grids untouched.
   Measured before: 175 cards at 161px in three columns = 10,625px.
   align-items:stretch is LOAD-BEARING (BUG-20260901-08): the base .card-grid and
   .tile-grid rules declare align-items:start for their GRID form, and in this
   column-flex form that same declaration sizes every row to its own max-content
   width instead of the container - nowrap text then walks the row past the page
   edge (measured 2,025px/3,963px scrollWidth against a 1,425px client) and the
   ellipsis on .desc and .tile-title never engages because nothing constrains
   them. Stretch pins each row to the container width, which is what lets the
   flexed cells inside it clip.
   BACKTICK-FREE ZONE: this comment is inside a template literal. */
.ai-catalogue .card-grid.tight,.ai-catalogue .tile-grid{display:flex;flex-direction:column;
  gap:0;grid-template-columns:none;align-items:stretch}
.ai-card{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:10px;
  cursor:pointer;min-width:0;display:flex;flex-direction:column;gap:5px}
.ai-card:focus-visible,.plugin-tile:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.ai-card .name{font-family:var(--font-display);font-size:13px;min-width:0;word-break:break-word}
.ai-card .desc{font-size:12px;color:var(--ink-dim);line-height:1.5;min-width:0}
.ai-next{font-size:11px;color:var(--ink-dim)}
.ai-next code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.ai-card .footer{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:auto}
/* THE ROW ITSELF. Name and rank hold their width; the description takes what is
   left and clips to one line \u2014 the full text stays in the DOM (and in the
   drawer), so nothing that reads textContent loses it. */
.ai-catalogue .ai-row{flex-direction:row;align-items:center;gap:12px;padding:5px 10px;
  border-radius:0;border-width:0 0 1px 0;background:transparent}
.ai-catalogue .ai-row:first-child{border-top:1px solid var(--line)}
.ai-catalogue .ai-row:hover{background:var(--hover)}
.ai-catalogue .ai-row .name{flex:0 0 auto;max-width:34%;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;word-break:normal}
.ai-catalogue .ai-row .desc{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;line-height:1.4}
.ai-catalogue .ai-row .footer{flex:0 0 auto;margin-top:0;flex-wrap:nowrap}
.ai-catalogue .ai-row .ai-cost{font-family:var(--font-mono);font-size:11px}
.fit-badge{font-family:var(--font-mono);font-size:11px;border:1px solid var(--line);
  border-radius:4px;padding:0 5px;white-space:nowrap}
.fit-badge.HIGH{border-color:var(--accent);color:var(--accent)}
.plugin-tile{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:10px;
  cursor:pointer;min-width:0}
/* The plugin row is denser WITHOUT restructuring .tile-head - that flex row is
   shared with the Build work-list tiles and the phases chat tiles, and its
   align-items:stretch is ADR-0254 \xA73, measured to keep --assert-single-line at
   topDelta 0. Scoped rules only; the markup is untouched (BACKLOG-0177's trigger
   therefore does NOT fire \u2014 recorded in that item). */
.ai-catalogue .plugin-tile{display:flex;align-items:center;gap:12px;padding:5px 10px;
  border-radius:0;border-width:0 0 1px 0;background:transparent}
.ai-catalogue .plugin-tile:first-child{border-top:1px solid var(--line)}
.ai-catalogue .plugin-tile:hover{background:var(--hover)}
.ai-catalogue .plugin-tile .tile-head{flex:0 0 auto;align-items:center}
.ai-catalogue .plugin-tile .tile-title{flex:1 1 auto;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;margin:0}
/* An empty ranked group still states its identity and its real count; the row
   area collapses rather than the heading disappearing. */
.ai-fit-group[data-page-empty="1"] .card-grid,
.ai-fit-group[data-page-empty="1"] .tile-grid{display:none}
.ai-fit-group[data-page-empty="1"]{margin-bottom:10px}
/* The card detail, in the drawer where it moved. */
.ai-facts{margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid var(--line)}
.ai-facts .drawer-meta{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}
.ai-facts .ai-next{margin:0 0 6px}
.ai-facts .ai-tags{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}
.ai-facts .ai-desc-full{font-size:12.5px;line-height:1.6;color:var(--ink-dim);margin:0}
.ai-facts .ai-file{font-family:var(--font-mono);font-size:11px;overflow-wrap:anywhere}
.grp-h .dot{width:8px;height:8px;border-radius:999px;background:var(--ink-faint);flex:0 0 auto}
.grp-h .path{font-family:var(--font-display);font-size:14px;min-width:0}

/* ---- About: sourced facts, nothing written (STORY-33.8.02 - CF-39) ------- */
/* NO reveal CLASS HERE. That class starts at opacity 0 until a script adds the
   visible class, and --about-probe requires the tandem and project panels to be
   VISIBLE by __smokeVisible, which fails on opacity 0 anywhere up the ancestor
   chain. A panel that animates in is a panel the probe reports as absent. */
.about-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;
  align-items:start}
.about-section{min-width:0}
.about-section h3{font-family:var(--font-display);font-size:15px;margin:0 0 8px}
.about-blurb{font-size:12px;color:var(--ink-dim);line-height:1.6;margin:0 0 10px}
.about-section .kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:12px}
.about-section .kv dt{color:var(--ink-dim);min-width:0}
.about-section .kv dd{margin:0;min-width:0;word-break:break-word}
.about-section .kv dd code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.about-unresolved{color:var(--ink-dim);font-style:italic}
.about-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;font-size:12px}
.about-links a{color:var(--accent);position:relative}
/* WCAG 2.2 SC 2.5.8 - the same 24px hit overlay the phase chips use. An 18px-tall
   link is comfortably readable and is not comfortably tappable, and the gap is the
   whole of what SC 2.5.8 measures. Caught by --target-size-probe at this story's
   own gate rather than at the convergence pass. */
.about-links a::after{content:"";position:absolute;top:50%;left:50%;
  transform:translate(-50%,-50%);min-width:24px;min-height:24px;width:100%;height:100%}
.kbd{font-family:var(--font-mono);font-size:11px;border:1px solid var(--line);border-radius:4px;
  padding:0 5px;background:var(--chip)}

/* ---- Project Wiki: the full-page reading view (STORY-33.8.03 - CF-51/CF-52) - */
/* BACKTICK-FREE ZONE: this comment is inside a template literal. */
/* NO reveal CLASS ON ANY OF THIS, and no entrance animation. reveal starts at
   opacity 0 until a script adds visible, and __smokeVisible fails on zero opacity
   anywhere up the ancestor chain - so an animating reading pane reads to the walk
   as zero documents visible, which is the state it counts as broken.
   NOTHING HERE SETS display ON .wiki-doc EITHER. Exactly one article is readable
   at a time and the mechanism is the hidden ATTRIBUTE; a display rule on the
   article would beat the UA stylesheet and put all eleven on screen at once. */
.wiki-layout{display:grid;grid-template-columns:minmax(200px,260px) minmax(0,1fr);gap:18px;
  align-items:start;min-width:0}
.wiki-index{position:sticky;top:0;min-width:0;display:flex;flex-direction:column;gap:2px;
  padding:10px;max-height:calc(100vh - 120px);overflow-y:auto}
.wiki-index-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
  font-family:var(--font-display);font-size:13px;margin:0 0 4px}
.wiki-census{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}
.wiki-census-cell{font-family:var(--font-mono);font-size:11px;border:1px solid var(--line);
  border-radius:4px;padding:0 5px;color:var(--ink-dim);white-space:nowrap}
.wiki-census-cell[data-wiki-census-key="flagged"]{border-color:var(--red);color:var(--red)}
/* WCAG 2.2 SC 2.5.8 - the index entries are the navigation of this view, so they
   carry a real 24px-high target rather than the height a 12px label happens to
   make. Padding, not an overlay: these are stacked block links, so growing the box
   is honest and an overlay would collide with its neighbours. */
.wiki-index-link{display:block;padding:6px 8px;border-radius:6px;color:var(--ink);
  min-height:24px;box-sizing:border-box;min-width:0}
.wiki-index-link:hover{background:var(--hover)}
.wiki-index-link:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.wiki-index-link.active{background:var(--chip);box-shadow:inset 2px 0 0 var(--accent)}
.wiki-index-title{display:block;font-size:12px;min-width:0;word-break:break-word}
.wiki-index-file{display:block;font-family:var(--font-mono);font-size:11px;color:var(--ink-dim);
  min-width:0;word-break:break-word}
.wiki-reading{min-width:0}
.wiki-doc{min-width:0}
.wiki-doc-head{margin:0 0 10px}
.wiki-doc-title{font-family:var(--font-display);font-size:20px;margin:0 0 4px;min-width:0;
  word-break:break-word}
.wiki-doc-meta{font-size:11px;color:var(--ink-dim);min-width:0;word-break:break-word}
.wiki-doc-meta code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.wiki-drift{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:10px;margin:0 0 16px;min-width:0}
.wiki-drift[data-wiki-doc-state="flagged"]{border-color:var(--red)}
.wiki-drift-head{font-family:var(--font-display);font-size:13px;margin:0 0 4px}
.wiki-drift-note{font-size:11px;color:var(--ink-dim);line-height:1.6;margin:0}
.wiki-drift-note code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.wiki-flags{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.wiki-flag{display:flex;flex-direction:column;gap:2px;min-width:0}
.wiki-flag-kind{font-family:var(--font-mono);font-size:11px;color:var(--red)}
/* THE EVIDENCE LINE IS THE FLAG, so it is body-sized and full-width prose, never a
   tooltip or a clamped line. A verdict whose reason is a hover away is the bare
   warning CF-52 forbids. */
.wiki-flag-evidence{font-size:12px;line-height:1.6;min-width:0;word-break:break-word}
.wiki-flag-dismissal{font-size:11px;color:var(--ink-dim);line-height:1.6;min-width:0;
  word-break:break-word}
.wiki-flag.is-dismissed .wiki-flag-kind{color:var(--ink-dim)}
.wiki-doc-body{min-width:0}
.wiki-doc-foot{margin-top:18px;padding-top:10px;border-top:1px solid var(--line);
  font-size:11px;color:var(--ink-dim);line-height:1.6;min-width:0;word-break:break-word}
.wiki-doc-foot code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.wiki-empty{padding:14px;min-width:0}
.wiki-empty .empty{font-size:12px;color:var(--ink-dim);line-height:1.6}
.wiki-empty code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
@media (max-width:900px){.wiki-layout{grid-template-columns:minmax(0,1fr)}
  .wiki-index{position:static;max-height:none}}

/* ---- The stale-run notice, above the board (STORY-33.8.03 / STORY-29.1.04) --- */
.diag{margin:0 0 14px;display:flex;flex-direction:column;gap:8px;min-width:0}
.diag-inner{border:1px solid var(--line);border-radius:8px;background:var(--panel);
  padding:10px;font-size:12px;line-height:1.6;min-width:0;word-break:break-word}
.diag-inner.warn{border-color:var(--red)}
.diag-note{font-size:11px;color:var(--ink-dim);line-height:1.6;margin-top:4px;min-width:0;
  word-break:break-word}
.diag-inner code{font-family:var(--font-mono);font-size:11px;background:var(--chip);
  border-radius:4px;padding:.1em .35em}
.diag-inner ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
/* STORY-30.6.01 - the 24px hit area, hung on the CLASS rather than on a bare
   summary selector, which would also catch every diagram-source disclosure inside
   a drawer - a different shape with a different layout contract. */
.stale-notice-toggle{cursor:pointer;position:relative;font-size:12px}
.stale-notice-toggle:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.stale-notice-toggle::after{content:"";position:absolute;top:50%;left:0;
  transform:translateY(-50%);min-height:24px;height:100%;width:100%}
`;
function buildCss() {
  return assertNoRemoteUrls(brandFontFaces() + SHELL + "\n" + statusCss() + "\n");
}

// lib/config.mjs
var import_node_path11 = __toESM(require("node:path"), 1);
var import_node_module10 = require("node:module");

// lib/nav.mjs
var import_node_path = __toESM(require("node:path"), 1);
var import_node_module2 = require("node:module");
var require3 = (0, import_node_module2.createRequire)(__boardAssembleUrl);
var NAV_DECLARATION = {
  now: ["thisWeek"],
  "capture:inbox": ["inbox"],
  "capture:backlog": ["backlog"],
  "plan:strategy": ["strategy"],
  "plan:roadmap": ["epic", "feature"],
  "plan:specs": ["specs"],
  "build:phases": [],
  "build:epic": ["epic"],
  "build:feature": ["feature"],
  "build:story": ["story"],
  "build:testplan": ["testplan"],
  "build:bug": ["bug"],
  "cadence:monitor": ["monitorEntries"],
  "cadence:timeline": ["thisWeek"],
  "cadence:retros": ["retro"],
  "cadence:releases": ["release"],
  "cadence:reviews": ["reviews"],
  "cadence:audits": ["audits"],
  decisions: ["adr"],
  reports: ["reports"],
  wiki: ["docs"],
  // The four catalogue sub-views: their arrays live under the payload's nested
  // `ai` bag, not at the top level, so there is no top-level key to name yet.
  // STORY-33.8.02 renders this surface and decides how the nested shape is
  // addressed; declaring `[]` keeps them routable until it does.
  "toolkit:skill": [],
  "toolkit:agent": [],
  "toolkit:command": [],
  "toolkit:plugin": [],
  "toolkit:templates": ["templates"],
  "toolkit:prompts": ["prompts"],
  "toolkit:scripts": ["scripts"],
  "toolkit:glossary": ["glossary"],
  tandem: [],
  about: []
};
var PANEL_NAMES = [
  "landing",
  "monitor",
  "timeline",
  "command-flow",
  "releases",
  "reviews",
  "audits",
  "corpus-finder",
  "execution-phases",
  "ai-catalogue",
  "about-facts",
  "document-reader",
  "term-index"
];
var PANEL_DECLARATION = {
  now: "landing",
  "cadence:monitor": "monitor",
  "cadence:timeline": "timeline",
  "cadence:releases": "releases",
  "cadence:reviews": "reviews",
  "cadence:audits": "audits",
  reports: "corpus-finder",
  tandem: "command-flow",
  // STORY-33.8.01 - Build's phase surface. The NAME is not the sub key: a panel
  // called `phases` would put that literal into the bundle as a bare key, and the
  // name should say what the panel IS rather than which view hosts it (the
  // `corpus-finder` precedent directly above).
  "build:phases": "execution-phases",
  // STORY-33.8.02 - the four catalogue sub-views share ONE panel, which reads the
  // sub key off the shell rather than holding four entries that differ only in a
  // list name. `about` is its own, because it renders facts rather than a list.
  "toolkit:skill": "ai-catalogue",
  "toolkit:agent": "ai-catalogue",
  "toolkit:command": "ai-catalogue",
  "toolkit:plugin": "ai-catalogue",
  // BUG-20260901-09 - the glossary. Its payload is [term, definition] pairs, not
  // artefact records, and the generic record table asks title/status/created_at of
  // each one - so all 30 data rows read "(no title)" under a header claiming 30
  // records. A purpose-built panel renders the shape the data actually is. The
  // NAME says what the panel IS (an index of terms), not which view hosts it -
  // the `corpus-finder` precedent.
  "toolkit:glossary": "term-index",
  about: "about-facts",
  // STORY-33.8.03 - the Project Wiki's full-page reading view. The NAME says what
  // the panel IS rather than which view hosts it, for the `corpus-finder` reason
  // directly above and for one more that is mechanical: `nav-single-source.test.js`
  // requires the BUILT BUNDLE to spell ZERO rail group ids, and a panel named after
  // its view would put that id into `PANELS_BY_NAME` as a quoted key.
  wiki: "document-reader"
};
function buildNav(o) {
  const gen = require3(import_node_path.default.join(o.scriptsDir, "generate-dashboard.js"));
  const decl = o.declaration || NAV_DECLARATION;
  const railGroups = gen.RAIL_GROUPS || [];
  const subNav = gen.SUB_NAV_GROUPS || {};
  if (railGroups.length < 9) {
    throw new Error("the generator declared only " + railGroups.length + " rail group(s); the board contract is >= 9");
  }
  const groups = railGroups.map(([id, label, band, icon]) => {
    const declaredSubs = subNav[id] || [];
    const subs = declaredSubs.map(([key, subLabel]) => {
      return { key, label: subLabel, keys: decl[id + ":" + key] || [] };
    });
    const ownKeys = subs.length ? [...new Set(subs.flatMap((s) => s.keys))] : decl[id] || [];
    return {
      id,
      label,
      band,
      icon,
      subs,
      // The UNION of its sub-views' key lists, de-duplicated: `plan:roadmap` and
      // `build:epic` both name `epic`, and a group that listed it twice would
      // badge a corpus that does not exist.
      keys: ownKeys,
      defaultSub: subs.length ? subs[0].key : null
    };
  });
  const routes = {};
  for (const g of groups) routes[g.id] = g.subs.map((s) => [s.key, s.label]);
  const panelDecl = PANEL_DECLARATION;
  const addressable = /* @__PURE__ */ new Set();
  for (const g of groups) {
    if (g.subs.length) for (const s of g.subs) addressable.add(g.id + ":" + s.key);
    else addressable.add(g.id);
  }
  const panels = {};
  const unknownPanels = [];
  const unknownNames = [];
  for (const [k, name] of Object.entries(panelDecl)) {
    if (!addressable.has(k)) {
      unknownPanels.push(k);
      continue;
    }
    if (PANEL_NAMES.indexOf(name) === -1) {
      unknownNames.push(k + " -> " + name);
      continue;
    }
    panels[k] = name;
  }
  if (unknownPanels.length || unknownNames.length) {
    throw new Error("PANEL_DECLARATION is not consistent with the board: " + (unknownPanels.length ? "view(s) the rail does not have: " + unknownPanels.join(", ") + ". " : "") + (unknownNames.length ? "panel name(s) the runtime does not implement: " + unknownNames.join(", ") + "." : ""));
  }
  return {
    groups,
    routes,
    panels,
    views: groups.map((g) => g.id),
    defaultGroup: groups[0].id
  };
}
function navDrift(o) {
  const gen = require3(import_node_path.default.join(o.scriptsDir, "generate-dashboard.js"));
  const decl = o.declaration || NAV_DECLARATION;
  const subNav = gen.SUB_NAV_GROUPS || {};
  const known = /* @__PURE__ */ new Set();
  for (const [id] of gen.RAIL_GROUPS || []) {
    known.add(id);
    for (const [key] of subNav[id] || []) known.add(id + ":" + key);
  }
  const orphanDeclared = Object.keys(decl).filter((k) => !known.has(k));
  const missing = [];
  for (const [id] of gen.RAIL_GROUPS || []) {
    const subs = subNav[id] || [];
    if (subs.length) {
      for (const [key] of subs) {
        if (!Object.prototype.hasOwnProperty.call(decl, id + ":" + key)) missing.push(id + ":" + key);
      }
      if (Object.prototype.hasOwnProperty.call(decl, id)) orphanDeclared.push(id + " (group has sub-views; declare them, not it)");
    } else if (!Object.prototype.hasOwnProperty.call(decl, id)) {
      missing.push(id);
    }
  }
  return { orphanDeclared, missing };
}

// lib/legacy-routes.mjs
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_module3 = require("node:module");
var require4 = (0, import_node_module3.createRequire)(__boardAssembleUrl);
function liftLegacyRoutes(scriptsDir) {
  const gen = require4(import_node_path2.default.join(scriptsDir, "generate-dashboard.js"));
  const routes = gen.LEGACY_ROUTES;
  if (!routes || typeof routes !== "object" || !Object.keys(routes).length) {
    throw new Error("the shipped generator exports no LEGACY_ROUTES table (or an empty one); refusing to ship a board that silently drops every v1.0 link (STORY-33.9.05 moved the declaration onto the export surface)");
  }
  const aliases = gen.SUB_ALIASES || {};
  if (!Object.keys(aliases).length) {
    throw new Error("the generator exported no SUB_ALIASES; the plural sub-key spellings used in shared slice hashes would stop resolving");
  }
  return { routes, aliases };
}

// lib/mermaid-asset.mjs
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
function mermaidBundle(scriptsDir) {
  const file = import_node_path3.default.join(scriptsDir, "assets", "mermaid.min.js");
  let src;
  try {
    src = import_node_fs2.default.readFileSync(file, "utf8");
  } catch (_e) {
    return { js: "", reason: "not vendored at " + file };
  }
  if (/<\/script/i.test(src)) {
    return { js: "", reason: 'the vendored bundle contains "</script" \u2014 refusing to inline it' };
  }
  return { js: src, reason: "" };
}
function cssToken(css, name) {
  const m = String(css).match(new RegExp("--" + name + "\\s*:\\s*([^;}]+)[;}]"));
  if (!m) {
    throw new Error("[board:build] token --" + name + " not found in the assembled stylesheet \u2014 diagram theming cannot be derived, and shipping mermaid's stock theme is the outcome CF-36 forbids");
  }
  return m[1].trim();
}
function mermaidThemeVars(css) {
  const t = (n) => cssToken(css, n);
  return {
    background: t("paper"),
    mainBkg: t("panel"),
    primaryColor: t("panel"),
    primaryTextColor: t("ink"),
    primaryBorderColor: t("line"),
    secondaryColor: t("chip"),
    tertiaryColor: t("hover"),
    lineColor: t("ink-dim"),
    textColor: t("ink"),
    nodeBorder: t("line"),
    clusterBkg: t("hover"),
    clusterBorder: t("line"),
    titleColor: t("ink"),
    edgeLabelBackground: t("panel"),
    noteBkgColor: t("chip"),
    noteBorderColor: t("accent"),
    actorBkg: t("panel"),
    actorBorder: t("line"),
    fontSize: "14px"
  };
}
function mermaidFont(css) {
  return cssToken(css, "font-body");
}

// lib/paging.mjs
var PAGE_SIZE_MAX = 30;
function liftPageSize(gen) {
  const n = Number((gen || {}).PAGE_SIZE);
  if (!Number.isFinite(n)) {
    throw new Error("[board:build] the shipped generator exports no numeric PAGE_SIZE \u2014 the CF-11 page contract cannot be lifted, and this build must not invent a bound the contract does not name (STORY-33.9.05 moved the declaration onto the export surface)");
  }
  if (n <= 0 || n > PAGE_SIZE_MAX) {
    throw new Error("[board:build] lifted PAGE_SIZE=" + n + ", which violates the <=" + PAGE_SIZE_MAX + " PRD contract");
  }
  return n;
}

// lib/stream-window.mjs
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var DAYS_RE = /(?:const|let|var)\s+STREAM_DAYS\s*=\s*(\d+)\s*;/g;
var PER_DAY_RE = /(?:const|let|var)\s+STREAM_PER_DAY\s*=\s*(\d+)\s*;/g;
function soleDeclaration(src, re, name, gen) {
  re.lastIndex = 0;
  const hits = [...String(src).matchAll(re)];
  if (hits.length !== 1) {
    throw new Error("expected exactly 1 " + name + " declaration in " + gen + ", found " + hits.length + " \u2014 ADR-0125's stream window cannot be lifted, and picking a winner would publish a cap the ADR never chose. Refusing to default: --timeline-walk derives its expected row set FROM window.__STREAM_WINDOW, so a wrong cap and the probe would agree with each other and nobody would find out.");
  }
  return Number(hits[0][1]);
}
function liftStreamWindow(scriptsDir) {
  const gen = import_node_path4.default.join(scriptsDir, "generate-dashboard.js");
  const src = import_node_fs3.default.readFileSync(gen, "utf8");
  const days = soleDeclaration(src, DAYS_RE, "STREAM_DAYS", gen);
  const perDay = soleDeclaration(src, PER_DAY_RE, "STREAM_PER_DAY", gen);
  if (!Number.isInteger(days) || days <= 0 || !Number.isInteger(perDay) || perDay <= 0) {
    throw new Error("the lifted stream window is not usable: days=" + days + " perDay=" + perDay);
  }
  return { days, perDay };
}

// lib/slice-matrix.mjs
var import_node_path5 = __toESM(require("node:path"), 1);
var import_node_module4 = require("node:module");
var require5 = (0, import_node_module4.createRequire)(__boardAssembleUrl);
function bandLabel(band) {
  const s = String(band || "");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function liftSliceMatrix(o) {
  const gen = require5(import_node_path5.default.join(o.scriptsDir, "generate-dashboard.js"));
  const matrix = gen.SLICE_BANDS;
  const order = gen.BAND_ORDER;
  const requires = gen.BAND_REQUIRES;
  const closed = gen.BAND_VOCABULARY_CLOSED;
  if (!matrix || typeof matrix !== "object" || !Object.keys(matrix).length) {
    throw new Error("[board:build] generate-dashboard.js exports no non-empty SLICE_BANDS \u2014 every Build sub-view would render an empty slicer and every filter assertion would be vacuous");
  }
  if (!Array.isArray(order) || !order.length) {
    throw new Error("[board:build] generate-dashboard.js exports no non-empty BAND_ORDER \u2014 the filter would be computed over zero attributes, so every value would match everything");
  }
  const stray = [];
  for (const sub of Object.keys(matrix)) {
    for (const b of matrix[sub] || []) if (order.indexOf(b) === -1) stray.push(sub + "/" + b);
  }
  if (stray.length) {
    throw new Error("[board:build] SLICE_BANDS grants band(s) BAND_ORDER does not know: " + stray.join(", ") + " \u2014 they would render and filter nothing");
  }
  const phases = typeof gen.flattenPhases === "function" ? gen.flattenPhases((o.payload || {}).executionStrategy) : [];
  const phaseValues = typeof gen.phaseBandEntries === "function" ? gen.phaseBandEntries(phases).map((e) => ({ value: e.value, label: e.label, title: e.title })) : [];
  const labels = {};
  for (const b of order) labels[b] = bandLabel(b);
  return {
    matrix,
    order,
    requires: requires || {},
    closed: Array.isArray(closed) ? closed : [],
    labels,
    phaseValues,
    noScope: liftNoScope(gen)
  };
}
function liftNoScope(gen) {
  const value = gen.NO_SCOPE;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error('[board:build] the shipped generator exports no usable NO_SCOPE sentinel \u2014 an empty attribute is how "the builder forgot" is spelled, and the two must stay distinguishable (STORY-33.9.05 moved the declaration onto the export surface)');
  }
  return value;
}

// lib/sort-keys.mjs
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_module5 = require("node:module");
var require6 = (0, import_node_module5.createRequire)(__boardAssembleUrl);
function labelFor(key) {
  const s = String(key || "").replace(/-/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function liftSortKeys(scriptsDir) {
  const gen = require6(import_node_path6.default.join(scriptsDir, "generate-dashboard.js"));
  const keys = gen.SORT_KEYS;
  const dirs = gen.SORT_DIRS;
  if (!keys || typeof keys !== "object" || !Object.keys(keys).length) {
    throw new Error("[board:build] the generator exports no non-empty SORT_KEYS \u2014 the ported sort control would offer keys nothing declares, and --sort-walk would compare the DOM against nothing");
  }
  if (!Array.isArray(dirs) || dirs.length < 2) {
    throw new Error('[board:build] the generator exports fewer than two SORT_DIRS \u2014 "both directions" would be one direction');
  }
  const views = gen.SORT_VIEWS && typeof gen.SORT_VIEWS === "object" ? gen.SORT_VIEWS : {};
  const union = [];
  for (const sub of Object.keys(keys)) {
    for (const k of keys[sub] || []) if (union.indexOf(k) === -1) union.push(k);
  }
  for (const vk of Object.keys(views)) {
    for (const k of views[vk] || []) if (union.indexOf(k) === -1) union.push(k);
  }
  if (!union.length) {
    throw new Error("[board:build] SORT_KEYS declares no key on any sub-view");
  }
  const rows = Object.entries(keys).concat(Object.entries(views));
  for (const [name, row] of rows) {
    const pruned = union.filter((k) => (row || []).indexOf(k) !== -1);
    if (pruned.join("|") !== (row || []).join("|")) {
      throw new Error('[board:build] the sort row for "' + name + '" is [' + (row || []).join(", ") + "] but pruning the derived union gives [" + pruned.join(", ") + "]. Every row must be a SUBSEQUENCE of one canonical key order, or the baked-and-pruned control renders a row in an order the matrix does not declare (--sort-walk verdicts sequence, not membership).");
    }
  }
  const declared = gen.SORT_KEY_LABEL && typeof gen.SORT_KEY_LABEL === "object" ? gen.SORT_KEY_LABEL : {};
  const labels = {};
  for (const k of union) labels[k] = declared[k] || labelFor(k);
  const defaults = gen.SORT_DEFAULTS && typeof gen.SORT_DEFAULTS === "object" ? gen.SORT_DEFAULTS : {};
  for (const [vk, spec] of Object.entries(defaults)) {
    const sub = vk.indexOf("build:") === 0 ? vk.slice(6) : null;
    const row = views[vk] || (sub ? keys[sub] : null);
    const key = String(spec || "").split(":")[0];
    const dir = String(spec || "").split(":")[1];
    if (!row || row.indexOf(key) === -1) {
      throw new Error('[board:build] SORT_DEFAULTS names "' + spec + '" for view "' + vk + `", but that view's matrix row does not offer "` + key + '" \u2014 the list would open unsorted while the table claimed a default');
    }
    if (dirs.indexOf(dir) === -1) {
      throw new Error('[board:build] SORT_DEFAULTS names direction "' + dir + '" for view "' + vk + '", which is not one of SORT_DIRS [' + dirs.join(", ") + "]");
    }
  }
  const statusUrgency = Array.isArray(gen.STATUS_URGENCY) ? gen.STATUS_URGENCY.slice() : [];
  const severityUrgency = Array.isArray(gen.SEVERITY_URGENCY) ? gen.SEVERITY_URGENCY.slice() : [];
  if (union.indexOf("attention") !== -1 && !statusUrgency.length) {
    throw new Error("[board:build] the matrix offers the `attention` key but the generator exports no STATUS_URGENCY \u2014 the default order would rank every status equally and the attention default would be an alphabetical one wearing its name");
  }
  return { keys, dirs: dirs.slice(), union, labels, views, defaults, statusUrgency, severityUrgency };
}

// lib/phases.mjs
var import_node_path7 = __toESM(require("node:path"), 1);
var import_node_module6 = require("node:module");
var require7 = (0, import_node_module6.createRequire)(__boardAssembleUrl);
function liftPhases(o) {
  const gen = require7(import_node_path7.default.join(o.scriptsDir, "generate-dashboard.js"));
  const payload = o.payload || {};
  const strategy = payload.executionStrategy || { epics: [] };
  const epics = Array.isArray(strategy.epics) ? strategy.epics : [];
  for (const fn of [
    "buildTrackReconciliation",
    "flattenPhases",
    "phaseDisplayGroup",
    "phaseBandEntries"
  ]) {
    if (typeof gen[fn] !== "function") {
      throw new Error("[board:build] generate-dashboard.js exports no " + fn + "() \u2014 the phase classification cannot be lifted, and a runtime that re-derived it would be guessing the one thing CF-27 forbids");
    }
  }
  if (!o.pmRoot && epics.length) {
    throw new Error("[board:build] liftPhases needs the pmRoot of the payload being built from \u2014 without it every phase is classified against the BUILD MACHINE's retro ledger and run scopes, which is how one project's run ids end up in another project's board");
  }
  const reportsDir = o.pmRoot ? import_node_path7.default.join(o.pmRoot, "41-Reports") : void 0;
  const reconciliation = gen.buildTrackReconciliation(strategy, payload.story || [], {
    ...reportsDir ? { reportsDir, retroLogPath: import_node_path7.default.join(reportsDir, "retro", "retro-log.jsonl") } : {},
    ...o.runScopes ? { runScopes: o.runScopes } : {}
  });
  const flatten = typeof o.flatten === "function" ? o.flatten : gen.flattenPhases;
  const flat = flatten(strategy, reconciliation);
  const tokenById = /* @__PURE__ */ new Map();
  for (const e of gen.phaseBandEntries(flat)) tokenById.set(String(e.id), e.value);
  const derived = [];
  let cursor = 0;
  for (const e of epics) {
    const list = Array.isArray(e.phases) ? e.phases : [];
    const row = [];
    for (let j = 0; j < list.length; j++) {
      const p = flat[cursor++];
      if (!p) {
        throw new Error('[board:build] the flattened phase list ran out at epic "' + e.epic + '" phase ' + j + " \u2014 the payload and the shipped flattener disagree about how many phases exist, so no classification can be aligned to a tile");
      }
      const cat = gen.phaseDisplayGroup(p.run_kind);
      row.push({
        id: p.id,
        label: p.label,
        identitySource: p.identity_source,
        identityBasis: p.identity_basis,
        runKind: p.run_kind,
        cat: cat.group,
        catLabel: cat.label,
        catBasis: cat.basis,
        phaseToken: tokenById.get(String(p.id)) || "",
        chatRecon: p.chat_reconciliation || {}
      });
    }
    derived.push(row);
  }
  if (cursor !== flat.length) {
    throw new Error("[board:build] " + (flat.length - cursor) + " flattened phase(s) had no slot in the payload's own epic/phase tree \u2014 the alignment is not one-to-one and a tile would wear another phase's classification");
  }
  const blank = [];
  for (const row of derived) for (const p of row) {
    if (!String(p.label || "").trim()) blank.push(p.id);
  }
  if (blank.length) {
    throw new Error("[board:build] " + blank.length + " phase(s) resolved to a BLANK canonical label (" + blank.slice(0, 5).join(", ") + ") \u2014 CF-26 requires every phase, legacy ones included, to derive an identity rather than render nameless");
  }
  const seen = /* @__PURE__ */ new Set();
  const dupes = [];
  for (const row of derived) for (const p of row) {
    if (seen.has(p.id)) dupes.push(p.id);
    else seen.add(p.id);
  }
  if (dupes.length) {
    throw new Error("[board:build] " + dupes.length + " phase id(s) occur twice (" + dupes.slice(0, 5).join(", ") + ") \u2014 two sidecars name the same epic, so two tiles would share one identity and the category count would undershoot what is under it");
  }
  return {
    derived,
    // The display vocabulary and its per-group justification, carried from the
    // generator's own constants so the port names no category of its own.
    displayGroups: (gen.PHASE_DISPLAY_GROUPS || []).map((g) => ({
      key: g.key,
      label: g.label,
      basis: (gen.PHASE_GROUP_BASIS || {})[g.key] || ""
    })),
    basis: gen.PHASE_GROUP_BASIS || {}
  };
}

// lib/about.mjs
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);
var import_node_module7 = require("node:module");
var require8 = (0, import_node_module7.createRequire)(__boardAssembleUrl);
var COPY_CONSTANTS = [
  "ABOUT_TANDEM_BLURB",
  "ABOUT_PROJECT_BLURB",
  "TANDEM_PUBLIC_SITE",
  "KIT_PINNED_LABEL"
];
function liftConst(src, name) {
  const re = new RegExp("^const\\s+" + name + "\\s*=\\s*([\\s\\S]*?);[ \\t]*\\r?$", "gm");
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) {
    throw new Error("[board:build] expected exactly 1 declaration of " + name + " in generate-dashboard.js, found " + hits.length + " \u2014 the About copy cannot be lifted, and a re-typed copy would drift the first time the sentence was edited");
  }
  let value;
  try {
    value = Function('"use strict"; return (' + hits[0][1] + ");")();
  } catch (e) {
    throw new Error("[board:build] " + name + " could not be evaluated out of generate-dashboard.js: " + (e && e.message || e));
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("[board:build] " + name + " lifted as " + JSON.stringify(value) + " \u2014 an empty or non-string value would ship a blank About panel with no signal");
  }
  return value;
}
function liftAbout(o) {
  const gen = require8(import_node_path8.default.join(o.scriptsDir, "generate-dashboard.js"));
  const tiers = gen.FIT_TIERS;
  if (!Array.isArray(tiers) || tiers.length < 2) {
    throw new Error("[board:build] generate-dashboard.js exports fewer than two FIT_TIERS \u2014 a tier-monotonic ordering claim over one tier is vacuous, and the acceptance probe refuses to run at all in that state");
  }
  const tierLabels = gen.FIT_TIER_LABELS || {};
  const missing = tiers.filter((t) => !String(tierLabels[t] || "").trim());
  if (missing.length) {
    throw new Error("[board:build] FIT_TIER_LABELS has no label for " + missing.join(", ") + " \u2014 a fit group would render with a blank heading");
  }
  const unrankedLabel = gen.FIT_UNRANKED_LABEL;
  if (typeof unrankedLabel !== "string" || !unrankedLabel.trim()) {
    throw new Error("[board:build] generate-dashboard.js exports no FIT_UNRANKED_LABEL \u2014 the unranked group would render with a blank heading");
  }
  const src = import_node_fs4.default.readFileSync(import_node_path8.default.join(o.scriptsDir, "generate-dashboard.js"), "utf8");
  const copy = {};
  for (const name of COPY_CONSTANTS) copy[name] = liftConst(src, name);
  return { tiers, tierLabels, unrankedLabel, copy };
}

// lib/wiki.mjs
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);
var import_node_module9 = require("node:module");

// lib/markdown.mjs
var import_node_path9 = __toESM(require("node:path"), 1);
var import_node_module8 = require("node:module");
var require9 = (0, import_node_module8.createRequire)(__boardAssembleUrl);
function generator(scriptsDir) {
  const gen = require9(import_node_path9.default.join(scriptsDir, "generate-dashboard.js"));
  if (typeof gen.mdToHtml !== "function") {
    throw new Error("generate-dashboard.js exports no mdToHtml \u2014 the canonical parser has moved or its test seam was dropped; the board lane has deliberately no fallback (CF-33)");
  }
  return gen;
}
function renderMarkdown(md, scriptsDir) {
  return generator(scriptsDir).mdToHtml(String(md == null ? "" : md));
}

// lib/wiki.mjs
var require10 = (0, import_node_module9.createRequire)(__boardAssembleUrl);
function liftWikiSurface(o) {
  const gen = require10(import_node_path10.default.join(o.scriptsDir, "generate-dashboard.js"));
  const drift = require10(import_node_path10.default.join(o.scriptsDir, "lib", "wiki-drift.js"));
  const src = import_node_fs5.default.readFileSync(import_node_path10.default.join(o.scriptsDir, "generate-dashboard.js"), "utf8");
  const producer = liftConst(src, "WIKI_PRODUCER_COMMAND");
  const handToken = drift.PRODUCED_BY_HAND;
  if (typeof handToken !== "string" || !handToken.trim()) {
    throw new Error("[board:build] lib/wiki-drift.js exports no PRODUCED_BY_HAND \u2014 the provenance footer cannot tell a hand-authored page from a command-authored one, and telling the reader to re-run a command that does not write the page is BUG-20260818-09");
  }
  const payloadWiki = o.payload && o.payload.wiki || {};
  const declared = Array.isArray(payloadWiki.docs) ? payloadWiki.docs : [];
  if (!o.pmRoot && declared.length) {
    throw new Error("[board:build] liftWikiSurface needs the pmRoot of the payload being built from: the payload declares " + declared.length + " wiki document(s), and without a pmRoot their bodies would be read from the BUILD MACHINE's documentation/ folder \u2014 one project's prose rendered under another project's drift verdicts");
  }
  const repoRoot = import_node_path10.default.resolve(o.pmRoot || import_node_path10.default.resolve(o.scriptsDir, ".."), "..");
  const dir = import_node_path10.default.join(repoRoot, "documentation");
  const bodies = {};
  const missing = [];
  for (const doc of declared) {
    const name = String(doc && doc.name || "");
    if (!name) {
      missing.push("(a payload entry with no `name`)");
      continue;
    }
    let text;
    try {
      text = import_node_fs5.default.readFileSync(import_node_path10.default.join(dir, name), "utf8");
    } catch (_e) {
      missing.push(name);
      continue;
    }
    const body = String((gen.parseFrontmatterAndBody(text) || {}).body || "").trim();
    const html = renderMarkdown(body, o.scriptsDir);
    if (!String(html).trim()) {
      missing.push(name + " (reads, but renders to an empty body)");
      continue;
    }
    bodies[name] = html;
  }
  if (missing.length) {
    throw new Error("[board:build] the payload declares " + declared.length + " wiki document(s) but " + missing.length + " of them could not be turned into a readable body from " + import_node_path10.default.relative(repoRoot, dir).split(import_node_path10.default.sep).join("/") + ": " + missing.join(", ") + ". The payload and the folder disagree \u2014 run `npm run pm:dash` before `npm run board:build`.");
  }
  return {
    producer,
    handToken,
    // The folder the view names in its own prose and its empty state, taken from
    // the payload so the board and the generator cannot name two different dirs.
    dir: String(payloadWiki.dir || "documentation"),
    bodies
  };
}

// lib/config.mjs
var require11 = (0, import_node_module10.createRequire)(__boardAssembleUrl);
function liftStaleActorFallback(scriptsDir) {
  const mod = require11(import_node_path11.default.join(scriptsDir, "lib", "stale-dismissal.js"));
  const v = mod.ACTOR_NOT_RECORDED;
  if (typeof v !== "string" || !v.trim()) {
    throw new Error("[board:build] lib/stale-dismissal.js exports no ACTOR_NOT_RECORDED \u2014 a dismissal written before the actor field existed would render a blank actor, which --stale-notice-walk reads as an incomplete detail surface (BUG-20260810-04)");
  }
  return v;
}
function buildBoardConfig(o) {
  const gen = require11(import_node_path11.default.join(o.scriptsDir, "generate-dashboard.js"));
  const brandHtml = gen.resolveBadgeMarkup();
  const brandWarnings = (gen.diagnostics && gen.diagnostics.warnings || []).map((w) => ({ path: w.path, reason: w.reason }));
  const drift = navDrift({ scriptsDir: o.scriptsDir });
  if (drift.missing.length || drift.orphanDeclared.length) {
    throw new Error("the nav declaration has drifted from the generator: " + (drift.missing.length ? "undeclared view(s) " + drift.missing.join(", ") + ". " : "") + (drift.orphanDeclared.length ? "declared but unknown: " + drift.orphanDeclared.join(", ") + "." : ""));
  }
  const nav = buildNav({ scriptsDir: o.scriptsDir });
  const legacy = liftLegacyRoutes(o.scriptsDir);
  const rail = nav.groups;
  if (rail.length < 9) {
    throw new Error("the rail derived only " + rail.length + " view(s); the board contract is >= 9");
  }
  const payload = o.payload || {};
  return {
    project: payload.project || "",
    // CF-58 — carried through with whatever offset it was authored with. NEVER
    // re-derived through `toISOString()`, which normalises to UTC and moves the
    // calendar day across midnight (BUG-20260801-04 defect B). The runtime formats
    // it in the VIEWER's locale; this value stays machine-readable.
    generatedAt: payload.generatedAt || "",
    rail,
    // The derived routing table, shipped as DATA. The runtime resolves a hash
    // against this and never re-declares a group, a sub key or a default —
    // which is what makes "one nav declaration" a property of the deliverable
    // rather than of the build step alone.
    routes: nav.routes,
    defaultGroup: nav.defaultGroup,
    // CF-20 — which view is claimed by which PANEL, derived from `nav.mjs`'s own
    // declaration and shipped as DATA. It travels here rather than as a registry
    // in the runtime because a registry keyed by view id IS a second list of group
    // ids, and `nav-single-source.test.js` counts bare object keys as such. The
    // runtime maps a NAME to a component; it never spells a view.
    panels: nav.panels,
    // CF-47 — the v1.0 redirect manifest and the plural sub-key aliases, LIFTED
    // from the shipped generator rather than re-typed. Every link ever shared
    // resolves through this, and it ships as data so the runtime holds no
    // redirect of its own. A generator that renamed the table is a BUILD failure
    // here, not a board that quietly drops old bookmarks.
    legacy,
    brandHtml,
    brandWarnings,
    // CF-50 — the external-render gate, carried rather than re-derived, so the ONE
    // place that decides "is this a demo/consumer render" stays the one place. The
    // generator resolves it from `PM_DASH_ROOT` at module load and the payload
    // already carries the answer; reading it here would be a second opinion.
    external: !!(payload.about && payload.about.external),
    // CF-36 — the diagram palette, DERIVED from the board's own tokens by reading
    // the assembled stylesheet. Never a hex literal here: one would satisfy the
    // theming assertion on the day it was written, drift the first time the
    // palette moved, and be a raw colour literal in source besides — which is
    // what STORY-33.9.04's token gate exists to refuse. A token that will not
    // resolve is a BUILD ERROR, because shipping mermaid's stock theme is exactly
    // the outcome CF-36 forbids and a fallback is what would hide it.
    mermaidTheme: o.css ? mermaidThemeVars(o.css) : null,
    mermaidFont: o.css ? mermaidFont(o.css) : null,
    // CF-11 — the PRD's page contract, LIFTED from the shipped generator rather
    // than re-typed. A second constant here would satisfy TESTPLAN-25.6.01's
    // single-definition grep (it reads only `generate-dashboard.js`) while
    // giving this board a bound the contract does not name.
    // STORY-34.1.01 — the generator module is passed in rather than resolved inside
    // `paging.mjs`, because that module is now imported by the BROWSER bundle too and
    // a `node:path` import at its top would fail the runtime build. `gen` is the same
    // object this function already required on its first line.
    pageSize: liftPageSize(gen),
    // ADR-0125's published stream window, LIFTED from the generator's own source
    // (see `lib/stream-window.mjs` for why it is sliced rather than re-typed).
    // The runtime republishes it as `window.__STREAM_WINDOW`, because
    // `--timeline-walk --case doorway` derives the widget's expected visible SET
    // from it and refuses to assume: "the widget cap cannot be derived, only
    // assumed". A board publishing its own pair would be self-consistent about a
    // cap ADR-0125 never chose.
    streamWindow: liftStreamWindow(o.scriptsDir),
    // ADR-0128's ONE wording for an absent card section, LIFTED from the shipped
    // generator (`SLOT_NOT_RECORDED`) rather than re-typed. The report ladder places
    // it in the date slot as well as the summary slot, so a reader learns one
    // sentence and a probe can assert one string — and a second spelling here would
    // be the drift that makes both of those false.
    slotNotRecorded: gen.SLOT_NOT_RECORDED || "Not recorded in the artefact.",
    // CF-16 — the band matrix, LIFTED from the shipped generator's `SLICE_BANDS`
    // (plus BAND_ORDER / BAND_REQUIRES / BAND_VOCABULARY_CLOSED and the phase
    // token rule). One data structure, and the acceptance harness reads the same
    // export as its oracle — so a second declaration here could not merely drift,
    // it would make `--band-matrix-walk` compare two different matrices and
    // report the disagreement as a product defect. See `lib/slice-matrix.mjs`.
    //
    // What it does NOT carry is a VALUE list for status or epic: those are
    // censused in the runtime from the live `window.__DATA` (CF-43), so an option
    // that survives the payload being disconnected cannot exist.
    slice: liftSliceMatrix({ scriptsDir: o.scriptsDir, payload }),
    // CF-25 — the SORT KEY matrix, LIFTED from the shipped generator's `SORT_KEYS`
    // / `SORT_DIRS`. Same argument as the band matrix directly above: `--sort-walk`
    // reads the Node-side export as its ORACLE, so a second declaration here would
    // not merely drift — it would make the walk compare two different matrices and
    // report the disagreement as a product defect. The union the control bakes and
    // the per-key labels are DERIVED from it (see `lib/sort-keys.mjs`), so the
    // board declares no sort key, order or label of its own.
    sort: liftSortKeys(o.scriptsDir),
    // CF-26 / CF-27 — the per-phase CANONICAL IDENTITY and RUN KIND, lifted from
    // the shipped `phaseIdentity()` / `buildTrackReconciliation()` pipeline. Two
    // of the classifier's three inputs are FILES (the retro ledger and the written
    // run scopes), so a runtime that classified phases would be guessing — which
    // is the one thing CF-27 forbids by name.
    //
    // It carries NO phase, chat, story or count: those stay in
    // `window.__DATA.executionStrategy` and the runtime reads them from there, so
    // a disconnected payload renders an empty Phases view rather than a full and
    // convincing one (CF-43). See `lib/phases.mjs`.
    phases: liftPhases({ scriptsDir: o.scriptsDir, pmRoot: o.pmRoot, payload }),
    // CF-41 / CF-39 - the fit-tier vocabulary (the SAME export
    // `--toolkit-tier-order-probe` uses as its oracle, so the board and the probe
    // cannot be checking different tier sets) and the four About/Toolkit copy
    // constants, read out of the generator's own source rather than re-typed.
    // See `lib/about.mjs`.
    fitTiers: liftAbout({ scriptsDir: o.scriptsDir }),
    // CF-51 - the ONE thing the Project Wiki needs that the payload deliberately
    // strips: the rendered document bodies. Every drift verdict, every flag, every
    // evidence sentence and the census stay on `window.__DATA`, so a disconnected
    // payload renders an empty wiki rather than eleven convincing pages (CF-43).
    // See `lib/wiki.mjs` and ADR-0261 for why the split falls where it does.
    wikiSurface: liftWikiSurface({ scriptsDir: o.scriptsDir, pmRoot: o.pmRoot, payload }),
    // CF-52 - how an absent actor is SPELLED, taken from the store that owns the
    // word. The generator applies `actorOf()` at render time (the payload carries
    // the raw `dismissed_by`), so the ported renderer needs the same fallback -
    // and a second spelling of "(not recorded)" is what BUG-20260810-04 already
    // cost once, when the render invented one and the probe asserted the other.
    staleActorFallback: liftStaleActorFallback(o.scriptsDir),
    builtBy: "board/build.mjs",
    dataSource: o.dataSource || ""
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assemble,
  assertNoRemoteUrls,
  brandFontFaces,
  buildBoardConfig,
  buildCss,
  countRecords,
  escapeForScript,
  escapeHtml,
  extractPayloadJson,
  mermaidBundle,
  mermaidFont,
  mermaidThemeVars
});
