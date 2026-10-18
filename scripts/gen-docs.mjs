#!/usr/bin/env node
/**
 * Generate the role reference docs from `lib/roster.js`.
 *
 * Usage: node scripts/gen-docs.mjs [--check]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLES, TIERS, capabilitiesFor } from '../lib/roster.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const docs = path.join(repoRoot, 'docs')
fs.mkdirSync(docs, { recursive: true })

const zhCapability = (role) =>
  capabilitiesFor(role).length === 0 ? '无（纯文本变换）' : capabilitiesFor(role).map((tool) => `\`${tool}\``).join('、')

const enCapability = (role) =>
  capabilitiesFor(role).length === 0 ? 'none (pure text transform)' : capabilitiesFor(role).map((tool) => `\`${tool}\``).join(', ')

function table(locale) {
  const header =
    locale === 'zh'
      ? ['| 角色（`delegate` 的 `role`） | 岗位 | 性格 | 档位 | 可用工具 | 定位 |', '|---|---|---|---|---|---|']
      : ["| Role (`delegate`'s `role`) | Position | Temperament | Tier | Tools | What it is for |", '|---|---|---|---|---|---|']
  const rows = ROLES.map((role) => {
    const capability = locale === 'zh' ? zhCapability(role) : enCapability(role)
    const description = locale === 'zh' ? role.description.zh : role.description.en
    return `| \`${role.id}\` | ${role.position} | ${role.temperament} | ${role.tier} | ${capability} | ${description} |`
  })
  return [...header, ...rows].join('\n')
}

function tierTable(locale) {
  const header =
    locale === 'zh' ? ['| 档位 | 环境变量 | 约束 |', '|---|---|---|'] : ['| Tier | Env var | Constraint |', '|---|---|---|']
  const rows = Object.entries(TIERS).map(([tier, spec]) =>
    locale === 'zh'
      ? `| ${tier} | \`ROSTER_${tier.toUpperCase()}_MODEL\` | 默认 \`${spec.model}\`，maxTokens ${spec.maxTokens} |`
      : `| ${tier} | \`ROSTER_${tier.toUpperCase()}_MODEL\` | defaults to \`${spec.model}\`, maxTokens ${spec.maxTokens} |`,
  )
  return [...header, ...rows].join('\n')
}

const zh = `# 角色手册

> 由 \`lib/roster.js\` 生成，请勿手改。运行 \`node scripts/gen-docs.mjs\` 重新生成。

父代理只有一个 \`delegate\` 工具，\`role\` 参数就是下表第一列。选哪个角色，就决定了子代理的系统提示词、可用工具和模型档位；角色之间不能互相顶替。

${table('zh')}

## 模型档位

${tierTable('zh')}

档位在组合层由环境变量解析，因此同一份组合可以同时服务本地测试路由和生产路由。
`

const en = `# Role reference

> Generated from \`lib/roster.js\`. Do not edit by hand; run \`node scripts/gen-docs.mjs\`.

The parent has exactly one \`delegate\` tool; \`role\` is the first column below. A role decides the
child's system prompt, its tool range, and its model tier, and no role can substitute for another.

${table('en')}

## Model tiers

${tierTable('en')}

Tiers resolve from the environment at composition time, so one composition serves both a local
bench route and a production route.
`

for (const [file, body] of [
  ['roles.zh.md', zh],
  ['roles.en.md', en],
]) {
  const target = path.join(docs, file)
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
    if (current !== body) {
      console.error(`${file} is stale: run \`node scripts/gen-docs.mjs\``)
      process.exit(1)
    }
  } else {
    fs.writeFileSync(target, body)
    console.log(`wrote docs/${file}`)
  }
}
if (process.argv.includes('--check')) console.log('role docs are current')

