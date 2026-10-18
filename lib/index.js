/**
 * dsh-plugin-subagent-roster - runtime half of the bundle.
 *
 * The composition (`cordis.patch.yml`) already pins every role's persona, tool
 * allow-list, model tier, and depth per delegation tool. This plugin's job is to
 * make sure that composition is *coherent* before an agent can spawn a child,
 * and to give the parent agent the routing rule it cannot infer from the tool
 * schemas alone.
 *
 * `strict` mode refuses to load a roster that contradicts its own allow-list;
 * the default `advisory` mode logs the same problems, so a deployment can
 * inspect a bad composition without being locked out of it.
 */

import Schema from '@deepseek-ai/schemastery'
import { ROLES, TIERS, agentOptionsFor, capabilitiesFor, roleIds, toolNameFor, validateRoster } from './roster.js'

export {
  PROVIDER,
  ROLES,
  TIERS,
  agentOptionsFor,
  byLine,
  capabilitiesFor,
  roleIds,
  toolNameFor,
  validateRoster,
} from './roster.js'

/** Cordis plugin name. */
export const name = 'subagent-roster'

/** The routing section needs the prompt registry; it is the only hard dependency. */
export const inject = ['systemPrompt']

export const Config = Schema.object({
  mode: Schema.union(['advisory', 'strict'])
    .default('advisory')
    .description(
      'advisory: log roster inconsistencies and keep running. strict: refuse to load, because a child could be spawned with a prompt or route the roster does not sanction.',
    ),
  provider: Schema.string()
    .default(process.env.ROSTER_PROVIDER ?? 'deepseek-official')
    .description('Provider route every tier resolves against when the composition leaves it implicit.'),
  allowedModels: Schema.array(Schema.string())
    .default([])
    .description(
      'Exact "provider/model" routes this deployment sanctions. Empty means no allow-list. A non-empty list forbids any tier resolving outside it.',
    ),
  routingGuidance: Schema.boolean()
    .default(true)
    .description('Register the bulk-vs-team routing section into the parent agent system prompt.'),
})

const SECTION_NAME = 'roster:routing'
const SECTION_ORDER_KEY = 'TOOL_WORKFLOW'

/**
 * Build the routing text from the roster itself, so it cannot describe a tool
 * that is not mounted or omit one that is.
 * @param {object} options - the roles to describe.
 */
export function routingText({ roles = ROLES } = {}) {
  const describe = (role) =>
    `- \`${toolNameFor(role)}\` - ${role.title.en}. ${role.description.en} Tools: ${
      capabilitiesFor(role).length === 0 ? 'none (pure transform)' : capabilitiesFor(role).join(', ')
    }.`
  const bulk = roles.filter((role) => role.line === 'bulk')
  const team = roles.filter((role) => role.line === 'team')

  return [
    '## Delegation shapes',
    '',
    'Two kinds of work reach you, and each has its own tools. Choose by the shape of the work, not its size.',
    '',
    '**Bulk work** - many instances of one task, each independently checkable:',
    ...bulk.map(describe),
    '',
    'For bulk work, launch one child per item, in parallel, in the same turn, with one item per call.',
    'Never hand a bulk child a list and ask it to iterate: it sees one item and has no tools at all.',
    'Keep working while they run instead of waiting idle.',
    '',
    '**Team work** - units that differ from each other, where a wrong unit is expensive:',
    ...team.map(describe),
    '',
    'For team work, plan before dispatching: a planning role first, then one builder per unit,',
    'then a reviewer told what "correct" means, then a scribe only if an artifact must be assembled.',
    'Reviewers, researchers, and leads cannot write files; asking them to is a wasted call.',
    '',
    'Several tools share a position but differ in temperament (for example builder-surgical vs',
    'builder-refactor). Pick by the temperament the unit needs, not by which name sounds strongest.',
  ].join('\n')
}

/**
 * Mount the validator and the routing section.
 * @param {any} ctx - plugin context; only `systemPrompt`, `effect`, and `logger` are used.
 * @param {any} config - validated plugin config.
 */
export function apply(ctx, config = {}) {
  const problems = validateRoster({
    allowedModels: config.allowedModels ?? [],
    provider: config.provider ?? process.env.ROSTER_PROVIDER ?? 'deepseek-official',
  })

  if (problems.length > 0) {
    const summary = `subagent-roster: ${problems.length} composition problem(s):\n  - ${problems.join('\n  - ')}`
    if (config.mode === 'strict') throw new Error(summary)
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(summary)
    else console.warn(summary)
  }

  if (config.routingGuidance === false) return

  const text = routingText()
  const register = () => {
    let order
    try {
      order = ctx.systemPrompt.getSectionOrder(SECTION_ORDER_KEY)
    } catch {
      order = undefined
    }
    const section = { name: SECTION_NAME, text }
    if (order !== undefined) section.order = order
    return ctx.systemPrompt.section(section)
  }

  if (typeof ctx.effect === 'function') ctx.effect(register, 'subagent-roster.section()')
  else register()
}

/** Role ids, for a settings surface that wants to validate a user-supplied subset. */
export { roleIds as ids }
