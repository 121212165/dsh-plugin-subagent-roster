#!/usr/bin/env node
/**
 * Re-grade a saved bench summary under the current verdict rules.
 *
 * A run killed by the case timeout is not a pass even when the child it managed
 * to spawn looked right, so an older summary can overstate its score. This
 * recomputes verdicts from the stored per-case evidence without spending a
 * single model call.
 *
 * Usage: node bench/regrade.mjs bench/results/summary-*.json [...]
 */

import fs from 'node:fs'
import path from 'node:path'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node bench/regrade.mjs <summary.json> [...]')
  process.exit(1)
}

for (const file of files) {
  const summary = JSON.parse(fs.readFileSync(file, 'utf8'))
  const rows = summary.rows.map((row) => {
    if (row.skipped) return row
    if (row.exit === null) return { ...row, verdict: 'TIMEOUT' }
    return row
  })
  const verdicts = rows.reduce((acc, row) => {
    acc[row.verdict] = (acc[row.verdict] ?? 0) + 1
    return acc
  }, {})
  const graded = rows.filter((row) => row.verdict !== 'SKIPPED')
  const passes = rows.filter((row) => row.verdict === 'PASS').length
  const out = {
    ...summary,
    regradedAt: new Date().toISOString(),
    regradeRule: 'exit === null becomes TIMEOUT, never PASS',
    passes,
    graded: graded.length,
    verdicts,
    rows,
  }
  const target = path.join(path.dirname(file), `${path.basename(file, '.json')}.regraded.json`)
  fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`${path.basename(file)}: ${passes}/${graded.length} pass  ${JSON.stringify(verdicts)}`)
  console.log(`  -> ${target}`)
}
