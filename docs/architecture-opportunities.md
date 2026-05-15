# Architecture opportunities

A walk through `extension/` looking for shallow modules, tight coupling, duplication, and friction points that would compound as the codebase grows. Each opportunity is framed in the vocabulary of [CONTEXT.md](../CONTEXT.md).

The list is ordered roughly by leverage — the earlier ones unlock or simplify the later ones.

---

## 1. Extract a shared "DOM heuristics" table from the four near-clones

**Files:** `extension/content/detector.js`, `extension/content/selector-engine.js`, `extension/content/namer.js`, `extension/content/layout-detector.js`

**Problem.** The same four tables — `MODULE_DATA_ATTRS`, `UTILITY_PREFIXES`, `UTILITY_EXACT`, `MODULE_KEYWORDS`, `JUNK_CLASS_PATTERNS`, `CONTAINER_PATTERNS` — are redeclared verbatim (or near-verbatim) across these files. `layout-detector.js` even renames them `LAYOUT_UTILITY_*` to avoid the collision, which is the loudest possible signal that the abstraction is missing. Any new heuristic — a publisher CMS class prefix, a new data attribute convention — has to be hunted down and updated in three to four places, and the *namer's* table can drift from the *selector engine's* table without anything failing loudly.

**Solution sketch.** Promote these tables into a single content-script module (e.g. `content/heuristics.js`) exposing `window.MRTHeuristics` with `isUtilityClass`, `isJunkClass`, `MODULE_DATA_ATTRS`, `MODULE_KEYWORDS`, `CONTAINER_PATTERNS`. Load it first in the `content_scripts` array. The selector engine, namer, layout detector, and detector all consume the same source.

**Benefit.** Locality: the operator's mental model of "what classes does the extension consider noise" lives in one file. Leverage: adding a new utility prefix becomes a one-line change instead of a four-file refactor; the *namer* and *selector engine* can no longer silently disagree on whether `widget-7` is meaningful.

---

## 2. Centralise the WCAG contrast utility (and the colour palette)

**Files:** `extension/content/picker.js`, `extension/content/overlay.js`

**Problem.** `hexToRgb`, `luminance` / `wcagLuminance`, `contrastRatio`, and `getEffectiveBgColor` are duplicated character-for-character (with one renamed) across the picker and the overlay. Each file has its own opinion about what colour belongs to which module *category* — `picker.js` uses an eight-colour `MODULE_COLORS` rotation, `overlay.js` uses a four-key `TYPE_COLORS` map keyed by category. The two pictures of "what colour is an affiliate module" are out of sync today (picker rotates through 8 colours regardless of category; overlay binds colour to category). Whichever is correct, the duplication makes that question hard to even ask.

**Solution sketch.** Create `content/overlay-style.js` (or fold into the heuristics module) holding the canonical palette plus `ensureContrast(label, element, colorHex)`. Decide explicitly: is module colour driven by *category* or by *selection order*? Encode that decision in one place.

**Benefit.** Locality: contrast policy is one of those "look-and-feel" concerns that creeps everywhere if not owned. Leverage: a designer asking to swap the palette for the recirculation category touches one file. Removes ~80 lines of duplicate code.

---

## 3. Replace the 35-string message-type vocabulary with a typed message bus

**Files:** `extension/background.js`, `extension/sidepanel/panel.js`, `extension/content/picker.js`, `extension/content/overlay.js`, `extension/content/layout-detector.js`, `extension/hub/autofill.js`

