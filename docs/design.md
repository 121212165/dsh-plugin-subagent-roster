# 设计说明

## 1. 一个工具，十二个角色

v0.1 的做法是「一个角色 = 一个委派工具」，父代理要面对 12 个同族工具（连同宿主自带工具共 36 个）。实测下来，弱父模型在 12 个近义工具之间几乎不做选择：要么自己干完，要么反复调用同一个。

v0.2 收敛成一个 `delegate` 工具，角色做成它的 `role` 枚举。父代理的工具面从 36 降到 25，而**约束一条没少**——因为 DSH 0.2.0-rc.2 的 `SubagentStartRequest` 本身就是按次携带约束的：

```ts
interface SubagentStartRequest {
  readonly prompt: ContentBlock[]
  readonly parent: Agent
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions       // provider / model / maxTokens
  readonly persona?: string                  // 子代理的 persona-prefix 段落
  readonly toolFilter?: ToolRestriction      // 与父代理工具集求交
  readonly maxDepth?: number
}
```

`lib/delegate.js#buildDelegateRequest` 把名册里的角色翻译成这个请求：

| 角色字段 | 请求字段 | 效果 |
|---|---|---|
| `prompt` | `persona` | 子代理身份与输出契约固定，父代理身份不泄漏 |
| `capability` | `toolFilter.allow` | 评审角色**没有**写工具，批量角色**一个工具都没有** |
| `tier` | `agentOptions` | 模型与输出上限按档位固定 |
| —— | `maxDepth: 1` | 子代理由此只存在一层 |

**关键在于：角色枚举不是提示，是路由。** 模型选了 `reviewer-strict`，它拿到的那个子代理的工具表里就没有 `write`；它想让子代理改文件也做不到。这一点由网关日志里的 `tools` 计数逐条验证（见测试报告）。

## 2. 为什么不用预设（preset）

GitHub `main` 上的 `tool-subagent` 文档有 `agentPreset` / `allowedAgentPresets`，但本机安装的 **0.2.0-rc.2** 的 `Config` 里没有这两个字段——写了会被 schema 静默丢弃，子代理根本拿不到角色身份。同一版本的 `persona` 与 `toolFilter` 是按请求生效的，于是角色下沉到请求层。等 DSH 支持 per-child preset 后，可以把 `role → preset` 映射加回来，但请求层这条路仍然更直接。

## 3. 生成式组合

`cordis.patch.yml` 现在只有一行（挂载本插件）。名册仍然是唯一真源，只是它驱动的东西变了：

```
lib/roster.js ──┬──► lib/delegate.js   每个角色 → 一次委派请求（persona/filter/tier）
                ├──► lib/index.js      分流段落（从名册生成，不会描述不存在的角色）
                ├──► scripts/gen-docs  角色手册（中英）
                └──► scripts/gen-patch 组合（一行 + 防手改说明）
```

`npm test` 里断言「patch 与名册一致」，并且断言**组合里不允许再出现按角色展开的行**——防止有人把 12 个工具加回来。

## 4. 运行时校验（`mode`）

加载时静态检查：角色 id 唯一、档位与能力集存在、批量角色能力集为空、评审/研究角色不得有写或执行工具、`allowedModels` 非空时任何档位不得解析到名单外路由。

`advisory`（默认）只 `logger.warn`；`strict` 抛错拒绝加载。

## 5. 分流的两种形态

- **结构分流**：任务给定时（人或上层流程点名角色），约束由请求层保证，42/42 通过。
- **自由分流**：任务没点名时，由父模型看 `## Delegation shapes` 段落自行判断。这一段由名册生成，网关日志可证明它确实进了父代理系统提示词。

自由分流的可靠性取决于父模型能力，**不是工具数量**：把 12 个工具收敛成 1 个之后，自由选择从 2/12 变成 0/6——没有改善。工具过载假设已被证伪，详见测试报告第 3 节。

## 6. 已知边界

- 档位是部署事实：插件保证「角色 → 档位」的映射稳定，不保证档位选得便宜或够强。
- 工具白名单依赖工具名。宿主改名时，角色会**少拿到**工具（安全方向），不会多拿。
- 单个 `delegate` 工具意味着同一时刻只能看到一个子代理的结果在工具返回里；并行发起仍可行（一次回合多次调用），但父代理要自己汇总。
- 本插件只保证「委派发生时约束成立」，不保证「模型会主动委派」。后者需要入口侧触发（命令/skill）或上层编排，见测试报告第 3 节。

