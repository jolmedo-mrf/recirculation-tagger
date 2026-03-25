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
    el.style.outline = '2px solid #22c55e';
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
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MRT_AUTOFILL') {
      fillModules(msg.modules)
        .then(results => {
          const errors = results.filter(r => r.error);
          if (errors.length) {
            sendResponse({
              success: false,
              error: `Failed to fill ${errors.length} module(s): ${errors[0].error}`,
              results,
            });
          } else {
            sendResponse({ success: true, filled: results.length, results });
          }
        })
        .catch(err => {
          sendResponse({ success: false, error: err.message });
        });
      return true; // async response
    }
  });
})();