**Problem.** The side panel and content scripts communicate through 35+ ad-hoc string constants (`MRT_START_PICKING`, `MRT_RECOUNT`, `MRT_HIDE_UNCOVERED`, …). The set is large enough that a typo silently fails (the `chrome.runtime.onMessage` listener just doesn't match), there is no single registry of what messages exist, and the request/response shapes are documented only by example. Several pairs are near-duplicates (`MRT_SHOW_UNCOVERED` + `MRT_HIDE_UNCOVERED`, `MRT_SHOW_MARFEEL` + `MRT_HIDE_MARFEEL`) which suggests the protocol is at the wrong granularity.

**Solution sketch.** Introduce `extension/shared/messages.js` (loaded into both contexts) exporting `MSG.START_PICKING`, `MSG.HIDE_UNCOVERED`, …, plus thin helpers `send(type, payload)` and `on(type, handler)` that wrap `chrome.runtime` with one consistent async/response idiom. Consider collapsing `SHOW_*` + `HIDE_*` pairs into a single `TOGGLE_*` with a boolean — the side panel already tracks `showingUncovered` / `showingMarfeel` state.

**Benefit.** Locality: the protocol between the *side panel* and the *element picker* becomes a single discoverable file. Leverage: every future message is one constant + one handler instead of one constant in two places and three "did I spell it right?" hunts. Renaming a message becomes a refactor, not a bug.

---

## 4. Split `panel.js` (1185 lines) along its actual seams

**Files:** `extension/sidepanel/panel.js`

**Problem.** The side panel script mixes seven distinct responsibilities into one IIFE: tab/messaging glue, per-domain persistence, the tag list state machine, the coverage ring rendering, the *card* DOM rendering (including the 428-line `createCard` function), the update-notice UI, and the layout editor with its per-field navigator. `createCard` builds an HTML template string of selector inputs, alternatives, layout fields, and the example navigator, then attaches a dozen event listeners — it is the single biggest source of fear in the codebase to change.

**Solution sketch.** Decompose along the domain seams CONTEXT.md already names:
  - `panel/store.js` — modules array, persistence, `nextId`, `storageKey`.
  - `panel/coverage.js` — the ring + legend + toggle state.
  - `panel/card.js` — `createCard` plus its sub-renderers `buildLayoutHtml`, `buildAlternativesHtml`, `buildOverlapsHtml`.
  - `panel/messaging.js` — `sendToTab` with the injection fallback, plus the inbound `onMessage` dispatch.
  - `panel.js` — wiring only.

**Benefit.** Locality: a question like "how does coverage decide to include Marfeel modules?" or "where does a card's *layout* field get rendered?" maps to one short file. Leverage: makes opportunities 5 and 6 below much cheaper to land.

---

## 5. Extract `Coverage` as a first-class concept

**Files:** `extension/content/picker.js` (`computeCoverage`, `getContentLinks`, `isInNavOrFooter`, `NAV_SELECTORS`, the uncovered-link navigator), `extension/sidepanel/panel.js` (`renderCoverageRing`, `updateCoverage`, `lastCoverageData`, `requestCoverage`).

**Problem.** *Coverage* is one of the four nouns the UI revolves around (per CONTEXT.md), yet its definition is spread across two contexts that each know half the story. `picker.js` computes the raw sets; `panel.js` re-derives "effective uncovered" with a parallel formula that depends on whether the Marfeel toggle is on. The two formulas have already drifted (the picker subtracts skipped from uncovered; the panel recomputes uncovered as `totalLinks - taggedCovered - skippedLinks` when the toggle is off). The uncovered-links *navigator* DOM (prev/next buttons floating on the page) lives inside the picker, which makes the picker responsible for paginated UI it has no business owning.

**Solution sketch.** Create a `content/coverage.js` module that owns the coverage model (the four sets — tagged, marfeel, skipped, uncovered) and exposes a single `computeCoverage({ taggedSelectors, includeMarfeel })` returning a fully-resolved object the panel can render as-is. Move the uncovered navigator into `content/overlay.js` where it belongs. Have the panel ask "give me coverage with marfeel on/off"; never recompute.

**Benefit.** Locality: there is one true definition of an *uncovered link* in the codebase. Leverage: when *export bundle* (CONTEXT.md term) needs to serialise coverage alongside tags, it consumes the same object the ring renders. Future "skip" semantics (e.g. user-defined skip regions) extend one module.

---

## 6. Give the *tag* a real identity instead of a bag of fields

**Files:** `extension/sidepanel/panel.js` (the `modules` array + `nextId` counter), `extension/content/picker.js` (`selectedModules` — a parallel array on the content side).

**Problem.** A *tag* (per CONTEXT.md: selector + name + category + layout) is represented twice with subtly different shapes — the panel's `modules` array (`{ id, selector, name, category, matchCount, layout, collapsed, color, overlaps, alternatives }`) and the picker's `selectedModules` array (`{ selector, elements, overlays, name, color }`). The two are kept in sync by a dance of `MRT_RECOUNT`, `MRT_REMOVE_MODULE`, `MRT_RESTORE_MODULES`, and `MRT_CLEAR_ALL`. Editing a selector inline triggers a recount round-trip whose result must be merged back. Nothing centralises the invariant that "the panel's tag list and the page's overlays describe the same set."

**Solution sketch.** Model a `Tag` as the data record (panel-side) and a `TagOverlay` as the visual projection (content-side). The panel is the source of truth; the picker holds a passive `Map<selector, TagOverlay>` that mirrors it. Add one message `MRT_SYNC_TAGS` carrying the canonical list; the picker reconciles its overlays to match (add missing, remove orphans, reposition existing). The five `MRT_*` mutations collapse into one.

**Benefit.** Locality: questions like "what does it mean to delete a tag?" stop having two answers. Leverage: solving this dissolves an entire class of race conditions (panel deletes, picker still has the overlay; selector edit succeeds, recount fails halfway). Also unblocks features like reordering, multi-tab support, or undo, which all assume a single source of truth.

---

## 7. Make Marfeel-attribute knowledge a strategy, not a constant

**Files:** `extension/content/picker.js` (`detectMarfeelModules`, `detectMarfeelSkipped`, both query `data-mrf-recirculation*` directly), `extension/content/detector.js` (`MARFEEL_ATTRS`), `extension/content/selector-engine.js` (comment-only awareness).

**Problem.** Three files have independent opinions about what attribute names the Marfeel runtime stamps on a page (`data-mrf-recirculation`, `data-mrf-recirculation-skip`, `data-mrf-experience`, `data-mrf-module`). `picker.js` hardcodes `data-mrf-recirculation` in five places — including inside *coverage* — meaning the Marfeel-coverage feature is wired into the picker via implicit string coupling rather than an explicit dependency.

**Solution sketch.** Move the Marfeel runtime attribute vocabulary into a `MarfeelMarkers` constant (probably in the heuristics module from opportunity 1) with helpers `findMarfeelModules(root)` and `findSkippedRegions(root)`. The picker consumes the helpers; the coverage module consumes them; nothing else need know.

**Benefit.** Locality: "what does Marfeel mark on a page" is one file. Leverage: when the runtime adds a new marker (e.g. `data-mrf-recommender`), there is one place to teach the extension about it; no risk of *coverage* and *show Marfeel overlay* disagreeing on which elements count.

---

## 8. Carve a thin contract for the Hub autofill instead of a 387-line monolith

**Files:** `extension/hub/autofill.js`, `extension/background.js` (`handleSendToHub`).

**Problem.** `hub/autofill.js` is the only file that knows the shape of the Marfeel Hub's *Tag Experience* form. It mixes three responsibilities: locating the form (button-text scanning, mutation observers, heading-text fallbacks), driving React-controlled inputs (`setReactInputValue`), and orchestrating the per-tag fill loop. The background's `handleSendToHub` adds a fragile timing dance (2s wait after navigation, 500ms after focus). All of this lives outside any test surface, against a third-party React app that can change shape at any time.

**Solution sketch.** Split into `hub/locator.js` (find-the-form primitives — buttons, rows, inputs — each a named function returning an element or `null`) and `hub/filler.js` (the orchestration that consumes the locator and the tag list). Make `MRT_AUTOFILL` carry a single well-typed payload (`{ tags: Tag[] }`) instead of `{ modules, layouts }`. Replace the timing dance with a single `waitForForm()` that polls for the first input — the same `waitForElement` already exists.

**Benefit.** Locality: when the Hub form changes shape, exactly one file needs to learn the new shape, and the failure mode is "locator returned null" instead of "filler did nothing visible". Leverage: making this surface narrow is what eventually allows a non-Playwright integration test for the autofill flow.

---

## 9. Lift the page-type / category prefixing rule out of the picker

**Files:** `extension/content/picker.js` (the `prefix` branches in `selectElement` and `finishMultiSelect`), `extension/content/namer.js` (CATEGORY_RULES — knows the category but never the page type).

**Problem.** The picker contains an inlined rule — "if category is affiliate, prefix `[Affiliate]`; otherwise prefix the page type" — copy-pasted across `selectElement` and `finishMultiSelect`. The rule legitimately belongs to the *namer* (which already classifies category) and *selector-engine* (which already classifies page type), but the picker is where the two streams join. Right now any change to the prefixing policy is a two-site edit inside the most state-heavy module in the codebase.

**Solution sketch.** Move the joining rule into `namer.js` as `buildDisplayName({ element, pageType })` returning the already-prefixed name. The picker calls it once. Bonus: removes duplication between the single-select and multi-select code paths.

**Benefit.** Locality: the naming rule lives next to the naming code. Leverage: small, but compounds — it is exactly the kind of "one-line shortcut" that makes the picker fear-inducing to refactor later.

---

## 10. Decide what `detector.js` is for, or delete it

**Files:** `extension/content/detector.js` (1282 lines), referenced only by `extension/content/overlay.js` (`window.MRTDetector.analyze()`).

**Problem.** `detector.js` is the largest single file in the codebase and is no longer in the manifest's `content_scripts` array — it is not loaded on any page. Its `analyze()` function is referenced from `overlay.js` (which is *also* not in the manifest), suggesting both belong to a previous "auto-detect modules on page load" feature that has been superseded by the interactive *element picker*. Meanwhile the file is the source of the constant-table duplication identified in opportunity 1.

**Solution sketch.** Confirm with the operator that auto-detection is genuinely retired. If yes, delete `detector.js` and `overlay.js` (or move them to an `archive/` folder outside the build) and re-derive opportunity 1's heuristics module from `selector-engine.js` alone. If auto-detection is meant to come back, then resurrect it as an explicit module behind a side-panel button — but not as dead weight orbiting the live code.

**Benefit.** Locality: the codebase stops lying about which files are live. Leverage: removing ~1500 lines of unreferenced code instantly cuts the cost of every cross-file search and grep, and removes three of the four duplicates targeted by opportunity 1 for free.

---

## Suggested order

1. **#10** (delete dead code) — frees the field.
2. **#1** + **#2** (extract shared heuristics + colour) — cheap, immediately reduces duplication.
3. **#3** (typed message bus) + **#7** (Marfeel markers) — small, unblock everything else.
4. **#5** (coverage as a concept) + **#6** (single source of truth for tags) — the structural payoff.
5. **#4** (split panel.js) — easier with 5 and 6 done.
6. **#8** (Hub contract) + **#9** (naming rule) — polish.
