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
| System prompt | one `tool-subagent` instance per role; its `persona` becomes the child's `persona-prefix` section | identity is decided by the role, never by the parent |
| Capability | that instance's `toolFilter.allow` | a reviewer has **no** write tool at all — it cannot edit even if asked |
| Model | that instance's `agentOptions` | bulk runs cheap, review runs adequate, team runs strongest |
| Depth | `maxDepth: 1` and a filter that never grants `subagent*` | a role child is a leaf; no recursive fan-out |

## Two lines

- **Bulk line** — one item per call, launched in parallel, children have **no tools at all**. Field
  extraction over 20 records, per-item validation, per-item rewriting.
- **Team line** — planning, building, reviewing, retrieving, assembling. Each role has a different
  capability range, and no role can stand in for another.

All 12 roles: [role reference](docs/roles.en.md) ([中文](docs/roles.zh.md)).

## Install

```sh
# from GitHub (source is the artifact; no build authorization needed)
dsh plugin --profile <your-profile> add github:<owner>/dsh-plugin-subagent-roster

# or from a local checkout
dsh plugin --profile <your-profile> add /path/to/dsh-plugin-subagent-roster
```

The bundle layer applies automatically. `dsh --profile <name> --dump-config` should show 12
`roster-*` rows.

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

## Compatibility

- DSH `>=0.2.0-rc.2 <0.3.0`
- Node `>=22.18`
- Plain ESM JavaScript artifact, no build step

## License

MIT
