# 角色手册

> 由 `lib/roster.js` 生成，请勿手改。运行 `node scripts/gen-docs.mjs` 重新生成。

父代理只有一个 `delegate` 工具，`role` 参数就是下表第一列。选哪个角色，就决定了子代理的系统提示词、可用工具和模型档位；角色之间不能互相顶替。

| 角色（`delegate` 的 `role`） | 岗位 | 性格 | 档位 | 可用工具 | 定位 |
|---|---|---|---|---|---|
| `batch-exact` | batch-worker | exact | batch | 无（纯文本变换） | 一条输入、一份契约、别无其他。并行发起，每条一个子代理。 |
| `batch-fuzzy` | batch-worker | tolerant | batch | 无（纯文本变换） | 契约与严格版相同，但会归一化脏输入而不是直接失败。 |
| `batch-audit` | batch-checker | skeptical | batch | 无（纯文本变换） | 按契约判定单条产物，只给结论，不改写。 |
| `lead-planner` | lead | architect | team | `read`、`glob`、`grep` | 在动手前做设计：拆解、顺序、验收标准。 |
| `lead-dispatcher` | lead | dispatcher | team | 无（纯文本变换） | 把既定计划转成分派表，不做设计判断。 |
| `builder-surgical` | builder | conservative | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 满足验收标准的最小改动，拒绝顺手清理。 |
| `builder-refactor` | builder | bold | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 当问题出在结构上时敢于重写，而不是硬打补丁。 |
| `reviewer-strict` | reviewer | gatekeeper | review | `read`、`glob`、`grep` | 只拦真正有问题的，没意见就沉默通过。 |
| `reviewer-coach` | reviewer | coach | review | `read`、`glob`、`grep` | 把阻断性缺陷和成长机会分开，并对后者给出教学。 |
| `researcher-primary` | researcher | primary-source | team | `read`、`glob`、`grep`、`web_fetch`、`web_search` | 只给来源原话并标明位置，不靠记忆综合。 |
| `researcher-explorer` | researcher | explorer | team | `read`、`glob`、`grep`、`web_fetch`、`web_search` | 先铺开选项空间与竞争假设，再收敛。 |
| `tester` | tester | adversarial | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 先写会失败的测试：一个行为一个用例，不动实现。 |
| `security-reviewer` | reviewer | security | review | `read`、`glob`、`grep` | 只看攻击者能控制什么、能到达哪里；不谈理论风险。 |
| `doc-writer` | scribe | reference | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 只写存在的东西：签名、默认值、失败模式，不写宣传语。 |
| `translator` | translator | localizer | batch | 无（纯文本变换） | 翻译技术文本，不翻译标识符，并标出不可译术语。 |
| `extractor` | batch-worker | schema | batch | 无（纯文本变换） | 把一条非结构化输入变成一条严格 JSON 记录，不编造字段值。 |
| `sql-analyst` | analyst | query | review | `read`、`glob`、`grep` | 基于真正读到的 schema 写只读 SQL，并声明假设。 |
| `api-designer` | designer | contract | team | `read`、`glob`、`grep` | 先定契约再写代码：数据形状、错误、版本、什么会让客户端崩。 |
| `perf-analyst` | analyst | measure | review | `read`、`glob`、`grep` | 没有数字不谈优化；指出热路径和证明它的测量方式。 |
| `scribe-editor` | scribe | editor | build | `read`、`write`、`edit`、`glob`、`grep`、`pwsh` | 把多方产出合成一份一致的产物，不凭空补内容。 |

## 模型档位

| 档位 | 环境变量 | 约束 |
|---|---|---|
| batch | `ROSTER_BATCH_MODEL` | 默认 `deepseek-flash`，maxTokens 8192 |
| build | `ROSTER_BUILD_MODEL` | 默认 `deepseek-flash`，maxTokens 16384 |
| review | `ROSTER_REVIEW_MODEL` | 默认 `deepseek-flash`，maxTokens 16384 |
| team | `ROSTER_TEAM_MODEL` | 默认 `deepseek-flash`，maxTokens 32768 |

档位在组合层由环境变量解析，因此同一份组合可以同时服务本地测试路由和生产路由。
