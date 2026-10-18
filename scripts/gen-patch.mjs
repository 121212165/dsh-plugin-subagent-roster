#!/usr/bin/env node
/**
 * Write `cordis.patch.yml` from `lib/roster.js`.
 *
 * Usage: node scripts/gen-patch.mjs [--check]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLES, TIERS } from '../lib/roster.js'
import { renderPatch } from '../lib/patch.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(path.resolve(here, '..'), 'cordis.patch.yml')

const next = renderPatch()

if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  if (current !== next) {
    console.error('cordis.patch.yml is stale: run `node scripts/gen-patch.mjs`')
    process.exit(1)
  }
  console.log('cordis.patch.yml is current')
} else {
  fs.writeFileSync(target, next)
  console.log(
    `wrote cordis.patch.yml (${ROLES.length} roles, ${Object.keys(TIERS).length} tiers)`,
  )
}
