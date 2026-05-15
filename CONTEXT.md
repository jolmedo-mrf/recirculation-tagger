# Glossary

Domain language for the Marfeel Recirculation Tagger extension. Terms here describe *what things are*, not how they are implemented.

## Recirculation module

A discrete, repeated container on a publisher's page that surfaces links to other articles — for example a "Related stories" rail, a "Most read" list, a hero carousel, or an editor's pick block. Recirculation modules are the primary unit the extension exists to identify and describe.

## Tag

The act of marking a recirculation module so Marfeel knows to track it, plus the resulting record describing that module. A tag bundles a CSS selector, a human-readable name, a category, and (when applicable) a layout breakdown.

## Selector

A CSS selector string that identifies one or more elements on the live page. Selectors are the contract the extension shares with the Marfeel Hub: the Hub later evaluates them against the same page to recognise modules at runtime. Selectors are expected to be stable across reloads and unique enough to match the intended module without overreaching.

## Element picker

The interactive mode in which the user points at the page, walks the DOM, and clicks to commit a recirculation module. The picker is the operator's microscope: hover, refine, confirm.

## Multi-select pattern

A capture mode where the user nominates several example elements that *should* be grouped under one selector. The extension then infers the common pattern that covers all of them — useful when no single semantic container exists and the module must be described by its repeated children.

## Module category

A coarse classification assigned to each tagged module: *recirculation*, *affiliate*, *cta*, or *navigation*. The category drives prefixing of the tag's name and the colour treatment of its overlay.

## Page type

A coarse classification of the current page — *Home*, *Article*, *Section*, or generic *Page*. Page type informs the name prefix on new tags and decides whether a layout breakdown is offered.

## Layout

A structural description of a single recirculation module's interior: the repeated *element* (one card), and the *anchor*, *title*, and *image* selectors inside that element. Layout is what lets the Hub render its own recommendations using the publisher's existing markup.

## Overlay

A visual artefact rendered on top of the page to communicate state — the colored outline around a tagged module, the dashed underline on uncovered links, the hover preview during picking, the breadcrumb trail while walking the DOM. Overlays never participate in the page's own layout.

## Coverage

The proportion of in-content links on the current page that fall inside at least one tagged module, an already-live Marfeel module, or an explicitly skipped region. Coverage is the operator's progress meter: low coverage means the page has uncategorised link clusters worth investigating.

## Uncovered link

An in-content link that no tag, no live Marfeel module, and no skip marker accounts for. Uncovered links are the explicit work-remaining signal driving the operator's next selection.

## Hub autofill

The handoff that transfers all tags on the current page into the Marfeel Hub's *Tag Experience* form, populating selector and name fields directly rather than requiring the operator to retype them. Autofill closes the loop between visual selection and Hub configuration.

## Marfeel Hub

The Marfeel operator console where recirculation tagging is ultimately configured for a tenant. The extension is a feeder into the Hub — its job ends when the Hub form is populated and the operator saves.

## Side panel

The persistent extension UI docked next to the page. It is where tags accumulate as cards, coverage is reported, the picker is started and stopped, and the *Send to Hub* handoff is initiated. The side panel is the operator's workbench; the picker is the tool they pick up from it.

## Tag Experience

The configuration object inside the Marfeel Hub that describes how recirculation is to be detected and delivered for a given tenant. The extension's output is consumed by this object — each tagged module becomes a selector entry in a Tag Experience.

## Export bundle

A self-contained JSON artifact written to the operator's disk that captures every tag on the current page plus the minimal page context needed to interpret them later — hostname, URL, page type, capture timestamp, extension version. The export bundle is the read-only counterpart to *Hub autofill*: instead of pushing tags into the Hub, it serialises them for offline review, peer cross-check, or attachment to a bug report. The bundle does not round-trip — there is no import path back into the extension at this stage.
