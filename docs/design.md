# 设计说明

## 1. 为什么不是「预设（preset）」

最初的方案是给每个角色声明一个 `agent-preset`，由父代理在委派时按 preset 选择子代理身份。实现前的实测推翻了这个前提：

- GitHub `main` 分支的 `tool-subagent` 文档确实有 `agentPreset` / `allowedAgentPresets`；
- 但本机安装的 `@deepseek-ai/dsh` **0.2.0-rc.2** 里，`tool-subagent` 的 `Config` 只有 `provider / toolName / modelSelectionSettings / backgroundMode / agentOptions / toolFilter / persona / maxDepth`，**没有** `agentPreset`；
- 也就是说预设选择是较新版本的能力，rc.2 上写 `agentPreset` 会被 schema 静默丢弃，子代理根本不会拿到角色身份。

同一版本的 `tool-subagent` 恰好支持 **`persona`** 与 **`toolFilter`**，二者都按工具实例生效，并在 `dsh-subagent` 创建子代理时注入（`applyChildComposition`）。所以最终设计把「角色」下沉为「工具实例」：

> 一个角色 = 一个 `tool-subagent` 实例 = 一份 persona + 一份工具白名单 + 一个模型档位。

副作用是好的：**选角色变成选工具**。模型没法「声称自己是评审者然后去改文件」，因为评审工具的子代理注册表里根本没有写文件这个工具。

## 2. 三层约束分别落在哪里

| 层 | 落点 | 代码/配置位置 |
|---|---|---|
| 提示词 | 子代理 `persona-prefix` 段落 | `cordis.patch.yml` 每个 `roster-*` 行的 `persona` |
| 能力 | 子代理工具注册表求交 | 同行的 `toolFilter.allow` |
| 模型 | 子代理 `AgentOptions` | 同行的 `agentOptions` |
| 深度 | `maxDepth` | 同行 `maxDepth: 1`，且白名单从不含 `subagent*` |

父代理还会额外收到一段系统提示词段落 `roster:routing`，由 `lib/index.js#routingText()` **从名册数据生成**，因此它不可能描述一个没挂载的工具，也不会漏掉一个挂载了的工具（单元测试断言了这一点）。

## 3. 生成式组合

`cordis.patch.yml` 是生成产物：

```
lib/roster.js  ──(scripts/gen-patch.mjs)──►  cordis.patch.yml
      │
      ├──(scripts/gen-docs.mjs)──►  docs/roles.zh.md / roles.en.md
      │
      └──(lib/index.js)──► 运行时校验 + 分流段落
```

`npm test` 里有一条「patch 与名册一致」的断言，手改 YAML 会让测试失败。这样校验器、文档、组合三者不会各自漂移。

## 4. 运行时校验（`mode`）

插件在加载时做静态检查，发现下列任一项违规：

- 角色 id / 工具名重复；
- 角色引用了不存在的档位或能力集；
- 批量角色的能力集不是空（那就不叫批量单元了）；
- 评审角色被授予了写/执行工具；
- `allowedModels` 非空时，某档位解析到了名单外的路由。

`advisory`（默认）只 `logger.warn`，`strict` 直接抛错拒绝加载。默认温和，是因为部署往往想先看清问题再改配置。

## 5. 已知边界

- **模型档位是部署事实，不是插件事实**。插件保证「角色 A 永远跑在档位 X 上」，但不保证档位 X 一定是便宜或强的模型 —— 那是 `agentOptions` 配置者的责任。
- **不能约束父代理自己**。插件只管委派；父代理的模型由 `agent-default-model` 决定。
- **工具白名单依赖工具名**。若宿主升级后重命名了 `read`/`write` 等工具，白名单会失效为「该角色拿不到该工具」，不会变成「拿到了不该有的工具」 —— 失败方向是安全的。
- **`agentPreset` 路线未使用**。若未来 DSH 升到支持 per-child preset 的版本，可以把 12 个工具收敛成 4 个工具 + 12 个预设，父代理的 schema 面积会明显变小。这一点写在 `docs/test-report.md` 的后续工作里。
