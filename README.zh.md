# dsh-plugin-subagent-roster

为 DeepSeek Harness 增加一套**受约束的子代理名册**：每个角色都被固定了系统提示词、能力范围和模型档位，并且「大量重复性任务」与「团队分工任务」走不同的工具形状。

## 这个插件解决什么

DSH 内置的 `subagent` 工具让子代理继承父代理的身份与全部工具。真实的委派有两个问题：

1. **身份不收敛**：子代理会带着父代理的人设去做一件很窄的事，输出格式随缘。
2. **能力不收敛**：你只想让它读文件，它却有 shell；你让它评审，它顺手把代码改了。
3. **模型不收敛**：批量任务和关键决策跑在同一个（往往是最贵的）模型上。

本插件把这三件事从「提示词请求」变成**结构约束**：

| 约束 | 机制 | 效果 |
|---|---|---|
| 系统提示词 | 每次委派把角色 `persona` 放进请求，注入子代理的 `persona-prefix` 段落 | 子代理身份由角色决定，父代理身份不泄漏 |
| 能力范围 | 请求里的 `toolFilter.allow` 精确列出可用工具 | 评审角色**没有**写文件的工具，想改也改不了 |
| 模型档位 | 请求里的 `agentOptions` 固定 provider/model/maxTokens | 批量档便宜、评审档够用、团队档最强，各自独立可换 |
| 委派深度 | `maxDepth: 1` 且工具过滤从不授予 `subagent*` | 角色子代理是叶子，不能无限递归 |

## 两条任务线

- **批量线**：一次一条、并行发起、子代理**没有任何工具**。适合 20 条数据的字段抽取、逐条校验、逐条改写。
- **团队线**：规划、实现、评审、检索、成稿，每个角色能力范围不同，子代理之间不可互换。

完整的 20 个角色见 [角色手册](docs/roles.zh.md)（[English](docs/roles.en.md)）。父代理只花一个工具 schema 的成本，而不是二十个。

## 安装

```sh
# 从 GitHub 安装（源码即产物，无需构建授权）
dsh plugin --profile <你的 profile> add github:<owner>/dsh-plugin-subagent-roster

# 或从本地 checkout 安装
dsh plugin --profile <your-profile> add /path/to/dsh-plugin-subagent-roster
```

安装后组合层自动生效（只挂一行），父代理会多出**一个** `delegate` 工具，其 `role` 枚举就是 20 个角色。`dsh --profile <name> --dump-config` 应能看到 `subagent-roster` 一行。

## 操作页面（自己设置角色）

profile 启动后，插件在本机回环起一个页面：

```
http://127.0.0.1:4317/
```

可以增删角色、改岗位/性格/档位/能力范围、直接编辑每个角色的 persona（子代理的系统提示词），**保存即生效，无需重启**（页面保存时会替换工具注册与分流段落，失败会回滚到上一版）。

角色数据在 `$DSH_HOME/subagent-roster/roles.json`（首次启动由内置 20 个角色播种），也可以手动编辑该文件。

- 端口由插件配置 `pagePort` 控制，设为 `0` 关闭。
- **无鉴权**：只绑定 `127.0.0.1`，权限等价于本机 shell。不要把它暴露到别的网卡上。
- 保存前会整体校验：id 必须 kebab-case、档位/能力/形态必须是已知值、能力范围与角色定位冲突（例如评审角色带写权限）会被拒绝，且**不会覆盖**已有文件。

## 配置模型档位

组合里的模型 id 全部从环境变量解析，因此同一份包可以服务不同部署：

| 变量 | 作用 |
|---|---|
| `ROSTER_PROVIDER` | 四个档位共用的 provider 路由名 |
| `ROSTER_BATCH_MODEL` / `ROSTER_BUILD_MODEL` / `ROSTER_REVIEW_MODEL` / `ROSTER_TEAM_MODEL` | 各档位模型 id |
| `ROSTER_BATCH_MAX_TOKENS` 等 | 各档位输出上限 |

也可以在 profile 的 `cordis.patch.yml` 里按 id 覆盖任意一行（例如只改 `roster-builder-surgical` 的模型）。

## 插件设置

| 字段 | 默认 | 含义 |
|---|---|---|
| `mode` | `advisory` | `advisory` 只告警；`strict` 在名册自相矛盾时拒绝加载 |
| `provider` | `deepseek-official` | 档位解析所用 provider |
| `allowedModels` | `[]` | 非空时，任何解析到名单外路由的档位都会被视为违规 |
| `routingGuidance` | `true` | 是否向父代理注册「批量 vs 团队」的分流说明段落 |

## 验证

```sh
npm test        # 18 项单元测试，0 次模型调用
node bench/run.mjs --repeat 1   # 真实调用测试（需要本地 OpenAI 兼容网关）
```

真实测试的判定全部来自网关请求日志，而不是回答文本：子代理 persona 是否命中、模型是否等于档位模型、可用工具数是否等于角色授权数、负向用例是否真的没有改动工作区。

- 设计说明：[docs/design.md](docs/design.md)
- 测试报告：[docs/test-report.md](docs/test-report.md)
- 审核报告：[docs/review.md](docs/review.md)

## 兼容性

- DSH `>=0.2.0-rc.2 <0.3.0`
- Node `>=22.18`
- 纯 ESM JavaScript 产物，无构建步骤

## License

MIT



