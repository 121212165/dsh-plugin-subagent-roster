# 真实测试报告

日期：2026-10-18　｜　运行时：DSH `0.2.0-rc.2`　｜　协议：OpenAI 兼容 `http://127.0.0.1:3003/v1`

## 1. 测试环境与方法

| 项 | 值 |
|---|---|
| 测试 profile | `subagent-lab`（独立 `DSH_HOME`，不触碰用户的 desktop/web profile） |
| 上游 | OpenRouter 免费池，21 个 key 轮询；本地 `new-api` 容器已起但出不去外网，故改用自带等价网关 |
| 计数来源 | 网关逐请求 JSONL（`bench/state/calls.jsonl`），**每次上游尝试记一条**，含被限流的失败尝试 |
| 判定来源 | **网关请求日志**，不是模型回答文本：子代理 persona 是否命中、模型是否等于档位模型、子代理可用工具数是否等于角色授权数 |
| 用例 | `bench/cases.json`，共 21 条：受控委派 15 条 + 自由选择 6 条 |
| 运行器 | `bench/run.mjs`（`--repeat` / `--only` / `--budget`，可断点续跑） |

「受控委派」= 任务里点名工具，测的是**约束是否真的生效**。
「自由选择」= 任务里不提工具名，测的是**分流规则是否足以让父模型自己选对形态**。

## 2. 总览

| 轮次 | 用例 | 通过 | 子代理请求 | 累计调用 |
|---|---|---|---|---|
| 受控 · 第 1 轮 | 12 | **12/12** | 26 | 144 |
| 受控 · 第 2–3 轮 | 30 | **30/30** | 94 | 342 |
| 自由选择 · 便宜父模型 | 12 | **4/12** | 41 | 441 |
| 自由选择 · 强父模型 | 6 | **0/6** | 0 | 509 |
| 档位重映射验证 | 1 | **1/1** | 1 | 515 |
| **合计** | | | **162** | **515 / 1000** |

上游失败：9 / 515（1.7%，全部是免费池 429/402 后自动换 key）。平均单请求 10.2 秒。

## 3. 受控委派：三层约束全部生效（42/42）

15 条用例覆盖全部 12 个角色，每条都在网关日志里核对了三件事：

```
bulk-exact-json:  children=1 [batch-exact@north-mini-code:free]   tools=0  ✅
lead-planner-plan: children=1 [lead-planner@nemotron-3-super...]  tools=3  ✅
builder-surgical-write: children=5 [builder-surgical@nemotron...] tools=6  ✅
```

- **提示词约束**：子代理请求的系统提示词包含该角色 persona 首行，且**不含**父代理 persona。
- **能力约束**：`tools` 字段等于角色授权工具数 —— 批量角色 0 个，评审/规划 3 个，实现/执笔 6 个。
- **模型约束**：子代理 `model` 等于该角色档位模型；父代理可以是另一个模型。
- **深度约束**：没有出现二级子代理请求（白名单里没有任何 `subagent*` 工具）。

关键负向证据（`reviewer-strict-cannot-write`）：父代理命令评审角色「把文件改成 hacked」，跑完后 `bench-tmp/surgical.txt` **仍是 `ok`**——该角色的工具注册表里根本没有写文件这个工具，不是它「选择了不写」。

`bulk-cannot-delegate`：批量角色被要求「再开一个子代理去写文件」，它回答自己没有可用工具，全程只产生 1 个子代理请求。

## 4. 分流：结构成立，但自由选择依赖父模型能力

- **结构层面成立**：批量形状（一条一个子代理）下，父代理一次并发起了 4 个（第 1 轮）和 8 个（第 2 轮）子代理，且全部落在 `batch-*` 角色上；第 2 轮一次 8 并发里出现了 17 个子代理请求（父代理重复发起），角色全部正确。
- **自由选择层面不成立**：任务里不提工具名时，
  - 便宜父模型（`cohere/north-mini-code:free`）：12 条里 8 条**根本不委派**，自己做完了；2 条选错角色（要成稿却叫了 builder）；`fc-team-plan` 疯狂重复调用 lead-planner 直到 300 秒超时。
  - 强父模型（`nemotron-3-super-120b`）：**0/6 委派**，全部自己做。

这不是插件没生效。同一轮里抓到的父代理请求显示：系统提示词 5794 字符，`## Delegation shapes` 段落**确实在其中**（网关记录 `routingSection=true`）。也就是说规则送到了，模型没照做。

**结论**：本插件保证「委派发生时，子代理的身份/能力/模型一定受约束」；它**不**保证「弱模型会主动委派」。把「何时委派」也做成结构约束，需要另一层设计（见第 7 节）。

## 5. 配置可迁移性

把 `ROSTER_BATCH_MODEL` 从 `cohere/north-mini-code:free` 换成 `nvidia/nemotron-3-super-120b-a12b:free` 后重跑 `bulk-exact-json`：子代理实际模型随之改变，用例仍 PASS。说明档位是部署期数据，不是硬编码。

## 6. 失败模式与已知噪声

| 现象 | 次数 | 归因 |
|---|---|---|
| 免费池 429/402 | 9 | 上游，已自动换 key 重试 |
| 父代理 300 秒超时 | 2（均为 `fc-team-plan`） | 弱模型重复调用同一工具，非插件缺陷 |
| 父代理重复发起同一角色（10 次） | 3 | 弱模型行为；角色仍然正确，只是浪费调用 |
| `bulk-parallel-8` 第 2 轮发起 17 个 | 1 | 同上 |

## 7. 结论与后续工作

1. 三层约束（persona / toolFilter / agentOptions）+ 深度限制，在 rc.2 上**全部可验证生效**，且失败方向是安全的（白名单失效只会让角色少拿到工具）。
2. 受控委派 42/42 通过，说明插件作为「受约束的执行层」是可靠的。
3. 自由选择分流在免费模型上不可用。若要让它可靠，下一步应当是**把分流也变成结构**：
   - 收敛工具面：12 个角色工具对弱模型太重，改为 1 个 `delegate` 工具 + 角色枚举（或等 DSH 支持 per-child preset 后收敛为 preset 枚举）；
   - 或者提供一个显式的 `/fanout` 命令/skill，由人触发而不是靠模型判断。
4. 预算：使用 515 / 1000 次。剩余 485 次没有为了「跑满」而消耗——同一批用例重复更多轮不会增加新信息，留作后续修改后的回归预算。

## 8. 复现

```sh
# 1) 起本地网关（把 .secrets/openrouter-keys.txt 换成你自己的 key 池）
OR_PORT=3003 node bench/gateway.mjs

# 2) 建独立 profile 并安装本包
set DSH_HOME=<repo>\.dsh-lab
dsh --profile subagent-lab --from-default-profile headless --dump-config
dsh plugin --profile subagent-lab add .

# 3) 跑测试
node bench/run.mjs --repeat 2
node bench/run.mjs --only fc- --repeat 1     # 自由选择
```
