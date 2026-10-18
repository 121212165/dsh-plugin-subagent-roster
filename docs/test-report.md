# 真实测试报告

运行时：DSH `0.2.0-rc.2`　｜　协议：OpenAI 兼容 `http://127.0.0.1:3002/v1`　｜　最后更新：2026-10-18

## 1. 方法与判定

| 项 | 值 |
|---|---|
| 测试 profile | 独立 `DSH_HOME` 下的 `subagent-lab`（headless）与 `web-lab`，不触碰用户的 desktop/web profile |
| 上游 | OpenRouter 免费池 21 key 轮询；本机 `new-api` 能起但出不去外网，故用自带等价网关 |
| 计数 | 网关逐请求 JSONL，**每次上游尝试一条**（含被限流的重试），单调递增、可独立复核 |
| 判定 | 只看网关请求日志：子代理 persona 首行是否命中、`model` 是否等于档位模型、`tools` 计数是否等于该角色授权数 |
| 超时规则 | 用例被 300 秒超时杀掉记为 `TIMEOUT`，**不算通过**（早期汇总曾把超时误判为 PASS，已用 `bench/regrade.mjs` 重算） |

## 2. 两个版本、同一批用例

| 版本 | 形态 | 受控委派 | 自由选择 |
|---|---|---|---|
| v0.1 | 12 个角色工具（父工具面 36） | **42/42** | 2/12 |
| v0.2 | 1 个 `delegate` + `role` 枚举（父工具面 25） | **14/15**（1 次超时） | 0/6 |

「受控」= 任务里点名角色；「自由选择」= 不点名，由父模型看分流段落自己判断该不该委派。

### v0.2 逐例

```
bulk-exact-json               PASS   children=1
bulk-fuzzy-dirty              PASS   children=1
bulk-audit-verdict            PASS   children=1
bulk-parallel-4               PASS   children=11
lead-planner-plan             PASS   children=8
lead-dispatcher-table         PASS   children=1
builder-surgical-write        PASS   children=4
reviewer-strict-cannot-write  PASS   children=2
bulk-cannot-delegate          PASS   children=1
researcher-primary-quote      PASS   children=2
researcher-explorer-options   PASS   children=2
scribe-assemble               PASS   children=1
builder-refactor-rewrite      PASS   children=6
reviewer-coach-improve        TIMEOUT children=1
bulk-parallel-8               PASS   children=9
fc-bulk-email                 NO-CHILD
fc-bulk-dates                 NO-CHILD
fc-bulk-check                 NO-CHILD
fc-team-plan                  TIMEOUT children=16
fc-team-review                NO-CHILD
fc-team-report                NO-CHILD
```

## 3. 结论：收敛工具数量没有解决分流

这是本轮最重要的结果，而且是**负面**的：

- 把 12 个工具收敛成 1 个，父代理工具面从 36 降到 25，**受控委派的约束一条没少**：
  12 个角色全部命中正确 persona、正确档位模型、正确工具数；评审角色被命令改文件仍然改不动（跑完文件内容不变）。
- 但**自由选择没有任何改善**：v0.1 是 2/12，v0.2 是 0/6，样本量下无法区分，也谈不上改善。
- 因此**「工具太多导致模型选不动」这个假设被证伪**。父模型（`cohere/north-mini-code:free`、`nvidia/nemotron-3-super-120b-a12b:free`）的问题不是选项过载：抓到的父代理请求显示系统提示词里确实有 `## Delegation shapes` 段落（网关记录 `routingSection=true`），它只是**不照做**——5/6 的自由用例自己把活干完了，1 例过度委派到超时。

要真正解决「何时委派」，只能把判断从模型身上挪走：

1. 由人在入口显式触发（`/fanout` 命令或 skill），而不是让模型自己识别形态；
2. 或在上层编排器（workflow/脚本）里按任务形态直接调用 `delegate`，父模型不参与决策。

这两条都超出「一个提示词插件」能做到的范围，属于下一步工作，而不是本版本的缺陷修复。

## 4. 其它已验事实

- **档位可迁移**：把 `ROSTER_BATCH_MODEL` 换成另一个模型，子代理实际模型随之改变，用例仍通过。
- **角色可运营**：操作页 `PUT /api/state` 在真实 web profile 中返回 200，新名册立即生效（工具与分流段落被替换，不重启），并落盘到 `roles.json`；非法名册返回 400 且不覆盖旧文件。
- **并发**：一次回合 8 个 `delegate` 调用，8 个子代理全部落在 `batch-exact`。
- **预算**：820 / 1000 次调用。上游 429/402 共 9 次，自动换 key 后成功。


## 5. 确定性入口（`bin/roster-fanout.mjs`）

把「该不该委派」从模型手里拿走之后，形态是可验证的：

| 运行 | 条目 | 成功委派 | 失败 |
|---|---|---|---|
| 1 | 4 | 4 | 0 |
| 2 | 3 | 3 | 0 |
| 3 | 3 | 3 | 0 |
| 4 | 2 | 2 | 0 |

12/12 条目各自生成一个目标角色的子代理，角色全部正确（`batch-exact`），答案从子代理的
`tool_result` 事件直接读取，不经过父代理转述。

**但契约遵循仍然失败**：加 `--expect-json` 后，3 条里 0 条产出合法 JSON（cohere 与
nemotron-super 两档都试过）。子代理还会虚构自己并不拥有的工具调用（例如输出一个
`read` 工具的伪造调用 JSON）——它明明是 `allow: []` 的盲角色。

结论：入口层解决的是**形态**，不是**答案质量**。契约重要的场景必须把批量档指向更强的模型，
或者把 `--expect-json` 当作硬门禁让失败显式暴露。这两条都写进了 README。

## 6. 复现

```sh
OR_PORT=3002 node bench/gateway.mjs          # 本地网关（换 .secrets/openrouter-keys.txt 为你自己的 key）
node bench/run.mjs --repeat 1                # 21 条用例
node bench/regrade.mjs bench/results/summary-*.json   # 按超时规则重算历史汇总
```

