#!/usr/bin/env node
/**
 * Deterministic fan-out entry point.
 *
 * The measured weakness of the model-facing path is not the delegation itself
 * but the decision to delegate: given a six-item list, the free models tested
 * just did the work inline. So this entry point removes that decision. It takes
 * the items, launches one headless `dsh` run per item with a single forced
 * `delegate` call, and reads the child's answer out of the run's own tool-result
 * event rather than out of the parent's prose.
 *
 * That makes the shape a property of the invocation, not of the model's mood:
 * N items in, N role-children out, one per item.
 *
 * Usage:
 *   node bin/roster-fanout.mjs --profile subagent-lab --role batch-exact \
 *     --items-file items.json --contract "return one JSON object {text}"
 *
 *   node bin/roster-fanout.mjs --profile p --role batch-exact --item alpha --item beta
 *
 * Exit code is non-zero when any item failed, so a caller can gate on it.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readChildResult, taskFor } from '../lib/fanout.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? fallback : argv[index + 1]
}
const flags = (name) => argv.reduce((acc, value, index) => (value === `--${name}` ? [...acc, argv[index + 1]] : acc), [])

const profile = flag('profile', 'headless')
const role = flag('role', 'batch-exact')
const contract = flag('contract', '')
const concurrency = Math.max(1, Number(flag('concurrency', 3)))
const timeoutMs = Number(flag('timeout', 300000))
const expectJson = argv.includes('--expect-json')
const outFile = flag('out', '') || ''
const DSH_BIN =
  flag('dsh-bin', '') ||
  path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const itemsFile = flag('items-file', '')
let items = flags('item')
if (itemsFile !== '') {
  const parsed = JSON.parse(fs.readFileSync(itemsFile, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('items file must contain a JSON array')
  items = parsed.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
}
if (items.length === 0) {
  console.error('roster-fanout: no items. Pass --item or --items-file.')
  process.exit(2)
}

/**
 * One run is one item. The prompt comes from `lib/fanout.js` so it can be tested
 * without spawning anything.
 */
function runOne(item, index) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [DSH_BIN, '--profile', profile, '--json', taskFor({ role, item, contract, index, total: items.length })], {
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ index, item, ok: false, error: `timeout after ${timeoutMs}ms`, ms: Date.now() - started })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (code) => {
      clearTimeout(timer)
      const parsed = readChildResult(stdout, { expectJson })
      resolve({
        index,
        item,
        role,
        ok: parsed.ok && code === 0,
        output: parsed.output,
        error: parsed.ok ? (code === 0 ? undefined : stderr.slice(-400)) : parsed.error,
        ms: Date.now() - started,
      })
    })
  })
}

const results = []
let next = 0
let active = 0
await new Promise((done) => {
  const pump = () => {
    if (next === items.length && active === 0) return done()
    while (active < concurrency && next < items.length) {
      const index = next++
      active += 1
      runOne(items[index], index).then((result) => {
        active -= 1
        results[index] = result
        console.log(`${result.ok ? 'ok  ' : 'FAIL'} [${index + 1}/${items.length}] ${result.ms}ms ${result.ok ? '' : result.error}`)
        pump()
      })
    }
  }
  pump()
})

if (outFile !== '') {
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true })
  fs.writeFileSync(path.resolve(outFile), results.map((result) => JSON.stringify(result)).join('\n') + '\n')
}

const failed = results.filter((result) => !result.ok).length
console.log(`\n${results.length - failed}/${results.length} items delegated to role "${role}"`)
process.exit(failed === 0 ? 0 : 1)




