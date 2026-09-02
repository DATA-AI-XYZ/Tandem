'use strict';
/**
 * local-date.js — local-time timestamp helpers (BUG-20260801-04).
 *
 * The kit stores timestamps as ISO 8601 WITH OFFSET (`YYYY-MM-DDTHH:MM:SS±HH:MM`) — see the
 * frontmatter contract in `90-Standards/SOP.md` and `tandem:core`. `Date.prototype.toISOString()`
 * does NOT produce that shape: it normalises to UTC and emits a trailing `Z`. Taking
 * `.slice(0, 10)` of a UTC string therefore yields the UTC calendar day, which is the WRONG DAY
 * whenever local time sits on the other side of midnight from UTC — nightly during BST, and for
 * a 12-13 hour window at UTC+12/+13.
 *
 * These helpers are the offset-preserving counterpart, for anything a human will read.
 *
 * Use `localIso` / `localDay` for DISPLAY and for artefact frontmatter.
 * Keep `toISOString()` for machine state that is never rendered (ledger `ts`, `mode.js` `set_at`).
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * The date's UTC offset as `±HH:MM`.
 * `getTimezoneOffset()` returns minutes the local zone is BEHIND UTC, so it is negated:
 * Europe/London in BST reports -60 and must render as `+01:00`.
 * @param {Date} date
 * @returns {string}
 */
function offsetString(date) {
  const mins = -date.getTimezoneOffset();
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  return sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
}

/**
 * Full local ISO 8601 timestamp with offset — the kit's documented shape.
 * Built from local-time getters, so it never shifts the calendar day.
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. `2026-08-01T00:30:00+01:00`
 */
function localIso(date) {
  const d = date === undefined ? new Date() : (date instanceof Date ? date : new Date(date));
  return d.getFullYear() +
    '-' + pad2(d.getMonth() + 1) +
    '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) +
    ':' + pad2(d.getMinutes()) +
    ':' + pad2(d.getSeconds()) +
    offsetString(d);
}

/**
 * Local calendar day as `YYYY-MM-DD`. Defined as the date half of `localIso` so the two can
 * never disagree.
 * @param {Date|string|number} [date=new Date()]
 * @returns {string} e.g. `2026-08-01`
 */
function localDay(date) {
  return localIso(date).slice(0, 10);
}

module.exports = { localIso, localDay, offsetString };
