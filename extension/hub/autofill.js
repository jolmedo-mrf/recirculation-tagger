/**
 * Marfeel Recirculation Tagger v2 — Hub Autofill
 * Fills the Recirculation Tag Experience form on hub.marfeel.com.
 * Handles React-controlled inputs using native value setter.
 */

(() => {
  'use strict';

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  ).set;

  /**
   * Set a React-controlled input's value and trigger change detection.
   */
  function setReactInputValue(input, value) {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Flash a green border on an element for visual feedback.
   */
  function flashSuccess(el) {
    const original = el.style.outline;
    el.style.outline = '2px solid #059669';
    el.style.outlineOffset = '-1px';
    setTimeout(() => {
      el.style.outline = original;
      el.style.outlineOffset = '';
    }, 1500);
  }

  /**
   * Wait for an element matching a selector to appear in the DOM.
   */
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for: ${selector}`));
      }, timeout);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /**
   * Find the "+ Add recirculation module using css selector" button.
   */
  function findAddButton() {
    const buttons = document.querySelectorAll('button, [role="button"], a, span');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase().trim();
      if (text.includes('add recirculation module using css selector') ||
          text.includes('add recirculation module')) {
        return btn;
      }
    }
    // Fallback: look for any "+" add button inside the Selectors section
    const headings = document.querySelectorAll('h3, h4, strong, b');
    for (const h of headings) {
      if ((h.textContent || '').trim().toLowerCase() === 'selectors') {
        // Find the next clickable "add" element after this heading
        let sibling = h.nextElementSibling || h.parentElement?.nextElementSibling;
        while (sibling) {
          const addBtn = sibling.querySelector('[class*="add"], [class*="Add"], button');
          if (addBtn) return addBtn;
          const text = (sibling.textContent || '').toLowerCase();
          if (text.includes('add') && text.includes('selector')) return sibling;
          sibling = sibling.nextElementSibling;
        }
      }
    }
    return null;
  }

  /**
   * Get the current selector input pairs in the form.
   */
  function getSelectorInputPairs() {
    // The form has pairs of inputs: [CSS selector] → [Module name]
    // They appear in a section labeled "Selectors"
    const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const pairs = [];

    for (let i = 0; i < inputs.length - 1; i++) {
      const left = inputs[i];
      const right = inputs[i + 1];

      // Check if these look like a selector/name pair by proximity
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();

      // They should be on roughly the same vertical line and close together
      if (Math.abs(leftRect.top - rightRect.top) < 30) {
        // Check if left placeholder mentions "selector" or if they're in the Selectors section
        const leftPlaceholder = (left.placeholder || '').toLowerCase();
        const rightPlaceholder = (right.placeholder || '').toLowerCase();
        const isCandidate = leftPlaceholder.includes('selector') ||
                           rightPlaceholder.includes('name') ||
                           rightPlaceholder.includes('module') ||
                           (!left.value && !right.value);

        if (isCandidate) {
          pairs.push({ selectorInput: left, nameInput: right });
        }
      }
    }

    return pairs;
  }

  /**
   * Fill modules into the form.
   */
  async function fillModules(modules) {
    const results = [];

    for (const { selector, name } of modules) {
      // Check if there's already an empty pair we can use
      let pairs = getSelectorInputPairs();
      let targetPair = pairs.find(p => !p.selectorInput.value && !p.nameInput.value);

      if (!targetPair) {
        // Click the "Add" button to create a new row
        const addBtn = findAddButton();
        if (!addBtn) {
          results.push({ selector, name, error: 'Could not find "Add" button' });
          continue;
        }

        addBtn.click();

        // Wait for new inputs to appear
        await new Promise(r => setTimeout(r, 300));

        pairs = getSelectorInputPairs();
        targetPair = pairs.find(p => !p.selectorInput.value && !p.nameInput.value);

        if (!targetPair && pairs.length > 0) {
          targetPair = pairs[pairs.length - 1];
        }
      }

      if (!targetPair) {
        results.push({ selector, name, error: 'Could not find input fields' });
        continue;
      }

      // Fill the inputs
      setReactInputValue(targetPair.selectorInput, selector);
      setReactInputValue(targetPair.nameInput, name);

      flashSuccess(targetPair.selectorInput);
      flashSuccess(targetPair.nameInput);

      results.push({ selector, name, success: true });

      // Small delay between modules for React to process
      await new Promise(r => setTimeout(r, 150));
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Layout filling
  // ---------------------------------------------------------------------------

  /**
   * Find the "+ Add recirculation module layout" button.
   */
  function findAddLayoutButton() {
    const buttons = document.querySelectorAll('button, [role="button"], a, span');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase().trim();
      if (text.includes('add recirculation module layout')) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Get the current layout input groups in the form.
   * Each layout row has 4 inputs: Element, Anchor, Title, Image.
   */
  function getLayoutInputGroups() {
    // Find the Layouts section heading
    const headings = document.querySelectorAll('h3, h4, strong, b, [class*="heading"], [class*="title"]');
    let layoutSection = null;
    for (const h of headings) {
      if ((h.textContent || '').trim().toLowerCase() === 'layouts') {
        layoutSection = h;
        break;
      }
    }

    // Find all inputs in the page
    const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
    const groups = [];

    // Look for rows of 4 inputs aligned horizontally (Element, Anchor, Title, Image)
    for (let i = 0; i < allInputs.length - 3; i++) {
      const a = allInputs[i];
      const b = allInputs[i + 1];
      const c = allInputs[i + 2];
      const d = allInputs[i + 3];

      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const cRect = c.getBoundingClientRect();
      const dRect = d.getBoundingClientRect();

      // All 4 should be on roughly the same vertical line
      const sameRow = Math.abs(aRect.top - bRect.top) < 30 &&
                      Math.abs(bRect.top - cRect.top) < 30 &&
                      Math.abs(cRect.top - dRect.top) < 30;

      if (!sameRow) continue;

      // Check if these look like layout fields by checking nearby labels
      const container = a.closest('[class]') || a.parentElement;
      const containerText = (container?.textContent || '').toLowerCase();
      const hasLayoutLabels = containerText.includes('element') ||
                              containerText.includes('anchor') ||
                              containerText.includes('title') ||
                              containerText.includes('image');

      if (hasLayoutLabels || layoutSection) {
        groups.push({
          elementInput: a,
          anchorInput: b,
          titleInput: c,
          imageInput: d,
        });
        i += 3; // Skip ahead past this group
      }
    }

    return groups;
  }

  /**
   * Fill layouts into the form.
   * Strategy: always click "Add layout" button first to ensure a row exists,
   * then find and fill the newly created inputs.
   */
  async function fillLayouts(layouts) {
    if (!layouts || !layouts.length) return [];
    const results = [];

    for (const { element, anchor, title, image } of layouts) {
      // First try to find an existing empty group
      let groups = getLayoutInputGroups();
      let targetGroup = groups.find(g =>
        !g.elementInput.value && !g.anchorInput.value &&
        !g.titleInput.value && !g.imageInput.value
      );

      // If no empty group, click "Add" to create one
      if (!targetGroup) {
        const addBtn = findAddLayoutButton();
        if (!addBtn) {
          results.push({ error: 'Could not find "Add layout" button' });
          continue;
        }

        // Count inputs before clicking
        const inputsBefore = document.querySelectorAll('input[type="text"], input:not([type])').length;

        addBtn.click();

        // Wait for React to render new inputs — poll for new inputs appearing
        let attempts = 0;
        while (attempts < 10) {
          await new Promise(r => setTimeout(r, 200));
          const inputsAfter = document.querySelectorAll('input[type="text"], input:not([type])').length;
          if (inputsAfter > inputsBefore) break;
          attempts++;
        }

        groups = getLayoutInputGroups();
        targetGroup = groups.find(g =>
          !g.elementInput.value && !g.anchorInput.value &&
          !g.titleInput.value && !g.imageInput.value
        );

        // Last resort: take the last group
        if (!targetGroup && groups.length > 0) {
          targetGroup = groups[groups.length - 1];
        }
      }

      if (!targetGroup) {
        // Fallback: find ALL empty input groups of 4 horizontally aligned
        const allInputs = [...document.querySelectorAll('input[type="text"], input:not([type])')];
        for (let i = allInputs.length - 4; i >= 0; i--) {
          const a = allInputs[i], b = allInputs[i+1], c = allInputs[i+2], d = allInputs[i+3];
          const aR = a.getBoundingClientRect(), bR = b.getBoundingClientRect();
          const cR = c.getBoundingClientRect(), dR = d.getBoundingClientRect();
          if (Math.abs(aR.top - bR.top) < 30 && Math.abs(bR.top - cR.top) < 30 &&
              Math.abs(cR.top - dR.top) < 30 && !a.value && !b.value && !c.value && !d.value) {
            targetGroup = { elementInput: a, anchorInput: b, titleInput: c, imageInput: d };
            break;
          }
        }
      }

      if (!targetGroup) {
        results.push({ error: 'Could not find layout input fields' });
        continue;
      }

      // Fill the 4 fields
      if (element) setReactInputValue(targetGroup.elementInput, element);
      if (anchor) setReactInputValue(targetGroup.anchorInput, anchor);
      if (title) setReactInputValue(targetGroup.titleInput, title);
      if (image) setReactInputValue(targetGroup.imageInput, image);

      flashSuccess(targetGroup.elementInput);
      flashSuccess(targetGroup.anchorInput);
      flashSuccess(targetGroup.titleInput);
      flashSuccess(targetGroup.imageInput);

      results.push({ success: true });

      await new Promise(r => setTimeout(r, 150));
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MRT_AUTOFILL') {
      (async () => {
        // Fill selectors (modules)
        const moduleResults = await fillModules(msg.modules);
        const moduleErrors = moduleResults.filter(r => r.error);

        // Fill layouts if provided
        let layoutResults = [];
        if (msg.layouts && msg.layouts.length) {
          layoutResults = await fillLayouts(msg.layouts);
        }
        const layoutErrors = layoutResults.filter(r => r.error);

        const totalErrors = moduleErrors.length + layoutErrors.length;
        if (totalErrors) {
          sendResponse({
            success: false,
            error: `Failed: ${moduleErrors.length} module(s), ${layoutErrors.length} layout(s)`,
            results: moduleResults,
            layoutResults,
          });
        } else {
          sendResponse({
            success: true,
            filled: moduleResults.length,
            layoutsFilled: layoutResults.length,
            results: moduleResults,
            layoutResults,
          });
        }
      })();
      return true; // async response
    }
  });
})();
