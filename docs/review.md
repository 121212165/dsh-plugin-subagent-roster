# 审核报告（v0.2.0）

范围：`lib/` 全部代码、`bench/` 测试设施、组合与打包、以及"测试结论是否站得住"。
方法：逐文件读 + 真实运行复现（不是纸面检查）。每条给出**怎么发现的**、**是否已修**。

## 1. 缺陷（全部已修，附复现方式）

| # | 严重度 | 问题 | 怎么发现 | 修法 |
|---|---|---|---|---|
| F1 | 高 | 网关在 21 个 key 轮询时，上游 TLS 被重置会抛未捕获的 fetch rejection，**整个进程退出**，一次完整测试跑到一半全废 | 第 2 轮 bench 跑到 `fc-bulk-check` 时进程消失，stderr 是 `TypeError: terminated` | 流式路径加 `catch`，落一条失败记录；进程级 `uncaughtException` / `unhandledRejection` 只记录不退出 |
| F2 | 高 | `registerDelegate` 没有把 `ctx.tools.register` 的 disposer 返回出去。页面保存时先 dispose 旧工具、再注册新工具，dispose 是 `undefined` → 抛 `tool "delegate" is already registered`，**会话从此没有委派工具** | 在真实 web profile 上对页面发 `PUT /api/state`，返回 500 并带该错误 | 返回 disposer；`onApply` 失败时先把旧名册挂回去再抛错，保证不会留下"半挂载"状态 |
| F3 | 中 | 操作页的 `GET /api/state` 对已经是数组的 `tiers` 又做了一次 `Object.keys`，前端下拉里出现 `0,1,2,3` | 打开页面 API，看到 `tiers=0,1,2,3` | 状态由一处构造、页面原样透传；真实运行时实测 `tiers=batch,build,review,team` |
| F4 | 中 | 页面把角色字段直接拼进 `innerHTML`，角色标题里写 `"><script>` 就是一个存储型 XSS | 代码审查 | 客户端统一 `esc()` 转义所有插值；正文用 `textarea.value` 赋值 |
| F5 | 低 | `lib/delegate.js` 在一次编辑后留下**两块重复的 JSDoc** | 读文件时看到连续两个注释块 | 合并为一块 |
| F6 | 低 | `maxDepth: 0` 被误当成"禁止子代理再委派"，实际语义是"子代理的绝对深度必须 ≤ 0"，结果**任何子代理都起不来** | 第一次真实委派返回 depth 限制错误 | 改为 `1`；"不能继续委派"改由工具白名单保证（白名单里从不出现 `subagent*`），并有单测断言 |`n| F7 | 中 | 评分器把被 300 秒超时杀掉的用例判为 PASS（只看子代理角色对不对，没看进程是否被 kill），**汇总虚高 2 例** | 复核 `exit=null` 的记录 | 新增 `TIMEOUT` 判定；写 `bench/regrade.mjs` 不花任何模型调用即可重算历史汇总，两次对照数据已重算 |
| F8 | 中 | 入口 CLI 把「工具调用完成」当成「条目成功」：子代理 `stopReason=error`、输出 `(no output)` 时仍报 `ok`，退出码为 0 | 第一次 4 条 fanout：第 4 条输出 `(no output)` 却被计为成功 | 解析 `tool_result` 首行的 stop reason，`error/aborted/refusal/max-tokens` 与 `(no output)` 一律判失败；补单测 |
| F9 | 低 | 入口 CLI 不校验输出契约，`--contract` 只是提示词里的建议，用户拿到 `alpha` 而不是 JSON 也看不出来 | 3 条 HTML/JSON 契约实测全是裸文本 | 增加 `--expect-json` 硬校验（取首个 `{` 到末个 `}` 解析），失败显式列出 || F10 | 高 | 输出契约写在**给父代理的指令**里，而子代理只拿到条目原文——契约从未到达子代理。这是 `--expect-json` 0/3 的真正原因，先前被我误判为"模型能力上限" | 打印实际提示词与子代理收到的 task，发现契约不在其中 | 把契约拼进子代理收到的 task 块；同一批模型、同一批用例立刻变为 8/8 合规。**这条记录一个判断错误：先归因模型，后查代码** |

## 2. 安全

| 项 | 结论 |
|---|---|
| 密钥 | `.secrets/openrouter-keys.txt` 在工作区根、**不在仓库内**。对 24 个受版本控制文件做 `sk-or-v1-` / `sk-[A-Za-z0-9]{20,}` 扫描：0 命中 |
| 测试产物 | `bench/state`、`bench/results`、`.bench-ws` 均被 `.gitignore` 排除，`git ls-files` 中不存在 |
| 操作页鉴权 | **无鉴权**。只绑定 `127.0.0.1`，权限等价于本机 shell；`README` 与配置项描述都写明了这一点。若要跨机器使用，必须先加鉴权或反向代理 |
| 子代理越权 | 角色子代理拿到的工具是 `toolFilter.allow` 与父工具集的**交集**，白名单里没有 `subagent*` 和任何未列出的工具；评审角色实测无法改动文件 |
| 注入面 | 操作页只接受 `roles` 数组，先校验后落盘；`id` 强制 kebab-case，`tier/capability/line` 强制枚举；非法文档不覆盖旧文件 |

## 3. 打包与发布

- `npm pack` 产物 17 个文件，含 `lib/`、`cordis.patch.yml`、双语文档；**不含** `test/`、`bench/`、密钥。
- 纯 ESM、无构建步骤，因此 `github:` 安装**不需要** `allowBuilds` 授权（这是相对"必须跑 prepare"的包的实质优势）。
- npm 账号不存在（`npm whoami` → `ENEEDAUTH`），故未发布 npm；包名 `dsh-plugin-subagent-roster` 在 registry 上仍为 404，名字可用。

## 4. 测试结论的可信度

- 判定不看模型回答文本，只看网关请求日志：子代理 persona 首行是否命中、`model` 是否等于档位模型、`tools` 计数是否等于该角色授权数量。
- 负向用例有硬证据：父代理命令评审角色把文件改成 `hacked`，跑完后文件内容仍是 `ok`。
- 预算账目按网关**每次上游尝试**计数（含被限流的重试），jsonl 单调递增，可独立复核。
- 已知不可信的一处：`benches` 里 `exit=null` 的用例是 300 秒超时被杀，其"通过/不通过"不能当作质量结论，报告里单独标注。

## 5. 未修（明确接受）

| # | 事项 | 理由 |
|---|---|---|
| O1 | 自由选择分流在免费模型上仍不可靠 | 结构性约束已到位，是否委派是父模型能力问题；证据见测试报告 |
| O2 | 操作页无鉴权 | 有意为之：本地单机工具，加鉴权会引入密钥管理复杂度；已在文档显式声明 |
| O3 | 角色工具白名单依赖工具名 | 宿主改名时角色会**少拿到**工具（安全方向），不会多拿 |
| O4 | 单一 `delegate` 工具串行返回 | 并行要靠父代理在同一回合多次调用；父代理需自己汇总 |



