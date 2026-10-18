/**
 * The single delegation tool.
 *
 * Why one tool instead of one per role: a parent model chooses far more
 * reliably between "call the delegate tool with role X" and "do it myself"
 * than between twelve sibling tools. Consolidating costs nothing in
 * enforcement, because the runtime request itself carries `persona` and
 * `toolFilter` -- both are applied per child, not per tool instance.
 *
 * So the role enum is not a hint: picking `reviewer-strict` hands the child the
 * reviewer persona and a tool filter with no write tool in it. A model cannot
 * choose a role and then exceed it.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { ROLES, agentOptionsFor, capabilitiesFor, toolNameFor } from './roster.js'

const roleById = new Map(ROLES.map((role) => [role.id, role]))

/** Depth one: the child may exist and cannot delegate again (its filter has no subagent tool). */
const CHILD_DEPTH = 1

/**
 * Build the runtime request one delegation makes. Pure, so the tests can assert
 * the exact persona and filter a role produces without spawning anything.
 * @param {object} role - a roster entry.
 * @param {string} task - the child's task text.
 * @param {object} [options] - provider override and the parent agent.
 */
export function buildDelegateRequest(role, task, { llmProvider, parent, signal } = {}) {
  if (role === undefined) throw new Error('delegate: unknown role')
  const allow = capabilitiesFor(role)
  return {
    label: `delegate:${role.id}`,
    prompt: [{ type: 'text', text: task }],
    parent,
    signal,
    persona: role.prompt,
    toolFilter: { allow },
    agentOptions: agentOptionsFor(role.tier, llmProvider === undefined ? {} : { provider: llmProvider }),
    maxDepth: CHILD_DEPTH,
  }
}

const describeRole = (role) =>
  `${role.id}: ${role.description.en} Tools: ${capabilitiesFor(role).length === 0 ? 'none' : capabilitiesFor(role).join('/')}`

/**
 * Register the `delegate` tool on a context that already has `tools` and
 * `subagents`.
 * @param {any} ctx - plugin context.
 * @param {object} options - backend name, LLM route, and the roles this
 * deployment exposes.
 * @returns the exact disposer that unregisters it, so a roster edit can replace
 * the tool instead of colliding with it.
 */
export function registerDelegate(ctx, { subagentProvider = 'spawn', llmProvider, roles = ROLES } = {}) {
  const available = roles.map((role) => role.id)
  if (available.length === 0) throw new Error('delegate: no roles configured')

  return ctx.tools.register(
    defineTool({
      name: 'delegate',
      description: [
        'Delegate one unit of work to a specialist subagent whose identity, tool access, and model are fixed by its role.',
        'Use it for bulk work (one call per item, several calls in one turn) and for team work (a planner, a builder, a reviewer).',
        'The child cannot widen its own scope: a reviewer role has no write tool, a bulk role has no tools at all.',
        'Roles:',
        ...roles.map((role) => `- ${describeRole(role)}`),
      ].join('\n'),
      parameters: {
        role: {
          type: 'string',
          required: true,
          enum: available,
          description: 'Which specialist runs the unit. Its prompt, tools, and model tier are fixed by the roster.',
        },
        task: {
          type: 'string',
          required: true,
          description:
            'The unit, written for the child alone. For bulk work pass exactly one item; the child does not see this conversation.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { type: 'string', required: true },
            output: { type: 'string', required: true },
            stopReason: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: `[${value.role}] (${value.stopReason})\n${value.output}` },
        ],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent
        if (!parent) throw new Error('delegate requires a calling agent (exec.agent was undefined)')
        const role = roleById.get(args.role)
        if (role === undefined) {
          throw new Error(`delegate: unknown role "${args.role}"; available roles are ${available.join(', ')}`)
        }
        if (typeof args.task !== 'string' || args.task.trim().length === 0) {
          throw new Error('delegate: `task` must be a non-empty string')
        }

        const request = buildDelegateRequest(role, args.task, {
          llmProvider,
          parent,
          signal: exec.signal,
        })
        const run = await ctx.subagents.start(subagentProvider, request)
        try {
          const result = await run.result
          // Reasoning blocks are the child's private scratchpad, not its answer.
          const text = (result.output ?? [])
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('')
            .trim()
          return {
            role: role.id,
            output: text.length === 0 ? '(no output)' : text,
            stopReason: result.stopReason,
          }
        } finally {
          await run.dispose?.()
        }
      },
    }),
  )
}

/** The model-facing description for one role, used by tests and docs. */
export { toolNameFor }


