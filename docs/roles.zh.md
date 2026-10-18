# 角色手册

> 由 `lib/roster.js` 生成，请勿手改。运行 `node scripts/gen-docs.mjs` 重新生成。

每个角色就是一个 `tool-subagent` 实例。父代理选角色的动作，就是选一个工具；角色之间不能互相顶替。

| 工具名 | 岗位 | 性格 | 档位 | 可用工具 | 定位 |
|---|---|---|---|---|---|
| `subagent_batch_exact` | batch-worker | exact | batch | 无（纯文本变换） | 一条输入、一份契约、别无其他。并行发起，每条一个子代理。 |
| `subagent_batch_fuzzy` | batch-worker | tolerant | batch | 无（纯文本变换） | 契约与严格版相同，但会归一化脏输入而不是直接失败。 |
| `subagent_batch_audit` | batch-checker | skeptical | batch | 无（纯文本变换） | 按契约判定单条产物，只给结论，不改写。 |
| `subagent_lead_planner` | lead | architect | team | `read`、`glob`、`grep` | 在动手前做设计：拆解、顺序、验收标准。 |
| `subagent_lead_dispatcher` | lead | dispatcher | team | 无（纯文本变换） | 把既定计划转成分派表，不做设计判断。 |
| `subagent_builder_surgical` | builder | conservative | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 满足验收标准的最小改动，拒绝顺手清理。 |
| `subagent_builder_refactor` | builder | bold | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 当问题出在结构上时敢于重写，而不是硬打补丁。 |
| `subagent_reviewer_strict` | reviewer | gatekeeper | review | `read`、`glob`、`grep` | 只拦真正有问题的，没意见就沉默通过。 |
| `subagent_reviewer_coach` | reviewer | coach | review | `read`、`glob`、`grep` | 把阻断性缺陷和成长机会分开，并对后者给出教学。 |
| `subagent_researcher_primary` | researcher | primary-source | team | `read`、`glob`、`grep`、`web_fetch`、`web_search` | 只给来源原话并标明位置，不靠记忆综合。 |
| `subagent_researcher_explorer` | researcher | explorer | team | `read`、`glob`、`grep`、`web_fetch`、`web_search` | 先铺开选项空间与竞争假设，再收敛。 |
| `subagent_scribe_editor` | scribe | editor | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 把多方产出合成一份一致的产物，不凭空补内容。 |

## 模型档位

| 档位 | 环境变量 | 约束 |
|---|---|---|
| batch | `ROSTER_BATCH_MODEL` | 默认 `deepseek-flash`，maxTokens 8192 |
| build | `ROSTER_BUILD_MODEL` | 默认 `deepseek-flash`，maxTokens 16384 |
| review | `ROSTER_REVIEW_MODEL` | 默认 `deepseek-flash`，maxTokens 16384 |
| team | `ROSTER_TEAM_MODEL` | 默认 `deepseek-flash`，maxTokens 32768 |

档位在组合层由环境变量解析，因此同一份组合可以同时服务本地测试路由和生产路由。
