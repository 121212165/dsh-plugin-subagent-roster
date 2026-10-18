/**
 * The roster as deployment data.
 *
 * A roster that can only be changed by editing JavaScript is not something an
 * operator can run. So the shipped roles are a seed: on first start they are
 * written to `<DSH_HOME>/subagent-roster/roles.json`, and from then on that file
 * is what the plugin actually delegates with. The page in `page.js` edits it.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ROLES, TIERS, validateRoster } from './roster.js'

/** Capability sets a role may name, mirrored from the roster for validation. */
export const CAPABILITIES = ['blind', 'read', 'write', 'research']
export const LINES = ['bulk', 'team']

/** Where the deployment's data lives. Honours DSH_HOME exactly like the host. */
export function dshHome(env = process.env) {
  return env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : path.join(os.homedir(), '.dsh')
}

/** The editable roster document. */
export function rolesPath(env = process.env) {
  return path.join(dshHome(env), 'subagent-roster', 'roles.json')
}

const isText = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * Check one role's shape. Returns problems, never throws.
 * @param {any} role - candidate entry from the file or the page.
 * @param {number} index - position, for the message.
 */
export function validateRole(role, index) {
  const at = `roles[${index}]`
  const problems = []
  if (role === null || typeof role !== 'object') return [`${at} is not an object`]
  for (const field of ['id', 'position', 'temperament', 'line', 'tier', 'capability', 'prompt']) {
    if (!isText(role[field])) problems.push(`${at}.${field} must be a non-empty string`)
  }
  if (isText(role.id) && !/^[a-z0-9][a-z0-9-]*$/.test(role.id)) {
    problems.push(`${at}.id must be lowercase kebab-case`)
  }
  if (isText(role.line) && !LINES.includes(role.line)) problems.push(`${at}.line must be one of ${LINES.join(', ')}`)
  if (isText(role.tier) && !(role.tier in TIERS)) problems.push(`${at}.tier must be one of ${Object.keys(TIERS).join(', ')}`)
  if (isText(role.capability) && !CAPABILITIES.includes(role.capability)) {
    problems.push(`${at}.capability must be one of ${CAPABILITIES.join(', ')}`)
  }
  if (role.title !== undefined) {
    if (typeof role.title !== 'object' || !isText(role.title.en) || !isText(role.title.zh)) {
      problems.push(`${at}.title needs both en and zh`)
    }
  }
  if (role.description !== undefined) {
    if (typeof role.description !== 'object' || !isText(role.description.en) || !isText(role.description.zh)) {
      problems.push(`${at}.description needs both en and zh`)
    }
  }
  return problems
}

/** Check a whole document: shape per role, unique ids, and the roster invariants. */
export function validateRoles(roles) {
  if (!Array.isArray(roles)) return ['roster must be a JSON array of roles']
  if (roles.length === 0) return ['roster must contain at least one role']
  const problems = roles.flatMap((role, index) => validateRole(role, index))
  const seen = new Set()
  for (const role of roles) {
    if (!isText(role?.id)) continue
    if (seen.has(role.id)) problems.push(`duplicate role id "${role.id}"`)
    seen.add(role.id)
  }
  // Reuse the same invariants the shipped roster is held to.
  problems.push(...validateRoster({ roles }))
  return problems
}

/** Normalise a role into the shape the runtime consumes. */
export function normaliseRole(role) {
  return {
    id: role.id,
    position: role.position,
    temperament: role.temperament,
    line: role.line,
    tier: role.tier,
    capability: role.capability,
    order: Number.isFinite(role.order) ? role.order : 999,
    title: role.title ?? { en: role.id, zh: role.id },
    description: role.description ?? { en: '', zh: '' },
    prompt: role.prompt,
  }
}

/**
 * Read the deployment roster, seeding it from the shipped roles on first use.
 * @returns {{roles: object[], source: 'file'|'builtin'|'fallback', file: string, problems: string[]}}
 */
export function loadRoles(options = {}) {
  const file = options.file ?? rolesPath(options.env)
  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `${JSON.stringify(ROLES, null, 2)}\n`, 'utf8')
      return { roles: ROLES, source: 'builtin', file, problems: [] }
    } catch (error) {
      return { roles: ROLES, source: 'fallback', file, problems: [`could not seed roster file: ${error.message}`] }
    }
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    const problems = validateRoles(parsed)
    if (problems.length > 0) return { roles: ROLES, source: 'fallback', file, problems }
    return { roles: parsed.map(normaliseRole), source: 'file', file, problems: [] }
  } catch (error) {
    return { roles: ROLES, source: 'fallback', file, problems: [`could not read roster file: ${error.message}`] }
  }
}

/**
 * Replace the deployment roster. Validation happens before anything is written,
 * so a rejected document leaves the previous file intact.
 * @returns {{ok: boolean, problems: string[]}}
 */
export function saveRoles(roles, options = {}) {
  const file = options.file ?? rolesPath(options.env)
  const problems = validateRoles(roles)
  if (problems.length > 0) return { ok: false, problems }
  const document = roles.map(normaliseRole)
  const temporary = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, file)
  return { ok: true, problems: [] }
}
