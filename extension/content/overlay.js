/**
 * Marfeel Recirculation Tagger — Visual Overlay
 * Highlights detected modules on the page with colored outlines and labels.
 */

window.MRTOverlay = (() => {
  'use strict';

  let activeLabels = [];
  let isVisible = false;

  // Overlay type → hex color mapping (must match overlay.css)
  const TYPE_COLORS = {
    recirculation: '#059669',
    body_links:    '#2563eb',
    navigation:    '#64748b',
    cta:           '#7c3aed',
    affiliate:     '#d97706',
    uncovered:     '#e11d48',
  };

  // --- Contrast utilities (shared logic with picker.js) ---

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function wcagLuminance({ r, g, b }) {
    const [rs, gs, bs] = [r, g, b].map(c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  function contrastRatio(c1, c2) {
    const l1 = wcagLuminance(c1), l2 = wcagLuminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function getEffectiveBgColor(el) {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const a = bg.includes('rgba') ? parseFloat(bg.match(/,\s*([\d.]+)\)$/)?.[1] || '1') : 1;
          if (a > 0.5) return { r: +match[1], g: +match[2], b: +match[3] };
        }
      }
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  }

  /**
   * If the label color has poor contrast vs the element's background,
   * add visual enhancements to maintain readability.
   */
  function ensureLabelContrast(label, el, category) {
    const colorHex = TYPE_COLORS[category];
    if (!colorHex) return;
    const bgColor = getEffectiveBgColor(el);
    const fgColor = hexToRgb(colorHex);
    if (contrastRatio(fgColor, bgColor) < 2.5) {
      label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      label.style.border = '1px solid rgba(0,0,0,0.2)';
    }
  }

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
        ensureLabelContrast(label, el, m.category);
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
        ensureLabelContrast(label, el, 'uncovered');
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
