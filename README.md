# dsh-plugin-subagent-roster

A **constrained subagent roster** for DeepSeek Harness. Every role has a pinned system prompt, a
pinned capability range, and a pinned model tier — and bulk work and team work are reached through
tools of different shapes.

## The problem

DSH's built-in `subagent` tool gives a child the parent's identity and the parent's whole toolset.
Real delegation therefore fails in three predictable ways:

1. **Identity leaks** — the child carries the parent's persona into a narrow job, and its output
   shape is whatever the model felt like.
2. **Capability leaks** — you wanted a file read; the child has a shell. You asked for a review; it
   edited the code.
3. **Model does not match the job** — a 200-item extraction and a load-bearing design decision run
   on the same (usually most expensive) model.

This plugin turns all three from *prompt requests* into *structural constraints*:

| Constraint | Mechanism | Effect |
|---|---|---|
| System prompt | each delegation puts the role `persona` on the request; it becomes the child's `persona-prefix` section | identity is decided by the role, never by the parent |
| Capability | the request's `toolFilter.allow` | a reviewer has **no** write tool at all — it cannot edit even if asked |
| Model | the request's `agentOptions` | bulk runs cheap, review runs adequate, team runs strongest |
| Depth | `maxDepth: 1` and a filter that never grants `subagent*` | a role child is a leaf; no recursive fan-out |

## Two lines

- **Bulk line** — one item per call, launched in parallel, children have **no tools at all**. Field
  extraction over 20 records, per-item validation, per-item rewriting.
- **Team line** — planning, building, reviewing, retrieving, assembling. Each role has a different
  capability range, and no role can stand in for another.

All 20 roles: [role reference](docs/roles.en.md) ([中文](docs/roles.zh.md)).

## Install

```sh
# from GitHub (source is the artifact; no build authorization needed)
dsh plugin --profile <your-profile> add github:<owner>/dsh-plugin-subagent-roster

# or from a local checkout
dsh plugin --profile <your-profile> add /path/to/dsh-plugin-subagent-roster
```

The bundle applies one plugin row. The parent agent gains **one** `delegate` tool whose `role` enum
is the whole roster, so it pays for one schema instead of twenty. `dsh --profile <name>
--dump-config` should show the `subagent-roster` row.

## Operations page (define your own roles)

While a profile runs, the plugin serves a loopback page:

```
http://127.0.0.1:4317/
```

Add or delete roles, change a role's position, temperament, tier or capability range, and edit the
persona — the child's system prompt — directly. **Saving applies immediately, no restart**: the page
replaces the delegation tool registration and the routing section, and rolls back to the previous
roster if the new one fails to mount.

Roles live in `$DSH_HOME/subagent-roster/roles.json`, seeded from the shipped twenty on first start.
The file is a normal document: editing it by hand is supported.

- Port is the plugin's `pagePort` setting; `0` disables the page.
- **No authentication**, bound to `127.0.0.1`: it grants the same file authority a local shell
  already has. Do not expose it on another interface.
- Every save is validated as a whole: kebab-case ids, known tier/capability/line values, and role
  invariants (a reviewer that can write is rejected). A rejected document never overwrites the file.

## Deterministic entry point (no "should I delegate?" decision)

Measured: letting the parent model decide *whether* to delegate is unreliable on free models (see
[test report](docs/test-report.md) §3). So the decision moves to the entry point — drive it by item
count:

```sh
node bin/roster-fanout.mjs \
  --profile <your-profile> \
  --role batch-exact \
  --items-file items.json \
  --contract 'one JSON object {"text": <the item>}' \
  --expect-json \
  --concurrency 3 \
  --out results.jsonl
```

- **N items in, N role-children out** — the shape is a property of the invocation, not the model
- Each answer is read from the child's `tool_result` event, never from the parent's paraphrase
- `--expect-json` validates the contract; a child that errors, returns nothing, or returns invalid
  JSON fails the item
- Non-zero exit when any item failed, so a script or CI job can gate on it

> The contract is enforced by `--expect-json`, and the contract text is delivered **inside the
> child's task** (outside it, the child never sees it). Measured 8/8 compliant on the cheapest
> bulk-tier model. A failed check is a failed item, never prose passed off as success.

## Plugin market (official index format)

The repository ships a `format: 1` index for the DSH plugin market, validated with the official
`@deepseek-ai/dsh-plugin-market-index` validator. Subscribe to it directly:

```
https://121212165.github.io/dsh-plugin-subagent-roster/market/index.json
```

**Plugins → Discover → Add index source**, paste the URL (turn on “Custom plugin market” under
“Experimental plugins” first).

The index lists one version from a **commit-pinned git source** (`24f55f2`), so the source shown in
the confirmation dialog is exactly what installs, and it cannot drift with a branch.

The repo also carries the `dsh-plugin` topic, so topic-scraping aggregators (awesome-dsh-plugin and
friends) pick it up on their next crawl.

## Configure model tiers

Every model id in the composition resolves from the environment, so one package serves several
deployments:

| Variable | Purpose |
|---|---|
| `ROSTER_PROVIDER` | provider route shared by all four tiers |
| `ROSTER_BATCH_MODEL` / `ROSTER_BUILD_MODEL` / `ROSTER_REVIEW_MODEL` / `ROSTER_TEAM_MODEL` | model id per tier |
| `ROSTER_BATCH_MAX_TOKENS` and friends | output ceiling per tier |

Any single row can also be overridden by id in a profile's `cordis.patch.yml`.

## Plugin settings

| Field | Default | Meaning |
|---|---|---|
| `mode` | `advisory` | `advisory` warns; `strict` refuses to load a self-contradicting roster |
| `provider` | `deepseek-official` | provider the tiers resolve against |
| `allowedModels` | `[]` | when non-empty, any tier resolving outside this list is a violation |
| `routingGuidance` | `true` | register the bulk-vs-team routing section into the parent prompt |

## Verify

```sh
npm test                          # 18 unit tests, zero model calls
node bench/run.mjs --repeat 1     # real runs against a local OpenAI-compatible gateway
```

Bench verdicts come from the gateway's request log, not from answer text: which persona the child
actually ran with, whether its model equals the tier model, whether its tool count equals the
role's grant, and whether negative cases really left the workspace untouched.

- Design notes: [docs/design.md](docs/design.md)
- Test report: [docs/test-report.md](docs/test-report.md)
- Review: [docs/review.md](docs/review.md)

## Compatibility

- DSH `>=0.2.0-rc.2 <0.3.0`
- Node `>=22.18`
- Plain ESM JavaScript artifact, no build step

## License

MIT





