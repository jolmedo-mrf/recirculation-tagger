# Marfeel Recirculation Tagger

Chrome extension that helps identify and tag recirculation modules on publisher websites, then autofill the configuration in Marfeel Hub.

## What it does

1. **Visual element picker** — hover over any page element, Alt+Scroll to walk the DOM tree, click to select
2. **CSS selector generation** — automatically generates stable selectors for selected modules
3. **Multi-select patterns** — Shift+click multiple elements to find a common CSS pattern
4. **Coverage analysis** — see what % of page links are covered by tagged modules
5. **Hub autofill** — send tagged modules directly to the Marfeel Hub Tag Experience form

## Install

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder
4. The extension icon appears in your toolbar

## Usage

1. Navigate to any publisher website
2. Click the extension icon to open the side panel
3. Click **Select Element** to start the picker
4. Hover over a recirculation module — use **Alt+Scroll** to navigate up/down the DOM
5. Click to tag it — a colored overlay and CSS selector are generated
6. Repeat for all modules on the page
7. Click **Send to Hub** to autofill the Marfeel Hub form

### Multi-select

Hold **Shift** and click multiple items within a module, then click **Find Common Pattern** to generate a single selector that matches all of them.

### Coverage

Toggle **Show uncovered** to highlight links not covered by any tagged module. Use the navigator arrows to jump between them.

## Project structure

```
extension/
  background.js          # Service worker
  manifest.json          # Chrome extension manifest (v3)
  content/
    picker.js            # Element selection UI
    selector-engine.js   # CSS selector generation
    detector.js          # Module detection logic
    namer.js             # Human-readable naming
    overlay.js           # Overlay positioning
  sidepanel/
    panel.html/js/css    # Side panel UI
  hub/
    autofill.js          # Hub form autofill
  icons/                 # Extension icons
analyze_recirculation.py # Standalone Python analyzer (Playwright)
scripts/                 # Utility scripts
```

## Additional tools

- **`analyze_recirculation.py`** — Headless Python analyzer using Playwright + BeautifulSoup. Batch-analyzes homepages and article pages, outputs markdown reports with CSS selectors and confidence levels.

## Version

Current: **2.0.0**
