import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROLES, TIERS, agentOptionsFor, capabilitiesFor, roleIds, validateRoster } from '../lib/roster.js'
import { buildDelegateRequest, registerDelegate } from '../lib/delegate.js'
import { renderPatch } from '../lib/patch.js'
import { loadRoles, saveRoles, validateRoles } from '../lib/store.js'
import { startPage } from '../lib/page.js'
import { readChildResult, taskFor } from '../lib/fanout.js'
import { apply, routingText } from '../lib/index.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const committed = fs.readFileSync(path.join(repoRoot, 'cordis.patch.yml'), 'utf8')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-test-'))
let fileSeq = 0
const rosterFile = () => path.join(tmpDir, `roles-${fileSeq++}.json`)
const cloneRoles = () => structuredClone(ROLES)

function fakeCtx() {
  const sections = []
  const warnings = []
  const registered = []
  return {
    sections,
    warnings,
    registered,
    logger: { warn: (message) => warnings.push(message) },
    effect: (fn) => fn(),
    tools: { register: (tool) => { registered.push(tool); return () => {} } },
    subagents: {},
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

test('every role has a unique id and a deep-enough persona', () => {
  assert.equal(new Set(roleIds()).size, ROLES.length)
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

test('bulk units are blind: no tools at all', () => {
  for (const role of ROLES.filter((candidate) => candidate.line === 'bulk')) {
    assert.deepEqual(capabilitiesFor(role), [], `${role.id} must have no tools`)
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

test('a role request carries its persona, filter, tier, and depth together', () => {
  for (const role of ROLES) {
    const request = buildDelegateRequest(role, 'do the thing', { llmProvider: 'bench', parent: { id: 'p' } })
    const options = agentOptionsFor(role.tier, { provider: 'bench' })
    assert.equal(request.persona, role.prompt, `${role.id} persona not pinned on the request`)
    assert.deepEqual(request.toolFilter, { allow: capabilitiesFor(role) })
    assert.deepEqual(request.agentOptions, options)
    assert.equal(request.maxDepth, 1, 'a role child sits one level deep')
    assert.equal(request.label, `delegate:${role.id}`)
    assert.equal(request.prompt[0].text, 'do the thing')
    assert.ok(request.toolFilter.allow.every((tool) => !tool.startsWith('subagent')), `${role.id} could delegate`)
  }
})

test('an unknown role cannot produce a request', () => {
  assert.throws(() => buildDelegateRequest(undefined, 'x'), /unknown role/)
})

test('cordis.patch.yml is generated and mounts exactly one plugin', () => {
  assert.equal(committed, renderPatch())
  const rows = committed.match(/^ {4}- id: /gm) ?? []
  assert.equal(rows.length, 1, 'the composition must not grow a row per role')
  assert.ok(committed.includes("name: 'dsh-plugin-subagent-roster'"))
  for (const role of ROLES) {
    assert.ok(!committed.includes(`id: roster-${role.id}`), `${role.id} leaked back into the composition`)
  }
})

test('the delegate tool exposes exactly the roster as its enum', () => {
  const ctx = fakeCtx()
  registerDelegate(ctx, { subagentProvider: 'spawn' })
  assert.equal(ctx.registered.length, 1)
  const tool = ctx.registered[0]
  assert.equal(tool.name, 'delegate')
  const schema = tool.parameters
  assert.equal(schema.type, 'object')
  const roleParam = schema.properties.role
  assert.ok(roleParam, 'delegate must take a role')
  assert.deepEqual([...roleParam.enum].sort(), [...roleIds()].sort())
  assert.ok(schema.required.includes('role'))
  assert.ok(schema.required.includes('task'))
})

test('the delegate description states each role capability, including tool-free bulk units', () => {
  const ctx = fakeCtx()
  registerDelegate(ctx, { subagentProvider: 'spawn' })
  const description = ctx.registered[0].description
  for (const role of ROLES) assert.ok(description.includes(role.id), `description omits ${role.id}`)
  assert.ok(description.includes('Tools: none'), 'blind roles must be advertised as tool-free')
  assert.ok(description.includes('cannot widen its own scope'))
})

test('routing text points at the one tool and names every role', () => {
  const text = routingText()
  assert.ok(text.includes('`delegate`'), 'routing must name the tool the model actually has')
  for (const role of ROLES) assert.ok(text.includes(role.id), `routing omits ${role.id}`)
  assert.ok(!/undefined/.test(text))
  assert.ok(text.includes('routing error'), 'the bulk trigger must be stated as an error, not a preference')
})

test('strict mode refuses an incoherent roster, advisory mode only warns', () => {
  assert.throws(
    () => apply(fakeCtx(), { mode: 'strict', provider: 'bench', allowedModels: ['bench/only-this-model'], pagePort: 0, rosterFile: rosterFile() }),
    /composition problem/,
  )
  const warned = fakeCtx()
  apply(warned, { mode: 'advisory', provider: 'bench', allowedModels: ['bench/only-this-model'], pagePort: 0, rosterFile: rosterFile() })
  assert.equal(warned.warnings.length, 1)
  assert.match(warned.warnings[0], /allow-list forbids/)
  assert.equal(warned.sections.length, 1, 'advisory still mounts the routing section')
})

test('a clean roster mounts one routing section', () => {
  const ctx = fakeCtx()
  apply(ctx, { mode: 'strict', pagePort: 0, rosterFile: rosterFile() })
  assert.equal(ctx.warnings.length, 0)
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.sections[0].name, 'roster:routing')
  assert.equal(ctx.sections[0].order, 100)
  assert.ok(ctx.sections[0].text.length > 500)
})

test('routing guidance can be switched off while the roster check still runs', () => {
  const ctx = fakeCtx()
  apply(ctx, { mode: 'strict', routingGuidance: false, pagePort: 0, rosterFile: rosterFile() })
  assert.equal(ctx.sections.length, 0)
})

test('an unknown tier fails loudly instead of falling back', () => {
  assert.throws(() => agentOptionsFor('nope'), /unknown tier "nope"/)
})

test('tiers stay distinguishable in logs', () => {
  const routes = Object.keys(TIERS).map((tier) => agentOptionsFor(tier).model)
  assert.ok(routes.every((route) => typeof route === 'string' && route.length > 0))
})






test('the store seeds a roster file and round-trips it', () => {
  const file = rosterFile()
  const seeded = loadRoles({ file })
  assert.equal(seeded.source, 'builtin')
  assert.equal(seeded.roles.length, ROLES.length)
  assert.ok(fs.existsSync(file), 'first start must write the seed so an operator can edit it')

  const edited = loadRoles({ file }).roles.map((role) => ({ ...role, order: role.order + 1 }))
  assert.deepEqual(saveRoles(edited, { file }), { ok: true, problems: [] })
  const reloaded = loadRoles({ file })
  assert.equal(reloaded.source, 'file')
  assert.equal(reloaded.roles[0].order, ROLES[0].order + 1)
})

test('an invalid roster is rejected before it reaches the disk', () => {
  const file = rosterFile()
  loadRoles({ file })
  const before = fs.readFileSync(file, 'utf8')
  const broken = cloneRoles()
  broken[0].tier = 'nope'
  const result = saveRoles(broken, { file })
  assert.equal(result.ok, false)
  assert.match(result.problems.join('\n'), /tier must be one of/)
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a rejected save must leave the previous roster intact')
})

test('a corrupt roster file falls back to the shipped roles instead of crashing', () => {
  const file = rosterFile()
  fs.writeFileSync(file, '{ not json')
  const loaded = loadRoles({ file })
  assert.equal(loaded.source, 'fallback')
  assert.equal(loaded.roles.length, ROLES.length)
  assert.ok(loaded.problems.length > 0)
})

test('validateRoles catches duplicate ids and empty rosters', () => {
  assert.match(validateRoles([]).join('\n'), /at least one role/)
  const dup = cloneRoles()
  dup.push(structuredClone(dup[0]))
  assert.match(validateRoles(dup).join('\n'), /duplicate role id/)
})

test('the operations page serves the editor and applies a roster over HTTP', async () => {
  const file = rosterFile()
  const loaded = loadRoles({ file })
  let applied = null
  const page = startPage({
    port: 4399,
    state: () => ({
      roles: loaded.roles,
      tiers: Object.keys(TIERS),
      capabilities: ['blind', 'read', 'write', 'research'],
      lines: ['bulk', 'team'],
      file,
      source: loaded.source,
    }),
    save: (roles) => saveRoles(roles, { file }),
    onApply: async (roles) => {
      applied = roles
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 150))

  const state = await (await fetch('http://127.0.0.1:4399/api/state')).json()
  assert.equal(state.roles.length, ROLES.length)

  const html = await (await fetch('http://127.0.0.1:4399/')).text()
  assert.match(html, /Subagent roster/)
  assert.match(html, /api\/state/)

  const next = cloneRoles().map((role) => ({ ...role, order: 1 }))
  const put = await fetch('http://127.0.0.1:4399/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roles: next }),
  })
  assert.equal(put.status, 200)
  assert.equal(applied.length, next.length)
  assert.equal(loadRoles({ file }).roles[0].order, 1, 'the page must persist what it applied')

  const bad = await fetch('http://127.0.0.1:4399/api/state', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roles: [] }),
  })
  assert.equal(bad.status, 400)
  await page.close()
})

test('a roster edit can replace the delegate tool instead of colliding with it', () => {
  const names = new Set()
  const ctx = {
    tools: {
      register(tool) {
        if (names.has(tool.name)) throw new Error(`tool "${tool.name}" is already registered`)
        names.add(tool.name)
        return () => names.delete(tool.name)
      },
    },
  }
  const first = registerDelegate(ctx, { roles: ROLES })
  assert.equal(typeof first, 'function', 'registerDelegate must hand back its disposer')
  assert.throws(() => registerDelegate(ctx, { roles: ROLES }), /already registered/)
  first()
  const second = registerDelegate(ctx, { roles: ROLES })
  assert.ok(names.has('delegate'))
  second()
  assert.equal(names.size, 0)
})

test('the fan-out prompt delimits the item so a parent cannot fold it into the instruction', () => {
  const prompt = taskFor({ role: 'batch-exact', item: 'alpha', contract: 'one JSON object', index: 0, total: 2 })
  assert.match(prompt, /role "batch-exact"/)
  // The contract must live inside the block the child receives, not beside it.
  assert.match(prompt, /--- task \(verbatim\) ---\nalpha\n\nOutput contract: one JSON object\n--- end task ---/)
  assert.match(prompt, /Output contract: one JSON object/)
  assert.match(prompt, /item 1 of 2/)
})

test('a fan-out item only counts as done when the child finished', () => {
  const event = (type, extra) => JSON.stringify({ type, ...extra })
  const stream = (result, status = 'completed') =>
    [
      event('tool_call', { callId: 'c1', tool: 'delegate', input: {} }),
      event('tool_result', { callId: 'c1', status, result }),
    ].join('\n')

  assert.deepEqual(readChildResult(stream('[batch-exact] (completed)\n{"text":"alpha"}'), { expectJson: true }).ok, true)
  assert.equal(readChildResult(stream('[batch-exact] (error)\n(no output)')).ok, false)
  assert.equal(readChildResult(stream('[batch-exact] (completed)\nalpha')).ok, true)
  assert.equal(readChildResult(stream('[batch-exact] (completed)\nalpha'), { expectJson: true }).error, 'output is not JSON')
  assert.equal(readChildResult(stream('boom', 'error')).ok, false)
  assert.equal(readChildResult('{"type":"thinking"}').error, 'no delegate tool_result in the run')
})



