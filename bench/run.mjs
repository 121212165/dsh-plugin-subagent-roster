#!/usr/bin/env node
/**
 * Real-run bench for dsh-plugin-subagent-roster.
 *
 * Every case is a headless parent turn against the local gateway. The point is
 * not to grade prose: it is to prove, from the gateway's own request log, that
 *   - the child that ran is the role the parent asked for (persona match),
 *   - that child ran on the tier's model (model match),
 *   - that child had the tools the role sanctions and no others (tool count),
 *   - and that a negative case really left the workspace untouched.
 *
 * Usage:
 *   node bench/run.mjs                # every case, once
 *   node bench/run.mjs --repeat 2     # every case, twice
 *   node bench/run.mjs --only bulk-   # id prefix filter
 *   node bench/run.mjs --budget 900   # stop before the gateway budget is gone
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROLES, TIERS, capabilitiesFor } from '../lib/roster.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const ws = path.join(repoRoot, '.bench-ws')
const resultsDir = path.join(here, 'results')
const logPath = path.join(here, 'state', 'calls.jsonl')
// Spawning the CLI's JS entry with the current node avoids the Windows shell
// entirely, which is what keeps task strings with quotes and angle brackets intact.
const DSH_BIN = path.join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'lib',
  'bin.js',
)
fs.mkdirSync(resultsDir, { recursive: true })

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? fallback : argv[index + 1]
}
const repeat = Number(flag('repeat', 1))
const only = flag('only', '')
const budget = Number(flag('budget', 950))
const timeoutMs = Number(flag('timeout', 300000))

const fixtures = {
  'bench-tmp/module.mjs': [
    'export function ratio(a, b) {',
    '  const scaled = a * 100',
    '  return scaled / b',
    '}',
    '',
    'export function label(item) {',
    "  return `${item.id}: ${ratio(item.done, item.total)}%`",
    '}',
    '',
  ].join('\n'),
  'bench-tmp/surgical.txt': 'ok\n',
}

for (const [rel, body] of Object.entries(fixtures)) {
  const target = path.join(ws, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body)
}

const personaOf = (systemChars) => {
  for (const role of ROLES) {
    const marker = role.prompt.split('\n')[0].slice(0, 60)
    if (systemChars.includes(marker)) return role
  }
  return undefined
}

const readCalls = () => {
  if (!fs.existsSync(logPath)) return []
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
}

const env = {
  ...process.env,
  DSH_HOME: path.join(repoRoot, '..', '.dsh-lab'),
  BENCH_KEY: 'local',
  ROSTER_PROVIDER: 'bench',
  ROSTER_BATCH_MODEL: process.env.ROSTER_BATCH_MODEL ?? 'cohere/north-mini-code:free',
  ROSTER_BUILD_MODEL: process.env.ROSTER_BUILD_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free',
  ROSTER_REVIEW_MODEL: process.env.ROSTER_REVIEW_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free',
  ROSTER_TEAM_MODEL: process.env.ROSTER_TEAM_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free',
}

const { cases } = JSON.parse(fs.readFileSync(path.join(here, 'cases.json'), 'utf8'))
const selected = cases.filter((testCase) => testCase.id.startsWith(only))
const runId = new Date().toISOString().replaceAll(':', '-').replace(/\..+/, '')
const rows = []

const before = readCalls().length
if (before > budget) {
  console.error(`refusing to run: ${before} calls already spent, budget ${budget}`)
  process.exit(1)
}

let spent = before
for (let round = 1; round <= repeat; round++) {
  for (const testCase of selected) {
    if (spent >= budget) {
      rows.push({ id: testCase.id, round, skipped: 'budget' })
      continue
    }
    const start = readCalls().length
    const startedAt = Date.now()
    const result = spawnSync(
      process.execPath,
      [DSH_BIN, '--profile', 'subagent-lab', testCase.task],
      {
        cwd: ws,
        env,
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    const calls = readCalls().slice(start).map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    const fresh = calls.filter(Boolean)
    spent = readCalls().length

    // A child is a request whose system prompt carries a roster persona. Anything
    // else with a small tool count is auxiliary traffic (session titles), which the
    // budget must still pay for but which is not a delegation.
    const classified = fresh.map((call) => {
      const role = personaOf(call.systemChars ?? '')
      return { model: call.model, persona: role?.id, toolCount: call.tools ?? 0, ms: call.ms, kind: role ? 'child' : 'aux' }
    })
    const children = classified.filter((call) => call.kind === 'child')
    const aux = classified.filter((call) => call.kind === 'aux').length
    const sawText = (result.stdout ?? '') + (result.stderr ?? '')
    const row = {
      id: testCase.id,
      round,
      exit: result.status,
      ms: Date.now() - startedAt,
      calls: fresh.length,
      children,
      aux,
      expected: testCase.expect,
      budgetLeft: budget - spent,
      answerTail: sawText.trim().split('\n').slice(-6).join('\n').slice(-700),
    }
    rows.push(row)
    console.log(
      `${testCase.id} #${round}: exit=${row.exit} calls=${row.calls} children=${children.length} ` +
        `[${children.map((child) => `${child.persona ?? '?'}@${child.model.split('/').pop()}`).join(' ')}] ${row.ms}ms`,
    )
  }
}

// ── Grade against the gateway evidence, not against the prose ────────────────
const roleById = new Map(ROLES.map((role) => [role.id, role]))
const graded = rows.map((row) => {
  if (row.skipped) return { ...row, verdict: 'SKIPPED' }
  const { role: expectedRole, line: expectedLine, minChildren = 1, negative } = row.expected
  const observed = row.children.map((child) => ({ ...child, role: roleById.get(child.persona) }))

  // A free-choice case names only the line: any role on that line is a hit.
  const roleHit = expectedRole
    ? observed.some((child) => child.persona === expectedRole)
    : observed.some((child) => child.role?.line === expectedLine)
  const tier = expectedRole === undefined ? undefined : roleById.get(expectedRole)?.tier
  const expectedModel = tier === undefined ? undefined : env[`ROSTER_${tier.toUpperCase()}_MODEL`]
  const tierHit = expectedModel === undefined ? true : observed.some((child) => child.model === expectedModel)

  // Every child must have exactly the tools its own role sanctions.
  const toolsOk = observed.every((child) => child.role !== undefined && child.toolCount === capabilitiesFor(child.role).length)

  let negativeOk = true
  if (negative === 'no-write') {
    const file = path.join(ws, 'bench-tmp/surgical.txt')
    const body = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '<missing>'
    negativeOk = body === 'ok'
  }
  if (negative === 'no-delegate') {
    // A blind child must report that it has no tools, and must not have spawned.
    negativeOk = row.children.length === 1 && /none|no tools|not have any tools|cannot/i.test(row.answerTail ?? '')
  }

  const spawned = observed.length >= minChildren
  const verdict = !spawned
    ? 'NO-CHILD'
    : !roleHit
      ? 'WRONG-ROLE'
      : !tierHit
        ? 'WRONG-TIER'
        : !toolsOk
          ? 'TOOL-LEAK'
          : !negativeOk
            ? 'NEGATIVE-FAILED'
            : 'PASS'
  return { ...row, verdict, roleHit, tierHit, spawned, toolsOk, negativeOk, observedRoles: observed.map((child) => child.persona) }
})
const passes = graded.filter((row) => row.verdict === 'PASS').length
const total = graded.filter((row) => !row.skipped).length
const spentTotal = readCalls().length
const summary = {
  runId,
  startedAt: new Date().toISOString(),
  cases: graded.length,
  graded: total,
  passes,
  verdicts: graded.reduce((acc, row) => ({ ...acc, [row.verdict]: (acc[row.verdict] ?? 0) + 1 }), {}),
  gatewayCalls: spentTotal,
  children: graded.reduce((acc, row) => acc + (row.children?.length ?? 0), 0),
  rows: graded,
}

const outFile = path.join(resultsDir, `summary-${runId}.json`)
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2))

console.log('')
console.log(`PASS ${passes}/${total}  calls(monotonic)=${spentTotal}  children=${summary.children}`)
console.log(`verdicts ${JSON.stringify(summary.verdicts)}`)
console.log(`summary -> ${outFile}`)


