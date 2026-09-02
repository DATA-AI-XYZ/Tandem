'use strict';
/**
 * brand-fonts.css.js — the six brand @font-face rules (Instrument Serif, Manrope,
 * JetBrains Mono; two rules per family, latin + latin-ext), base64-inlined woff2,
 * ONE SOURCE for every board build (ADR-0092 / CF-46).
 *
 * Created by STORY-33.9.05 (the ADR-0139 annotate-then-delete pass; operator ruling
 * 2026-08-28 on BACKLOG-0229: port first, then the old stylesheet retires fully).
 * BUILT AT REQUIRE TIME from the vendored binaries in `../assets/fonts/` — the same
 * builder the retired `lib/dashboard-css.js` used (review M7: a frozen base64 string
 * would have been a second representation of the fonts that nothing kept in step; the
 * .woff2 files ARE the source, and the day a subset changes this module picks it up
 * with no edit). Licences ship beside the binaries (OFL-*.txt).
 *
 * module.exports IS the CSS string — no other shape, so `board/lib/styles.mjs` can
 * inline it into every assembled board and CF-46 (complete offline, no network fetch)
 * keeps holding. Defensive per-face skip on an unreadable binary (the board renders
 * with the stack's fallback for that one face); styles.mjs still refuses a ZERO-face
 * result outright.
 */
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const LATIN_RANGE = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT_RANGE = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

const FONT_FACES = [
  { family: 'Instrument Serif', weight: '400',     file: 'instrument-serif-latin.woff2',     range: LATIN_RANGE },
  { family: 'Instrument Serif', weight: '400',     file: 'instrument-serif-latin-ext.woff2', range: LATIN_EXT_RANGE },
  { family: 'Manrope',          weight: '400 800', file: 'manrope-latin.woff2',              range: LATIN_RANGE },
  { family: 'Manrope',          weight: '400 800', file: 'manrope-latin-ext.woff2',          range: LATIN_EXT_RANGE },
  { family: 'JetBrains Mono',   weight: '400 700', file: 'jetbrains-mono-latin.woff2',       range: LATIN_RANGE },
  { family: 'JetBrains Mono',   weight: '400 700', file: 'jetbrains-mono-latin-ext.woff2',   range: LATIN_EXT_RANGE },
];

function buildFontFaceCss() {
  return FONT_FACES.map(function (f) {
    var data;
    try {
      data = fs.readFileSync(path.join(FONT_DIR, f.file)).toString('base64');
    } catch (_e) {
      return '';
    }
    return "@font-face{font-family:'" + f.family + "';font-style:normal;font-weight:" + f.weight +
      ";font-display:swap;src:url(data:font/woff2;base64," + data + ") format('woff2');" +
      'unicode-range:' + f.range + ';}';
  }).join('');
}

module.exports = buildFontFaceCss();
