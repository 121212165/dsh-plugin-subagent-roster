/**
 * Rendering of the composition, separated from the CLI that writes it so tests
 * can compare the committed `cordis.patch.yml` against a fresh render without
 * spawning a process (the Windows sandbox forbids child_process).
 *
 * The composition is deliberately tiny: roles are no longer one tool each, so
 * the patch only mounts the plugin. Everything a role pins -- persona, tool
 * allow-list, model tier -- travels in the delegation request instead.
 */

/**
 * Render the whole bundle patch.
 * @returns the YAML text, ending with exactly one newline.
 */
export function renderPatch() {
  return [
    '# GENERATED FILE - do not edit by hand.',
    '#',
    '# Source of truth: lib/roster.js. Regenerate with `node scripts/gen-patch.mjs`;',
    '# `npm test` fails when this file is stale.',
    '#',
    '# The patch mounts one plugin and nothing else. Roles are not composition',
    '# rows: `lib/delegate.js#buildDelegateRequest` puts the role persona, the tool',
    '# allow-list, and the model tier into each delegation request, so a role',
    '# cannot be widened by editing the composition and the parent agent pays for',
    '# exactly one delegation tool schema.',
    '',
    '- insert:',
    '    - id: subagent-roster',
    "      name: 'dsh-plugin-subagent-roster'",
    '',
  ].join('\n')
}
