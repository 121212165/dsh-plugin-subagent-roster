import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROLES, TIERS, agentOptionsFor, capabilitiesFor, roleIds, toolNameFor, validateRoster } from '../lib/roster.js'
import { renderPatch } from '../lib/patch.js'
import { apply, routingText } from '../lib/index.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const committed = fs.readFileSync(path.join(repoRoot, 'cordis.patch.yml'), 'utf8')

function fakeCtx() {
  const sections = []
  const warnings = []
  return {
    sections,
    warnings,
    logger: { warn: (message) => warnings.push(message) },
    effect: (fn) => fn(),
    systemPrompt: {
      getSectionOrder: () => 100,
      section: (section) => {
        sections.push(section)
        return () => {}
      },
    },
  }
}

test('the roster is internally coherent', () => {
  assert.deepEqual(validateRoster(), [])
})

test('every role has a unique id and a unique tool name', () => {
  assert.equal(new Set(roleIds()).size, ROLES.length)
  const toolNames = ROLES.map(toolNameFor)
  assert.equal(new Set(toolNames).size, ROLES.length)
  for (const name of toolNames) assert.match(name, /^subagent_[a-z][a-z0-9_]*$/)
})

test('every persona is long enough to constrain a child and leaks no placeholder', () => {
  for (const role of ROLES) {
    assert.ok(role.prompt.length > 200, `${role.id} persona is too thin`)
    assert.ok(!/\bundefined\b|\$\{/.test(role.prompt), `${role.id} persona leaked a placeholder`)
  }
})

test('the same position carries several temperaments with different prompts', () => {
  const byPosition = new Map()
  for (const role of ROLES) {
    byPosition.set(role.position, (byPosition.get(role.position) ?? new Set()).add(role.temperament))
  }
  const varied = [...byPosition.entries()].filter(([, temperaments]) => temperaments.size >= 2)
  assert.ok(varied.length >= 3, `expected at least 3 positions with variants, got ${varied.length}`)
  for (const [position] of varied) {
    const prompts = ROLES.filter((role) => role.position === position).map((role) => role.prompt)
    assert.equal(new Set(prompts).size, prompts.length, `${position} variants share a prompt`)
  }
})

test('bulk units are blind: no tools, no children', () => {
  for (const role of ROLES.filter((candidate) => candidate.line === 'bulk')) {
    assert.deepEqual(capabilitiesFor(role), [], `${role.id} must have no tools`)
    assert.equal(role.capability, 'blind')
  }
})

test('reviewers and researchers cannot modify the workspace', () => {
  for (const role of ROLES.filter((candidate) => ['reviewer', 'researcher'].includes(candidate.position))) {
    const tools = capabilitiesFor(role)
    for (const forbidden of ['write', 'edit', 'pwsh']) {
      assert.ok(!tools.includes(forbidden), `${role.id} can ${forbidden}`)
    }
  }
})

test('every role is pinned to a known tier and a tier-appropriate token ceiling', () => {
  for (const role of ROLES) {
    assert.ok(role.tier in TIERS, `${role.id} tier`)
    const options = agentOptionsFor(role.tier)
    assert.ok(options.maxTokens > 0)
    assert.equal(options.provider, agentOptionsFor(role.tier).provider)
  }
})

test('cordis.patch.yml is generated from the roster and is current', () => {
  assert.equal(committed, renderPatch(), 'run `node scripts/gen-patch.mjs`')
})

test('the composition pins one tool-subagent row per role', () => {
  const rows = committed.match(/^ {4}- id: roster-/gm) ?? []
  assert.equal(rows.length, ROLES.length)
  for (const role of ROLES) {
    assert.ok(committed.includes(`toolName: '${toolNameFor(role)}'`), `missing tool for ${role.id}`)
    assert.ok(committed.includes(role.prompt.split('\n')[0]), `missing persona text for ${role.id}`)
    assert.ok(committed.includes(`- id: roster-${role.id}`), `missing row ${role.id}`)
  }
  assert.ok(committed.includes("name: 'dsh-plugin-subagent-roster'"), 'the bundle must mount its own validator')
})

test('every row sits at delegation depth one and grants no subagent tool', () => {
  // Depth is an absolute cap on the child's depth, so 0 would refuse to spawn a
  // child at all. One level is what a role child needs; being a leaf comes from
  // the tool filter, which never names a subagent tool.
  const depths = [...committed.matchAll(/^ {8}maxDepth: (\d+)$/gm)].map((match) => match[1])
  assert.equal(depths.length, ROLES.length)
  assert.ok(depths.every((depth) => depth === '1'), 'a child must be allowed to exist')
  for (const role of ROLES) {
    assert.ok(!capabilitiesFor(role).some((tool) => tool.startsWith('subagent')), `${role.id} could delegate`)
  }
  assert.ok(!/allow: \[[^\]]*'subagent/.test(committed), 'no allow-list may grant a subagent tool')
})

test('blind roles get an empty allow-list, others a non-empty one', () => {
  const blind = ROLES.filter((role) => capabilitiesFor(role).length === 0)
  assert.ok(blind.length >= 3, 'the bulk line must be blind')
  assert.equal([...committed.matchAll(/^ {10}allow: \[\]$/gm)].length, blind.length)
  for (const role of ROLES.filter((candidate) => capabilitiesFor(candidate).length > 0)) {
    const rendered = capabilitiesFor(role).map((tool) => `'${tool}'`).join(', ')
    assert.ok(committed.includes(`allow: [${rendered}]`), `${role.id} allow-list missing`)
  }
})

test('model pinning is env-overridable, never a bare literal', () => {
  const pins = committed.split('\n').filter((line) => /^ {10}(model|maxTokens|provider):/.test(line))
  assert.equal(pins.length, ROLES.length * 3)
  for (const line of pins) assert.ok(line.includes('!!js'), `hardcoded pin: ${line.trim()}`)
})

test('routing text describes exactly the mounted tools', () => {
  const text = routingText()
  for (const role of ROLES) assert.ok(text.includes(toolNameFor(role)), `routing omits ${role.id}`)
  assert.ok(!/undefined/.test(text))
  const mentioned = [...text.matchAll(/`(subagent_[a-z0-9_]+)`/g)].map((match) => match[1])
  assert.deepEqual([...new Set(mentioned)].sort(), ROLES.map(toolNameFor).sort())
})

test('routing text states the capability of each role', () => {
  const text = routingText()
  assert.ok(text.includes('pure transform'), 'blind roles must be advertised as tool-free')
  assert.ok(text.includes('read, write, edit'), 'builders must advertise their write tools')
})

test('strict mode refuses an incoherent roster, advisory mode only warns', () => {
  assert.throws(
    () => apply(fakeCtx(), { mode: 'strict', provider: 'bench', allowedModels: ['bench/only-this-model'] }),
    /composition problem/,
  )
  const warned = fakeCtx()
  apply(warned, { mode: 'advisory', provider: 'bench', allowedModels: ['bench/only-this-model'] })
  assert.equal(warned.warnings.length, 1)
  assert.match(warned.warnings[0], /allow-list forbids/)
  assert.equal(warned.sections.length, 1, 'advisory still mounts the routing section')
})

test('a clean roster mounts exactly one routing section', () => {
  const ctx = fakeCtx()
  apply(ctx, { mode: 'strict' })
  assert.equal(ctx.warnings.length, 0)
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.sections[0].name, 'roster:routing')
  assert.equal(ctx.sections[0].order, 100)
  assert.ok(ctx.sections[0].text.length > 500)
})

test('routing guidance can be switched off without failing the roster check', () => {
  const ctx = fakeCtx()
  apply(ctx, { mode: 'strict', routingGuidance: false })
  assert.equal(ctx.sections.length, 0)
})

test('an unknown tier fails loudly instead of falling back', () => {
  assert.throws(() => agentOptionsFor('nope'), /unknown tier "nope"/)
})
