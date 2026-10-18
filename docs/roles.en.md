# Role reference

> Generated from `lib/roster.js`. Do not edit by hand; run `node scripts/gen-docs.mjs`.

Each role is one `tool-subagent` instance. Choosing a role is choosing a tool, and no role can
substitute for another.

| Tool | Position | Temperament | Tier | Tools | What it is for |
|---|---|---|---|---|---|
| `subagent_batch_exact` | batch-worker | exact | batch | none (pure text transform) | One item, one contract, nothing else. Launched in parallel, one child per item. |
| `subagent_batch_fuzzy` | batch-worker | tolerant | batch | none (pure text transform) | Same contract as the exact worker, but normalises dirty input instead of failing it. |
| `subagent_batch_audit` | batch-checker | skeptical | batch | none (pure text transform) | Judges one produced item against its contract; returns a verdict, never a rewrite. |
| `subagent_lead_planner` | lead | architect | team | `read`, `glob`, `grep` | Designs the work before anything is written: decomposition, order, acceptance checks. |
| `subagent_lead_dispatcher` | lead | dispatcher | team | none (pure text transform) | Turns a stated plan into a dispatch table; no design opinions, no rewrites. |
| `subagent_builder_surgical` | builder | conservative | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Smallest diff that satisfies the acceptance check; refuses unrelated cleanup. |
| `subagent_builder_refactor` | builder | bold | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Restructures when the shape is the bug; willing to rewrite a unit that cannot be patched. |
| `subagent_reviewer_strict` | reviewer | gatekeeper | review | `read`, `glob`, `grep` | Blocks only what is actually broken. Silence is approval. |
| `subagent_reviewer_coach` | reviewer | coach | review | `read`, `glob`, `grep` | Separates blocking defects from growth opportunities, and teaches the second kind. |
| `subagent_researcher_primary` | researcher | primary-source | team | `read`, `glob`, `grep`, `web_fetch`, `web_search` | Only what the source itself says, quoted and located; no synthesis from memory. |
| `subagent_researcher_explorer` | researcher | explorer | team | `read`, `glob`, `grep`, `web_fetch`, `web_search` | Maps the option space and competing hypotheses before narrowing. |
| `subagent_scribe_editor` | scribe | editor | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Collapses many contributions into one consistent artifact without inventing content. |

## Model tiers

| Tier | Env var | Constraint |
|---|---|---|
| batch | `ROSTER_BATCH_MODEL` | defaults to `deepseek-flash`, maxTokens 8192 |
| build | `ROSTER_BUILD_MODEL` | defaults to `deepseek-flash`, maxTokens 16384 |
| review | `ROSTER_REVIEW_MODEL` | defaults to `deepseek-flash`, maxTokens 16384 |
| team | `ROSTER_TEAM_MODEL` | defaults to `deepseek-flash`, maxTokens 32768 |

Tiers resolve from the environment at composition time, so one composition serves both a local
bench route and a production route.
