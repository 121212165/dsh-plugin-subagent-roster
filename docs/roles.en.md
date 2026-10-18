# Role reference

> Generated from `lib/roster.js`. Do not edit by hand; run `node scripts/gen-docs.mjs`.

The parent has exactly one `delegate` tool; `role` is the first column below. A role decides the
child's system prompt, its tool range, and its model tier, and no role can substitute for another.

| Role (`delegate`'s `role`) | Position | Temperament | Tier | Tools | What it is for |
|---|---|---|---|---|---|
| `batch-exact` | batch-worker | exact | batch | none (pure text transform) | One item, one contract, nothing else. Launched in parallel, one child per item. |
| `batch-fuzzy` | batch-worker | tolerant | batch | none (pure text transform) | Same contract as the exact worker, but normalises dirty input instead of failing it. |
| `batch-audit` | batch-checker | skeptical | batch | none (pure text transform) | Judges one produced item against its contract; returns a verdict, never a rewrite. |
| `lead-planner` | lead | architect | team | `read`, `glob`, `grep` | Designs the work before anything is written: decomposition, order, acceptance checks. |
| `lead-dispatcher` | lead | dispatcher | team | none (pure text transform) | Turns a stated plan into a dispatch table; no design opinions, no rewrites. |
| `builder-surgical` | builder | conservative | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Smallest diff that satisfies the acceptance check; refuses unrelated cleanup. |
| `builder-refactor` | builder | bold | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Restructures when the shape is the bug; willing to rewrite a unit that cannot be patched. |
| `reviewer-strict` | reviewer | gatekeeper | review | `read`, `glob`, `grep` | Blocks only what is actually broken. Silence is approval. |
| `reviewer-coach` | reviewer | coach | review | `read`, `glob`, `grep` | Separates blocking defects from growth opportunities, and teaches the second kind. |
| `researcher-primary` | researcher | primary-source | team | `read`, `glob`, `grep`, `web_fetch`, `web_search` | Only what the source itself says, quoted and located; no synthesis from memory. |
| `researcher-explorer` | researcher | explorer | team | `read`, `glob`, `grep`, `web_fetch`, `web_search` | Maps the option space and competing hypotheses before narrowing. |
| `tester` | tester | adversarial | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Writes the test that fails first: one behaviour per test, no implementation edits. |
| `security-reviewer` | reviewer | security | review | `read`, `glob`, `grep` | Looks for what an attacker controls and where it reaches; ignores theoretical risk. |
| `doc-writer` | scribe | reference | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Documents what exists, exactly: signatures, defaults, failure modes, no marketing. |
| `translator` | translator | localizer | batch | none (pure text transform) | Translates technical text without translating identifiers, and flags untranslatable terms. |
| `extractor` | batch-worker | schema | batch | none (pure text transform) | Turns one unstructured item into one strict JSON record; never invents a field value. |
| `sql-analyst` | analyst | query | review | `read`, `glob`, `grep` | Writes read-only SQL against the schema it actually read, and states its assumptions. |
| `api-designer` | designer | contract | team | `read`, `glob`, `grep` | Designs the contract before the code: shapes, errors, versioning, and what breaks clients. |
| `perf-analyst` | analyst | measure | review | `read`, `glob`, `grep` | Refuses to optimise without a number; names the hot path and the measurement that proves it. |
| `scribe-editor` | scribe | editor | build | `read`, `write`, `edit`, `glob`, `grep`, `pwsh` | Collapses many contributions into one consistent artifact without inventing content. |

## Model tiers

| Tier | Env var | Constraint |
|---|---|---|
| batch | `ROSTER_BATCH_MODEL` | defaults to `deepseek-flash`, maxTokens 8192 |
| build | `ROSTER_BUILD_MODEL` | defaults to `deepseek-flash`, maxTokens 16384 |
| review | `ROSTER_REVIEW_MODEL` | defaults to `deepseek-flash`, maxTokens 16384 |
| team | `ROSTER_TEAM_MODEL` | defaults to `deepseek-flash`, maxTokens 32768 |

Tiers resolve from the environment at composition time, so one composition serves both a local
bench route and a production route.
