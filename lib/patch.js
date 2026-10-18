/**
 * Rendering of the composition, separated from the CLI that writes it so tests
 * can compare the committed `cordis.patch.yml` against a fresh render without
 * spawning a process (the Windows sandbox forbids child_process).
 *
 * One row per role: `tool-subagent` instance carrying that role's persona, its
 * capability allow-list, and its pinned model tier.
 */

import { ROLES, agentOptionsFor, capabilitiesFor, toolNameFor } from './roster.js'

/** Env-var names the composition reads at load time, per tier field. */
export const TIER_ENV = {
  batch: { model: 'ROSTER_BATCH_MODEL', maxTokens: 'ROSTER_BATCH_MAX_TOKENS' },
  build: { model: 'ROSTER_BUILD_MODEL', maxTokens: 'ROSTER_BUILD_MAX_TOKENS' },
  review: { model: 'ROSTER_REVIEW_MODEL', maxTokens: 'ROSTER_REVIEW_MAX_TOKENS' },
  team: { model: 'ROSTER_TEAM_MODEL', maxTokens: 'ROSTER_TEAM_MAX_TOKENS' },
}

const q = (value) => `'${String(value).replaceAll("'", "''")}'`
const js = (expr) => `!!js ${JSON.stringify(expr)}`

function roleRow(role) {
  const env = TIER_ENV[role.tier]
  const options = agentOptionsFor(role.tier)
  const allow = capabilitiesFor(role)
  const lines = [
    `    - id: roster-${role.id}`,
    `      name: '@deepseek-ai/dsh-tool-subagent'`,
    `      config:`,
    `        provider: spawn`,
    `        toolName: ${q(toolNameFor(role))}`,
    `        backgroundMode: one-shot`,
    `        maxDepth: 1`,
    '        persona: |-',
  ]
  for (const line of role.prompt.split('\n')) lines.push(`          ${line}`)
  lines.push(`        toolFilter:`)
  if (allow.length === 0) {
    lines.push(`          allow: []`)
  } else {
    lines.push(`          allow: [${allow.map(q).join(', ')}]`)
  }
  lines.push(`        agentOptions:`)
  lines.push(`          provider: ${js("process.env.ROSTER_PROVIDER ?? 'deepseek-official'")}`)
  lines.push(`          model: ${js(`process.env.${env.model} ?? ${JSON.stringify(options.model)}`)}`)
  lines.push(`          maxTokens: ${js(`Number(process.env.${env.maxTokens} ?? ${options.maxTokens})`)}`)
  return lines.join('\n')
}

/**
 * Render the whole bundle patch.
 * @returns the YAML text, ending with exactly one newline.
 */
export function renderPatch() {
  const sections = [
    [
      '# GENERATED FILE - do not edit by hand.',
      '#',
      '# Source of truth: lib/roster.js. Regenerate with `node scripts/gen-patch.mjs`;',
      '# `npm test` fails when this file is stale.',
      '#',
      '# One row per role: a tool-subagent instance that pins, for its children,',
      '#   persona      - the child persona-prefix section (identity and output contract)',
      '#   toolFilter   - the exact tools that child may call; bulk units get none, and no',
      '#                  filter ever grants a subagent tool, so a role child stays a leaf',
      '#   agentOptions - the model tier that role runs on',
      '#   maxDepth 1   - one level deep: the child may exist, and cannot delegate further',
      '#',
      '# Every row is addressed by id, so a user profile can override any of them',
      '# without touching this package. Model ids and token ceilings resolve from the',
      '# environment at load time, so one composition serves a bench route and a',
      '# production route unchanged.',
      '',
      '- insert:',
    ].join('\n'),
  ]

  let currentLine = ''
  for (const role of ROLES) {
    if (role.line !== currentLine) {
      currentLine = role.line
      sections.push(
        currentLine === 'bulk'
          ? '    # ── Bulk line: one item per call, blind children, machine-checkable output ──'
          : '    # ── Team line: planning, building, reviewing, researching, assembling ──',
      )
    }
    sections.push(`    # ${role.position} / ${role.temperament} - tier ${role.tier}, ${capabilitiesFor(role).length} tools`)
    sections.push(roleRow(role))
    sections.push('')
  }
  sections.push('    # The roster validator and the routing section the parent agent reads.')
  sections.push('    - id: subagent-roster')
  sections.push("      name: 'dsh-plugin-subagent-roster'")
  return `${sections.join('\n')}\n`
}

