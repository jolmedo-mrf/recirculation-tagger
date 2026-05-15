# Triage labels

State machine (mutually exclusive — one per issue):

| Label | Meaning |
|---|---|
| `needs-triage` | Maintainer evaluation required |
| `needs-info` | Awaiting reporter information |
| `ready-for-agent` | Fully specified, ready for AFK agent |
| `ready-for-human` | Needs human implementation |
| `wontfix` | Will not be actioned |

Categories (mutually exclusive — one per issue):

| Label | Meaning |
|---|---|
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |

Additional:

- `prd` — parent PRD issue
- `priority-high` / `priority-medium` / `priority-low` — set via `/prioritize` after triage
- `blocker` — set via `/prioritize` when downstream_count ≥ 3

When closing an enhancement as `wontfix`, write the rationale to `.out-of-scope/<slug>.md` and link it from the closure comment.
