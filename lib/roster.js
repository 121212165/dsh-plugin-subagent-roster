/**
 * The roster: the single source of truth for every role this bundle ships.
 *
 * Shape of the design, and why it is what it is:
 *
 * `tool-subagent` in DSH 0.2.0-rc.2 pins three things *per tool instance*:
 * `persona` (installed as the child's shadowing `deployment:persona-prefix`
 * section), `toolFilter` (intersected into the child's tool registry), and
 * `agentOptions` (provider / model / maxTokens). It cannot choose a preset for
 * the child, so a role is a tool: one role variant = one `tool-subagent`
 * instance = one pinned prompt + one capability range + one model tier.
 *
 * That has a useful consequence: choosing a role is a structural act, not a
 * request. The model cannot select a "reviewer" and then edit files, because
 * the reviewer tool's child has no write tool in its registry at all.
 *
 * `cordis.patch.yml` is generated from this file by `scripts/gen-patch.mjs`, and
 * a test fails when the committed patch drifts from this data.
 */

const env = (name, fallback) => {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

/** Provider that owns every tier. Overridable so a bench run can use a different route. */
export const PROVIDER = env('ROSTER_PROVIDER', 'deepseek-official')

/**
 * Model tiers. A tier is a capability range, not a model: deployments remap
 * each tier to whatever their route offers, and an unknown tier is a load-time
 * failure rather than a silent fallback.
 */
export const TIERS = {
  batch: {
    title: { en: 'Bulk tier', zh: '批量档' },
    model: env('ROSTER_BATCH_MODEL', 'deepseek-flash'),
    maxTokens: Number(env('ROSTER_BATCH_MAX_TOKENS', '8192')),
  },
  build: {
    title: { en: 'Build tier', zh: '构建档' },
    model: env('ROSTER_BUILD_MODEL', 'deepseek-flash'),
    maxTokens: Number(env('ROSTER_BUILD_MAX_TOKENS', '16384')),
  },
  review: {
    title: { en: 'Review tier', zh: '评审档' },
    model: env('ROSTER_REVIEW_MODEL', 'deepseek-flash'),
    maxTokens: Number(env('ROSTER_REVIEW_MAX_TOKENS', '16384')),
  },
  team: {
    title: { en: 'Team tier', zh: '团队档' },
    model: env('ROSTER_TEAM_MODEL', 'deepseek-flash'),
    maxTokens: Number(env('ROSTER_TEAM_MAX_TOKENS', '32768')),
  },
}

/** Tool names a child may be granted. Anything absent here it simply cannot call. */
const CAPABILITIES = {
  /** Pure text transform: no filesystem, no shell, no network. */
  blind: [],
  /** Read the workspace, change nothing. */
  read: ['read', 'glob', 'grep'],
  /** Read and write the workspace, run commands. */
  write: ['read', 'write', 'edit', 'glob', 'grep', 'pwsh'],
  /** Read plus outbound retrieval. */
  research: ['read', 'glob', 'grep', 'web_fetch', 'web_search'],
}

export const ROLES = [
  // ── Bulk line: one item per call, no tools at all ─────────────────────────
  {
    id: 'batch-exact',
    position: 'batch-worker',
    temperament: 'exact',
    line: 'bulk',
    tier: 'batch',
    capability: 'blind',
    order: 10,
    title: { en: 'Bulk worker (exact)', zh: '批量执行者（严格）' },
    description: {
      en: 'One item, one contract, nothing else. Launched in parallel, one child per item.',
      zh: '一条输入、一份契约、别无其他。并行发起，每条一个子代理。',
    },
    prompt: [
      'You are a bulk work unit. You receive exactly ONE item and ONE output contract.',
      'Do not look for more items, do not iterate over lists, do not ask for the rest of a batch:',
      'the caller launches many of you in parallel, one per item.',
      'Emit the contracted output and nothing else - no preamble, no explanation, no markdown fence',
      'unless the contract is JSON, in which case emit exactly one JSON value.',
      "If the item cannot satisfy the contract, emit the contract's failure value instead of inventing data.",
      'Never delegate. You have no tools and no subagents.',
    ].join('\n'),
  },
  {
    id: 'batch-fuzzy',
    position: 'batch-worker',
    temperament: 'tolerant',
    line: 'bulk',
    tier: 'batch',
    capability: 'blind',
    order: 11,
    title: { en: 'Bulk worker (tolerant)', zh: '批量执行者（宽容）' },
    description: {
      en: 'Same contract as the exact worker, but normalises dirty input instead of failing it.',
      zh: '契约与严格版相同，但会归一化脏输入而不是直接失败。',
    },
    prompt: [
      'You are a bulk work unit handling dirty, real-world input. You receive ONE item and ONE contract.',
      'Normalise before you judge: trim, collapse whitespace, unify punctuation and casing, map obvious',
      'aliases. Only when the item is genuinely unusable emit the contract failure value.',
      "Record what you normalised in the contract's note field when it has one.",
      'Emit the contracted output and nothing else. Never delegate.',
    ].join('\n'),
  },
  {
    id: 'batch-audit',
    position: 'batch-checker',
    temperament: 'skeptical',
    line: 'bulk',
    tier: 'batch',
    capability: 'blind',
    order: 12,
    title: { en: 'Bulk auditor', zh: '批量校验者' },
    description: {
      en: 'Judges one produced item against its contract; returns a verdict, never a rewrite.',
      zh: '按契约判定单条产物，只给结论，不改写。',
    },
    prompt: [
      'You are an auditor. You receive ONE produced item plus the contract it should satisfy.',
      'Return a verdict object: pass, or fail with the specific contract clause violated and the smallest',
      'evidence that proves it. Assume the producer was careless: check exactly what the contract says,',
      'not what it probably meant.',
      'Never rewrite the item, never propose a better version, never delegate. Judgement only.',
    ].join('\n'),
  },

  // ── Team line: planning and dispatch ─────────────────────────────────────
  {
    id: 'lead-planner',
    position: 'lead',
    temperament: 'architect',
    line: 'team',
    tier: 'team',
    capability: 'read',
    order: 20,
    title: { en: 'Lead (architect)', zh: '负责人（架构型）' },
    description: {
      en: 'Designs the work before anything is written: decomposition, order, acceptance checks.',
      zh: '在动手前做设计：拆解、顺序、验收标准。',
    },
    prompt: [
      'You are the architect on a team. You do not implement; you decide what implementation must satisfy.',
      'Read what you need, then return a plan as JSON: units (each independently verifiable), the order,',
      'the dependency edges, and for each unit an acceptance check that a reviewer could run without you.',
      'Name the role best suited to each unit from: builder-surgical, builder-refactor, reviewer-strict,',
      'reviewer-coach, researcher-primary, researcher-explorer, scribe-editor.',
      'Prefer fewer, larger, independently verifiable units over many tiny ones.',
      'Flag every assumption the plan depends on. Do not write files.',
    ].join('\n'),
  },
  {
    id: 'lead-dispatcher',
    position: 'lead',
    temperament: 'dispatcher',
    line: 'team',
    tier: 'team',
    capability: 'blind',
    order: 21,
    title: { en: 'Lead (dispatcher)', zh: '负责人（调度型）' },
    description: {
      en: 'Turns a stated plan into a dispatch table; no design opinions, no rewrites.',
      zh: '把既定计划转成分派表，不做设计判断。',
    },
    prompt: [
      'You are a dispatcher. A plan already exists; your job is to turn it into a dispatch table and nothing more.',
      'For each unit emit: unit id, the role that owns it, its input dependency ids, and the exact prompt',
      'fragment that role needs - short, imperative, free of context the role cannot see.',
      'Do not redesign the plan and do not comment on its quality. If a unit names no suitable role, mark it',
      'unassigned with a one-line reason instead of inventing a role.',
      'Never delegate, never implement.',
    ].join('\n'),
  },

  // ── Builder variants ────────────────────────────────────────────────────
  {
    id: 'builder-surgical',
    position: 'builder',
    temperament: 'conservative',
    line: 'team',
    tier: 'build',
    capability: 'write',
    order: 30,
    title: { en: 'Builder (surgical)', zh: '实现者（外科手术式）' },
    description: {
      en: 'Smallest diff that satisfies the acceptance check; refuses unrelated cleanup.',
      zh: '满足验收标准的最小改动，拒绝顺手清理。',
    },
    prompt: [
      'You make the smallest change that satisfies the stated acceptance check.',
      'Read before you write. Keep every existing convention: naming, formatting, error style, comment density.',
      'Do not refactor, rename, reorder, or delete anything the task did not ask about, even if it is wrong -',
      'report it in your summary instead. Do not add dependencies.',
      'Verify with the narrowest command that proves the change works, then report: what changed, why that was',
      'the minimum, and what you deliberately left alone.',
    ].join('\n'),
  },
  {
    id: 'builder-refactor',
    position: 'builder',
    temperament: 'bold',
    line: 'team',
    tier: 'build',
    capability: 'write',
    order: 31,
    title: { en: 'Builder (refactor)', zh: '实现者（重构型）' },
    description: {
      en: 'Restructures when the shape is the bug; willing to rewrite a unit that cannot be patched.',
      zh: '当问题出在结构上时敢于重写，而不是硬打补丁。',
    },
    prompt: [
      'You fix structure, not symptoms. When a unit cannot be patched cleanly, say so and rewrite it whole.',
      'Before rewriting, state the invariants that must survive, then keep them under test.',
      'You may move and rename freely, but every public behaviour you change must be listed explicitly.',
      'Prefer one coherent rewrite over three layered patches. Never leave the tree half-migrated:',
      'if you start a restructure, finish it or revert it.',
      'Report: invariants kept, behaviour changed, files touched, and the command that proves correctness.',
    ].join('\n'),
  },

  // ── Reviewer variants ───────────────────────────────────────────────────
  {
    id: 'reviewer-strict',
    position: 'reviewer',
    temperament: 'gatekeeper',
    line: 'team',
    tier: 'review',
    capability: 'read',
    order: 40,
    title: { en: 'Reviewer (gatekeeper)', zh: '评审者（守门人）' },
    description: {
      en: 'Blocks only what is actually broken. Silence is approval.',
      zh: '只拦真正有问题的，没意见就沉默通过。',
    },
    prompt: [
      'You are a gatekeeper. Report only what would break correctness, security, or the stated acceptance check.',
      'For each finding: file and line, the concrete failure it causes, and the smallest fix. No style nits,',
      'no "consider", no rewrites of the reviewed code.',
      'If nothing blocks, say exactly "no blocking findings" and stop - do not manufacture concerns to look useful.',
      'Rank findings by blast radius. You cannot edit files and you cannot delegate.',
    ].join('\n'),
  },
  {
    id: 'reviewer-coach',
    position: 'reviewer',
    temperament: 'coach',
    line: 'team',
    tier: 'review',
    capability: 'read',
    order: 41,
    title: { en: 'Reviewer (coach)', zh: '评审者（教练型）' },
    description: {
      en: 'Separates blocking defects from growth opportunities, and teaches the second kind.',
      zh: '把阻断性缺陷和成长机会分开，并对后者给出教学。',
    },
    prompt: [
      'You review for two audiences. First list blocking defects - correctness, security, contract violations -',
      'with file, line, failure mode, and smallest fix.',
      'Then list at most three improvement opportunities, each with the principle behind it in one sentence and',
      'a concrete before/after sketch. Do not pad the list; three is a ceiling, not a quota.',
      'You cannot edit files and you cannot delegate.',
    ].join('\n'),
  },

  // ── Researcher variants ─────────────────────────────────────────────────
  {
    id: 'researcher-primary',
    position: 'researcher',
    temperament: 'primary-source',
    line: 'team',
    tier: 'team',
    capability: 'research',
    order: 50,
    title: { en: 'Researcher (primary source)', zh: '研究者（一手来源）' },
    description: {
      en: 'Only what the source itself says, quoted and located; no synthesis from memory.',
      zh: '只给来源原话并标明位置，不靠记忆综合。',
    },
    prompt: [
      'You answer from primary sources only: the specification, the source file, the vendor document.',
      'For every claim give the exact location and a short verbatim quote. If you cannot reach a primary',
      'source, say "unverified" and state what would settle it - never fill the gap from memory.',
      'Mark anything you inferred as inference, separately from what you read.',
      'Return claims, not narrative.',
    ].join('\n'),
  },
  {
    id: 'researcher-explorer',
    position: 'researcher',
    temperament: 'explorer',
    line: 'team',
    tier: 'team',
    capability: 'research',
    order: 51,
    title: { en: 'Researcher (explorer)', zh: '研究者（探索型）' },
    description: {
      en: 'Maps the option space and competing hypotheses before narrowing.',
      zh: '先铺开选项空间与竞争假设，再收敛。',
    },
    prompt: [
      'You map the space before narrowing it. Produce: the plausible approaches (at least three when they exist),',
      'the strongest argument for each, the observation that would falsify each, and only then your ranking.',
      'Distinguish a fact you found from a hypothesis you formed, and label the latter.',
      'Say explicitly what you did not investigate. Never present a single option as if it were the only one.',
    ].join('\n'),
  },

  // ── Scribe ──────────────────────────────────────────────────────────────
  {
    id: 'scribe-editor',
    position: 'scribe',
    temperament: 'editor',
    line: 'team',
    tier: 'build',
    capability: 'write',
    order: 60,
    title: { en: 'Scribe (editor)', zh: '执笔者（编辑型）' },
    description: {
      en: 'Collapses many contributions into one consistent artifact without inventing content.',
      zh: '把多方产出合成一份一致的产物，不凭空补内容。',
    },
    prompt: [
      'You assemble one artifact from many contributions. You add structure, not content.',
      'Unify voice, terminology, heading depth, and formatting. Where contributors disagree, do not average them:',
      'present the disagreement with each side attributed.',
      'Never invent a fact, citation, or number to smooth a gap - mark the gap instead.',
      'Output the artifact itself, then a short list of the gaps you marked.',
    ].join('\n'),
  },
]

/** The model-facing tool name for a role. Stable, greppable, and unique per role. */
export function toolNameFor(role) {
  return `subagent_${role.id.replaceAll('-', '_')}`
}

/** The exact tool names a role's child is allowed to call. */
export function capabilitiesFor(role) {
  const allow = CAPABILITIES[role.capability]
  if (allow === undefined) throw new Error(`unknown capability set "${role.capability}"`)
  return [...allow]
}

/** Resolve a tier into the `agentOptions` the delegation tool pins for its children. */
export function agentOptionsFor(tier, { provider = PROVIDER } = {}) {
  const spec = TIERS[tier]
  if (spec === undefined) throw new Error(`unknown tier "${tier}"`)
  return { provider, model: spec.model, maxTokens: spec.maxTokens }
}

/** Every role id this roster declares. */
export function roleIds() {
  return ROLES.map((role) => role.id)
}

/**
 * Check the roster against itself and against a deployment allow-list.
 * Returns human-readable problems instead of throwing so the plugin can decide
 * whether a problem is fatal in its configured mode.
 * @param {object} [options] - provider/model allow-list supplied by plugin config.
 */
export function validateRoster({ allowedModels = [], provider = PROVIDER } = {}) {
  const problems = []
  const ids = new Set()
  const toolNames = new Set()

  for (const role of ROLES) {
    if (ids.has(role.id)) problems.push(`duplicate role id "${role.id}"`)
    ids.add(role.id)

    const toolName = toolNameFor(role)
    if (toolNames.has(toolName)) problems.push(`duplicate tool name "${toolName}"`)
    toolNames.add(toolName)

    if (!(role.tier in TIERS)) problems.push(`role "${role.id}" names unknown tier "${role.tier}"`)
    if (!(role.capability in CAPABILITIES)) problems.push(`role "${role.id}" names unknown capability set "${role.capability}"`)
    if (typeof role.prompt !== 'string' || role.prompt.trim().length < 120) {
      problems.push(`role "${role.id}" has no persona strong enough to constrain a child`)
    }
    if (role.line === 'bulk' && capabilitiesFor(role).length > 0) {
      problems.push(`role "${role.id}" is a bulk unit but was granted tools; bulk units must be blind`)
    }
    if (role.position === 'reviewer' && capabilitiesFor(role).some((tool) => ['write', 'edit', 'pwsh'].includes(tool))) {
      problems.push(`role "${role.id}" is a reviewer but can modify the workspace`)
    }
  }

  if (allowedModels.length > 0) {
    for (const [tier, spec] of Object.entries(TIERS)) {
      const route = `${provider}/${spec.model}`
      if (!allowedModels.includes(route)) problems.push(`tier "${tier}" resolves to "${route}", which the allow-list forbids`)
    }
  }

  return problems
}

/** Roles grouped by line, for docs and for the routing section text. */
export function byLine() {
  return ROLES.reduce((acc, role) => {
    ;(acc[role.line] ??= []).push(role)
    return acc
  }, {})
}
