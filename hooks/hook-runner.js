#!/usr/bin/env node
/**
 * hook-runner.js — compatibility shim.
 *
 * The canonical hook entrypoint now lives at
 *   _00-Project-Management/93-Scripts/hook.js   (STORY-12.3.01 / ADR-0053)
 * and the kit's hook definitions (hooks/hooks.json, scaffold .claude/settings.json)
 * call it directly. This file is retained only so any out-of-tree reference to
 * ${CLAUDE_PLUGIN_ROOT}/hooks/hook-runner.js keeps working — it has no logic of its
 * own; it just delegates to the single source of truth (argv and stdin are shared
 * with this process, so dispatch and payload parsing happen there unchanged).
 */
'use strict';

require('../_00-Project-Management/93-Scripts/hook.js');
