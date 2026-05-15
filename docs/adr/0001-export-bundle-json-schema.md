# ADR 0001 — Export bundle JSON schema

Date: 2026-05-15
Status: Accepted

## Context

The operator workflow ends today at *Hub autofill* — tags leave the extension only by being pushed into the Marfeel Hub Tag Experience form. There is no read-only artifact the operator can save, attach to a Hub ticket, share with a colleague for review, or diff against a previous capture of the same page.

We want to ship an *export bundle* — a single JSON file the side panel writes to disk via `chrome.downloads` — that captures every tag on the current page plus enough page context to make the bundle interpretable without re-running the extension.

The shape of that JSON is hard to reverse: once operators have files on disk and (eventually) downstream tooling consumes them, renaming a field or changing its type breaks anything that already parses the format. This ADR pins the v1 schema and the rules for evolving it.

## Decision

The export bundle is a single JSON object. Schema v1:

```json
{
  "schema": "marfeel-recirculation-tags",
  "schema_version": 1,
  "extension_version": "2.3.0",
  "captured_at": "2026-05-15T10:21:33.000Z",
  "page": {
    "url": "https://example.com/section/article",
    "hostname": "example.com",
    "page_type": "Article"
  },
  "tags": [
    {
      "id": "t_01HXXXXXXXX",
      "name": "Article — Related stories",
      "category": "recirculation",
      "selector": ".related-rail .card",
      "match_count": 6,
      "layout": {
        "element": { "selector": ".related-rail .card", "count": 6 },
        "anchor":  { "selector": "a.card__link" },
        "title":   { "selector": ".card__headline" },
        "image":   { "selector": "img.card__thumb" }
      }
    }
  ]
}
```

Field rules:

1. `schema` is the constant string `"marfeel-recirculation-tags"`. Consumers MUST verify it before parsing.
2. `schema_version` is an integer. Bumped on any breaking change. v1 omits the field on a tag's `layout` when the tag has no layout (do not emit `"layout": null`).
3. Field names are `snake_case` in the bundle even though the in-memory tag uses `camelCase` (`matchCount`). The serialiser is the only place this translation happens.
4. `captured_at` is ISO-8601 UTC with millisecond precision.
5. `page.page_type` is one of the values from the *Page type* glossary entry: `Home`, `Article`, `Section`, `Page`.
6. `tags[].category` is one of: `recirculation`, `affiliate`, `cta`, `navigation`.
7. The bundle MUST NOT contain auth headers, cookies, session ids, the user's Marfeel Hub tenant, the operator's email, or any field whose value the operator did not see in the side panel. Adding such a field is a v2 break.
8. Filename convention: `recirculation-tags-<hostname>-<YYYY-MM-DD>.json` (slugified hostname; suffix `-NN` only if the file system reports a clash, handled by the browser).
9. Evolving the schema:
   - Adding optional fields → still v1.
   - Renaming, removing, or changing the type of any field → v2.
   - A v2 reader MUST refuse v1 bundles unless explicitly opted in.

## Consequences

### Positive
- Operators can attach a bundle to a Hub ticket or to a Slack thread without re-running the extension.
- The format mirrors the in-memory tag shape closely enough that the serialiser is a thin transform, not a translation layer.
- Snake-case at the boundary keeps the door open for non-JS consumers (Python scripts under `scripts/` already prefer that convention).
- Pinning the schema constant + version lets future tooling (Hub import, diffing) detect bundle origin reliably.

### Negative
- We commit to backwards-compatible additions for the life of v1. Any field we forget to include in v1 becomes either an optional addition or a v2 trigger.
- The bundle excludes `coverage` — coverage is a derived, page-state quantity, not a property of the tags themselves. Operators who want coverage in the bundle will have to wait for a future ADR or a separate report artifact.
- `match_count` is captured at export time and can drift from the page if the publisher re-renders. The bundle is a snapshot, not a live link. Documented in the *Export bundle* glossary entry.
- No import path means the bundle is read-only review material. A future *Import bundle* ADR will need to address selector-collision and tag-id-collision policies.

## Alternatives considered

1. **NDJSON (one tag per line).** Streams better, but the page-level metadata (`captured_at`, `page.url`, `page_type`) has nowhere natural to live. Rejected — bundles are small enough that streaming buys nothing.
2. **CSV.** Fails on the `layout` sub-object. Rejected.
3. **Embed the bundle into the Hub autofill payload as a sidecar.** Couples export to the Hub round-trip. Rejected — the explicit purpose is *offline* review, which means no Hub dependency.
4. **camelCase field names matching the in-memory tag verbatim.** Less translation work, but locks us to the JS convention forever and makes Python consumers awkward. Rejected.
5. **No schema version field, rely on `extension_version`.** Conflates "what wrote it" with "what shape it is". Rejected — these evolve on different cadences.
