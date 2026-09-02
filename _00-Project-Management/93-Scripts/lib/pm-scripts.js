'use strict';
/**
 * pm-scripts.js — the `pm:*` script map, declared ONCE (STORY-33.10.02 · ADR-0269).
 *
 * `install.js` writes these into a host `package.json`; `update.js` needs to recognise the
 * kit's OWN previous spellings so it can tell an operator their wiring predates a rename.
 * Both were about to hold their own copy of the same string, which is the shape
 * STORY-33.10.01's DoD review already caught once on the delivery path and fixed with the
 * lesson *"a shared rule has to be a shared FUNCTION, not a shared idea."* This is that
 * lesson applied before the second copy could drift rather than after.
 *
 * Dependency-free — Node stdlib only (no imports needed).
 */

/**
 * The scripts a CONSUMER install wires. `pm:dash` is the ASSEMBLER: it runs the generator as
 * a child for its payload and inlines that payload into the kit-shipped prebuilt runtime.
 * Pointing it at the generator would make STORY-33.10.02's AC-1 and AC-4 contradict each
 * other — the install would deliver the ported board and the consumer's very next `pm:dash`
 * would overwrite it with the pre-port one.
 */
const SCRIPTS = {
  'pm:lint': 'validate-frontmatter.js',
  'pm:dash': 'build-board.js',
  'pm:monitor': 'generate-monitor.js',
  'pm:map': 'generate-codebase-map.js',
  'pm:doctor': 'doctor.js',
  // STORY-25.6.02 / ADR-0132. Without this a consumer gets 13-Releases/, the template
  // and the Releases renderer but no way to invoke the producer, so their panel stays
  // empty for the same reason this project's did.
  'pm:release': 'release-producer.js',
  'pm:install': 'install.js',
  'pm:update': 'update.js',
  'pm:claude-scaffold': 'claude-scaffold.js',
  'pm:claude-audit': 'claude-audit.js',
};

/**
 * THE KIT REPO IS A CONSUMER OF ITS OWN PORTED BOARD, AS OF STORY-33.9.05.
 *
 * The cutover this map used to hold back has happened: `pm:dash` is the assembly lane
 * (`build-board.js`) everywhere — kit repo and consumers alike — and the generator is the
 * payload producer it invokes as a child (`--payload-out`). ADR-0269 clause 4's kit-repo
 * exception is discharged; the empty map stays as the seam so a future divergence, if one
 * is ever ruled, has a recorded home rather than an ad-hoc patch.
 */
const KIT_REPO_SCRIPT_OVERRIDES = {};

/**
 * A stale entry is migrated ONLY when it is byte-for-byte one of the KIT'S OWN previous
 * spellings. Anything else — an operator's wrapper, an extra flag, a different path, a task
 * runner — carries a decision the installer did not make and cannot read, and is left alone.
 */
const LEGACY_SCRIPT_TARGETS = {
  'pm:dash': ['generate-dashboard.js'],
};

/** The kit's own spelling of the command that runs a shipped script. */
function kitScriptCommand(file) { return `node _00-Project-Management/93-Scripts/${file}`; }

/** The map to write for this target. */
function scriptMap(isConsumerInstall) {
  return isConsumerInstall ? { ...SCRIPTS } : { ...SCRIPTS, ...KIT_REPO_SCRIPT_OVERRIDES };
}

/** The kit's previous spellings of `name`, as full commands. */
function legacyCommands(name) {
  return (LEGACY_SCRIPT_TARGETS[name] || []).map(kitScriptCommand);
}

module.exports = {
  SCRIPTS, KIT_REPO_SCRIPT_OVERRIDES, LEGACY_SCRIPT_TARGETS,
  kitScriptCommand, scriptMap, legacyCommands,
};
