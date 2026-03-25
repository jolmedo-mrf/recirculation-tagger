/**
 * Marfeel Recirculation Tagger — Visual Overlay
 * Highlights detected modules on the page with colored outlines and labels.
 */

window.MRTOverlay = (() => {
  'use strict';

  let activeLabels = [];
  let isVisible = false;

  function show(modules, uncovered) {
    clear();
    isVisible = true;

    for (const m of modules) {
      for (const el of m.elements || []) {
        el.classList.add('mrt-overlay', `mrt-overlay--${m.category}`);
        el.dataset.mrtSelector = m.selector;
        el.dataset.mrtName = m.name;

        // Add label
        if (el.style.position === '' || el.style.position === 'static') {
          el.style.position = 'relative';
          el.dataset.mrtPositionAdded = 'true';
        }
        const label = document.createElement('div');
        label.className = `mrt-label mrt-label--${m.category}`;
        label.textContent = m.name;
        el.appendChild(label);
        activeLabels.push(label);
      }
    }

    for (const u of uncovered || []) {
      for (const el of u.elements || []) {
        el.classList.add('mrt-overlay', 'mrt-overlay--uncovered');
        el.dataset.mrtSelector = u.selector;
        el.dataset.mrtName = `Uncovered (${u.linkCount} links)`;

        if (el.style.position === '' || el.style.position === 'static') {
          el.style.position = 'relative';
          el.dataset.mrtPositionAdded = 'true';
        }
        const label = document.createElement('div');
        label.className = 'mrt-label mrt-label--uncovered';
        label.textContent = `⚠ Uncovered (${u.linkCount} links)`;
        el.appendChild(label);
        activeLabels.push(label);
      }
    }
  }

  function clear() {
    isVisible = false;

    // Remove labels
    for (const label of activeLabels) {
      label.remove();
    }
    activeLabels = [];

    // Remove overlay classes and cleanup
    document.querySelectorAll('.mrt-overlay').forEach(el => {
      el.classList.remove(
        'mrt-overlay', 'mrt-overlay--recirculation', 'mrt-overlay--body_links',
        'mrt-overlay--navigation', 'mrt-overlay--cta', 'mrt-overlay--affiliate',
        'mrt-overlay--uncovered', 'mrt-overlay--highlight'
      );
      if (el.dataset.mrtPositionAdded === 'true') {
        el.style.position = '';
        delete el.dataset.mrtPositionAdded;
      }
      delete el.dataset.mrtSelector;
      delete el.dataset.mrtName;
    });
  }

  function highlightModule(selector) {
    // Remove previous highlights
    document.querySelectorAll('.mrt-overlay--highlight').forEach(el => {
      el.classList.remove('mrt-overlay--highlight');
    });

    // Highlight elements matching this selector
    try {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        elements.forEach(el => el.classList.add('mrt-overlay--highlight'));
      }
    } catch { /* invalid selector */ }
  }

  function highlightModuleAtIndex(selector, index) {
    // Remove previous highlights
    document.querySelectorAll('.mrt-overlay--highlight').forEach(el => {
      el.classList.remove('mrt-overlay--highlight');
    });

    try {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0 && index < elements.length) {
        const el = elements[index];
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('mrt-overlay--highlight');
      }
    } catch { /* invalid selector */ }
  }

  function isShowing() {
    return isVisible;
  }

  // Listen for messages from the side panel
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MRT_ANALYZE') {
      const result = window.MRTDetector.analyze();
      show(result.modules, result.uncovered);
      sendResponse(result);
    } else if (msg.type === 'MRT_CLEAR') {
      clear();
      sendResponse({ ok: true });
    } else if (msg.type === 'MRT_HIGHLIGHT') {
      highlightModule(msg.selector);
      sendResponse({ ok: true });
    } else if (msg.type === 'MRT_HIGHLIGHT_INDEX') {
      highlightModuleAtIndex(msg.selector, msg.index);
      sendResponse({ ok: true });
    } else if (msg.type === 'MRT_TOGGLE_OVERLAY') {
      if (isVisible) {
        clear();
      } else if (msg.modules && msg.uncovered) {
        show(msg.modules, msg.uncovered);
      }
      sendResponse({ visible: isVisible });
    }
    return true; // keep channel open for async
  });

  return { show, clear, highlightModule, highlightModuleAtIndex, isShowing };
})();
