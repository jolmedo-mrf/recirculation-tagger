# Marfeel Recirculation Tagger — Instructions for Claude

MV3 Chrome extension (side panel) for tagging recirculation content on Marfeel-powered sites. GitHub: `jolmedo-mrf/recirculation-tagger`. Current version: v2.2.0.

## Tech stack

- Chrome MV3 (manifest v3)
- Side panel UI (`extension/sidepanel/`)
- Background service worker (`extension/background/`)
- Auto-update + release flow via GitHub Releases

## Agent skills

Pocock-pattern skills configured per `docs/agents/`:

- **Issue tracker:** GitHub (`jolmedo-mrf/recirculation-tagger`) — see [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)
- **Triage labels:** 5-state machine + categories — see [docs/agents/triage-labels.md](docs/agents/triage-labels.md)
- **Domain layout:** single-context, `CONTEXT.md` at root, `docs/adr/` for ADRs — see [docs/agents/domain.md](docs/agents/domain.md)

Workflow:
1. `/grill-with-docs` to plan features against `CONTEXT.md`
2. `/to-prd` to publish PRD as an issue with label `prd`
3. `/to-issues` to break PRD into child issues
4. `/triage` to classify into state machine
5. `/prioritize` to rank `ready-for-agent` / `ready-for-human` issues

## Out-of-band

- `analyze_recirculation.py` — standalone analyzer for tagged content
- `scripts/` — supporting build / release scripts
- Reports under `reports/`
