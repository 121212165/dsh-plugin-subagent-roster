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
import { registerDelegate } from './delegate.js'
import { startPage } from './page.js'
import { CAPABILITIES, LINES, loadRoles, normaliseRole, saveRoles } from './store.js'
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
export const inject = ['systemPrompt', 'tools', 'subagents']

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
  subagentProvider: Schema.string()
    .default('spawn')
    .description('Registered subagent backend every delegation uses. This is the backend name (spawn/fork), not an LLM route.'),
  routingGuidance: Schema.boolean()
    .default(true)
    .description('Register the bulk-vs-team routing section into the parent agent system prompt.'),
  pagePort: Schema.natural()
    .default(4317)
    .description(
      'Loopback port for the roster operations page. 0 disables it. The page has no authentication: it is bound to 127.0.0.1 and grants the same file authority a local shell already has.',
    ),
  rosterFile: Schema.string()
    .default('')
    .description('Override for the roster document. Empty means <DSH_HOME>/subagent-roster/roles.json, seeded from the shipped roles on first start.'),
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
    `- \`${role.id}\` - ${role.title.en}. ${role.description.en} Tools: ${
      capabilitiesFor(role).length === 0 ? 'none (pure transform)' : capabilitiesFor(role).join(', ')
    }.`
  const bulk = roles.filter((role) => role.line === 'bulk')
  const team = roles.filter((role) => role.line === 'team')

  return [
    '## Delegation shapes',
    '',
    'Classify the request before you start working on it. Two shapes, one tool: call `delegate` with the role that fits.',
    '',
    '**Bulk work.** The request contains two or more independent items of the same kind: a list,',
    'numbered steps, several files, several rows or records, "for each of these".',
    'Do not process such items yourself, one after another. Launch one child per item, in this same',
    'turn, one delegate call per item, and let them run in parallel while you keep working.',
    'Processing a homogeneous list serially yourself is a routing error, not a style preference.',
    'A single item is not bulk work: do it yourself.',
    ...bulk.map(describe),
    '',
    '**Team work.** The units differ from each other, or a wrong unit is expensive: designing,',
    'implementing, reviewing, researching, assembling one artifact from many contributions.',
    'Plan before dispatching: a planning role first, then one builder per unit, then a reviewer told',
    'what "correct" means, then a scribe only if an artifact must be assembled.',
    'Reviewers, researchers, and leads cannot write files; asking them to is a wasted call.',
    ...team.map(describe),
    '',
    'Several tools share a position but differ in temperament (for example builder-surgical vs',
    'builder-refactor). Pick by the temperament the unit needs, not by which name sounds strongest.',
  ].join('\n')
}

/**
/**
 * Mount the roster: read the deployment document, register the delegation tool
 * and the routing section from it, and serve the operations page that edits it.
 *
 * Re-registration on save is deliberate: the tool's `role` enum and the routing
 * text are both derived from the roster, so applying a new roster means
 * replacing both registrations, not mutating state behind a stale schema.
 *
 * @param {any} ctx - plugin context; uses `systemPrompt`, `tools`, `subagents`, `logger`, `effect`.
 * @param {any} config - validated plugin config.
 */
export function apply(ctx, config = {}) {
  const loaded = loadRoles({ file: config.rosterFile === '' || config.rosterFile === undefined ? undefined : config.rosterFile })
  const warn = (message) => {
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(message)
    else console.warn(message)
  }
  if (loaded.problems.length > 0) {
    warn(`subagent-roster: roster file rejected, using shipped roles:\n  - ${loaded.problems.join('\n  - ')}`)
  }

  let mounted
  const disposeMounted = () => {
    try {
      mounted?.tool?.()
    } catch (error) {
      warn(`subagent-roster: could not remove the previous delegate tool: ${error.message}`)
    }
    try {
      mounted?.section?.()
    } catch (error) {
      warn(`subagent-roster: could not remove the previous routing section: ${error.message}`)
    }
    mounted = undefined
  }

  const mount = (roles) => {
    const problems = validateRoster({
      roles,
      allowedModels: config.allowedModels ?? [],
      provider: config.provider ?? process.env.ROSTER_PROVIDER ?? 'deepseek-official',
    })
    if (problems.length > 0) {
      const summary = `subagent-roster: ${problems.length} composition problem(s):\n  - ${problems.join('\n  - ')}`
      if (config.mode === 'strict') throw new Error(summary)
      warn(summary)
    }

    disposeMounted()
    const tool = registerDelegate(ctx, {
      subagentProvider: config.subagentProvider,
      llmProvider: config.provider,
      roles,
    })
    let section
    if (config.routingGuidance !== false) {
      let order
      try {
        order = ctx.systemPrompt.getSectionOrder(SECTION_ORDER_KEY)
      } catch {
        order = undefined
      }
      const descriptor = { name: SECTION_NAME, text: routingText({ roles }) }
      if (order !== undefined) descriptor.order = order
      section = ctx.systemPrompt.section(descriptor)
    }
    mounted = { tool, section, roles }
  }

  mount(loaded.roles)

  let page
  if (config.pagePort !== 0) {
    page = startPage({
      port: config.pagePort,
      logger: ctx.logger,
      state: () => ({
        roles: mounted.roles,
        tiers: Object.keys(TIERS),
        capabilities: CAPABILITIES,
        lines: LINES,
        file: loaded.file,
        source: loaded.source,
      }),
      save: (roles) => saveRoles(roles, { file: loaded.file }),
      onApply: async (roles) => {
        const previous = mounted.roles
        try {
          mount(roles.map(normaliseRole))
        } catch (error) {
          // Restore a working roster before reporting: a rejected edit must not
          // leave the parent without a delegate tool.
          try {
            mount(previous)
          } catch (restoreError) {
            warn(`subagent-roster: could not restore the previous roster: ${restoreError.message}`)
          }
          throw error
        }
        warn(`subagent-roster: applied ${roles.length} role(s) from the operations page`)
      },
    })
    warn(`subagent-roster: operations page on ${page.url} (${mounted.roles.length} roles, file ${loaded.file})`)
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      disposeMounted()
      page?.close()
    }, 'subagent-roster.lifecycle')
  }
}


