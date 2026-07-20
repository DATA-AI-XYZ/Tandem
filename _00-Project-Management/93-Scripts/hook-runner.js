#!/usr/bin/env node
/**
 * hook-runner.js — forwarding stub to hook.js (BUG-20260718-02, ADR-0053).
 * ADR-0053 renamed the canonical hook entrypoint hook-runner.js -> hook.js; this
 * stub keeps any stale hook definition that still calls the old name working
 * against a new cache. hook.js runs main() unconditionally on load (no
 * require.main guard), so a plain require reproduces argv/stdin/exit-code
 * behaviour identically to invoking it directly — no subprocess needed.
 */
'use strict';

require('./hook.js');
