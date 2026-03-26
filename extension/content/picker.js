/**
 * Marfeel Recirculation Tagger v2 — Element Picker
 * Inspector-like element selection with hover preview,
 * scroll-wheel DOM walking, and persistent selection overlays.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let picking = false;
  let hoveredEl = null;        // Currently highlighted element
  let candidateEl = null;      // After scroll-wheel walk, the actual candidate
  let selectedModules = [];    // Array of { selector, elements, overlays, name }
  let multiSelectBuffer = [];  // Elements accumulated via Shift+click

  // ---------------------------------------------------------------------------
  // Overlay elements
  // ---------------------------------------------------------------------------

  const hoverOverlay = document.createElement('div');
  hoverOverlay.className = 'mrt-hover-overlay';
  hoverOverlay.style.cssText = 'display:none;position:absolute;pointer-events:none;z-index:2147483646;';

  const hoverLabel = document.createElement('div');
  hoverLabel.className = 'mrt-hover-label';
  hoverOverlay.appendChild(hoverLabel);

  const hoverTooltip = document.createElement('div');
  hoverTooltip.className = 'mrt-hover-tooltip';
  hoverOverlay.appendChild(hoverTooltip);

  document.documentElement.appendChild(hoverOverlay);

  // Breadcrumb trail — shows ancestor chain during Alt+scroll
  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.className = 'mrt-breadcrumb';
  breadcrumbEl.style.cssText = 'display:none;position:fixed;pointer-events:none;z-index:2147483647;';
  document.documentElement.appendChild(breadcrumbEl);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function positionOverlay(el) {
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    hoverOverlay.style.display = 'block';
    hoverOverlay.style.top = `${rect.top + scrollY}px`;
    hoverOverlay.style.left = `${rect.left + scrollX}px`;
    hoverOverlay.style.width = `${rect.width}px`;
    hoverOverlay.style.height = `${rect.height}px`;

    // Tag name + classes for tooltip
    const tag = el.tagName.toLowerCase();
    const classes = [...(el.classList || [])].slice(0, 3).join('.');
    hoverTooltip.textContent = classes ? `${tag}.${classes}` : tag;

    // Dimensions
    hoverLabel.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }

  function hideOverlay() {
    hoverOverlay.style.display = 'none';
    hideBreadcrumb();
  }

  /**
   * Show breadcrumb trail: ancestor chain from near-root down to hoveredEl.
   * Highlights the current candidateEl level so user sees where they are.
   */
  function showBreadcrumb(current, original) {
    // Build full chain: walk from original up to body, then reverse to get top-down
    const chain = [];
    let walker = original;
    while (walker && walker !== document.documentElement && walker !== document.body) {
      chain.unshift(walker);
      walker = walker.parentElement;
    }

    const currentIdx = chain.indexOf(current);
    const originalIdx = chain.indexOf(original);
    if (currentIdx < 0 || chain.length < 2) { hideBreadcrumb(); return; }

    // Show a window: 2 above current, current, everything down to original
    const start = Math.max(0, currentIdx - 2);
    const end = Math.min(chain.length, originalIdx + 1);
    const visible = chain.slice(start, end);
    const currentInVisible = currentIdx - start;
    const originalInVisible = originalIdx - start;

    let html = '';
    if (start > 0) html += '<span class="mrt-breadcrumb__sep">…</span>';

    visible.forEach((el, i) => {
      const tag = el.tagName.toLowerCase();
      const cls = [...(el.classList || [])].filter(c => !c.startsWith('mrt-')).slice(0, 2).join('.');
      const label = cls ? `${tag}.${cls}` : tag;
      const isCurrent = i === currentInVisible;
      const isOriginal = i === originalInVisible && !isCurrent;
      const cssClass = isCurrent ? 'mrt-breadcrumb__item--active' :
                        isOriginal ? 'mrt-breadcrumb__item--origin' :
                        'mrt-breadcrumb__item';
      html += `<span class="${cssClass}">${label}</span>`;
      if (i < visible.length - 1) html += '<span class="mrt-breadcrumb__sep">›</span>';
    });

    // Depth indicator: how many levels above original
    const depth = originalIdx - currentIdx;
    if (depth > 0) {
      html += `<span class="mrt-breadcrumb__depth">↑${depth}</span>`;
    }

    breadcrumbEl.innerHTML = html;
    breadcrumbEl.style.display = 'flex';
  }

  function hideBreadcrumb() {
    breadcrumbEl.style.display = 'none';
    breadcrumbEl.innerHTML = '';
  }

  function isIgnored(el) {
    // Don't select our own overlay elements
    if (el.closest('.mrt-hover-overlay, .mrt-selected-overlay')) return true;
    // Don't select the html/body
    if (el === document.documentElement || el === document.body) return true;
    return false;
  }

  function getElementFromPoint(x, y) {
    // Temporarily hide our overlay to get the real element
    hoverOverlay.style.pointerEvents = 'none';
    hoverOverlay.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    hoverOverlay.style.display = hoveredEl ? 'block' : 'none';
    return el;
  }

  // ---------------------------------------------------------------------------
  // Selection overlays (persistent green outlines for selected modules)
  // ---------------------------------------------------------------------------

  // Color palette for module overlays — WCAG AA accessible on both light & dark backgrounds
  // All colors: ≥3:1 vs white (border/label), ≥3:1 vs dark (#1a1a1a), pairwise distinct (>120)
  const MODULE_COLORS = [
    { border: '#059669', bg: 'rgba(5,150,105,0.07)',   label: '#059669' },  // emerald
    { border: '#2563eb', bg: 'rgba(37,99,235,0.07)',   label: '#2563eb' },  // blue
    { border: '#e11d48', bg: 'rgba(225,29,72,0.07)',   label: '#e11d48' },  // rose
    { border: '#7c3aed', bg: 'rgba(124,58,237,0.07)',  label: '#7c3aed' },  // violet
    { border: '#0891b2', bg: 'rgba(8,145,178,0.07)',   label: '#0891b2' },  // cyan
    { border: '#c026d3', bg: 'rgba(192,38,211,0.07)',  label: '#c026d3' },  // fuchsia
    { border: '#d97706', bg: 'rgba(217,119,6,0.07)',   label: '#d97706' },  // amber
    { border: '#64748b', bg: 'rgba(100,116,139,0.07)', label: '#64748b' },  // slate
  ];
  let colorIndex = 0;

  // ---------------------------------------------------------------------------
  // Contrast-checking utility — ensures labels are readable on any background
  // ---------------------------------------------------------------------------

  /**
   * Parse a hex color to {r, g, b} (0-255).
   */
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  /**
   * Relative luminance per WCAG 2.x.
   */
  function luminance({ r, g, b }) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  /**
   * WCAG contrast ratio between two {r,g,b} colors.
   */
  function contrastRatio(c1, c2) {
    const l1 = luminance(c1);
    const l2 = luminance(c2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Get the effective background color of an element by walking up the DOM.
   * Returns {r, g, b} — defaults to white if fully transparent.
   */
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
    return { r: 255, g: 255, b: 255 }; // default white
  }

  /**
   * Adjust a label element's styling to ensure readability against the page background.
   * If the label color has poor contrast vs the bg, adds a text-shadow for legibility.
   * If the border has poor contrast, increases border width.
   */
  function ensureOverlayContrast(overlay, label, colorHex, targetEl) {
    const bgColor = getEffectiveBgColor(targetEl);
    const fgColor = hexToRgb(colorHex);
    const ratio = contrastRatio(fgColor, bgColor);

    // Label: white text on colored bg — check if label bg has enough contrast vs page bg
    const labelVsBg = contrastRatio(fgColor, bgColor);
    if (labelVsBg < 2.5) {
      // Label blends into page background — add dark outline for visibility
      label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)';
      label.style.border = '1px solid rgba(0,0,0,0.2)';
    }

    // Border: if poor contrast vs background, make it thicker and more opaque
    if (ratio < 3.0) {
      overlay.style.borderWidth = '3px';
      overlay.style.boxShadow = `inset 0 0 0 1px ${colorHex}, 0 0 0 1px rgba(0,0,0,0.15)`;
    }
  }

  /**
   * Add overlays for ALL elements matching a selector.
   * Each module gets a unique color from the palette.
   */
  function addSelectedOverlay(el, selector, name) {
    // Remove existing overlays for this selector
    removeSelectedOverlay(selector);

    const color = MODULE_COLORS[colorIndex % MODULE_COLORS.length];
    colorIndex++;

    const allMatches = window.MRTSelectorEngine.getMatchingElements(selector);
    const elements = allMatches.length ? allMatches : [el];
    const overlays = [];

    elements.forEach((matchEl, i) => {
      const overlay = document.createElement('div');
      overlay.className = 'mrt-selected-overlay';
      overlay.dataset.mrtSelector = selector;
      overlay.style.borderColor = color.border;
      overlay.style.background = color.bg;

      const label = document.createElement('div');
      label.className = 'mrt-selected-label';
      label.style.background = color.label;
      if (i === 0) {
        label.textContent = elements.length > 1 ? `${name} (${elements.length})` : name;
      } else {
        label.textContent = `${name} #${i + 1}`;
        label.classList.add('mrt-selected-label--secondary');
      }
      overlay.appendChild(label);

      document.documentElement.appendChild(overlay);
      positionSelectedOverlay(overlay, matchEl);
      ensureOverlayContrast(overlay, label, color.border, matchEl);
      overlays.push(overlay);
    });

    selectedModules.push({ selector, elements, overlays, name, color });
  }

  function positionSelectedOverlay(overlay, el) {
    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    overlay.style.position = 'absolute';
    overlay.style.top = `${rect.top + scrollY}px`;
    overlay.style.left = `${rect.left + scrollX}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.zIndex = '2147483645';
    overlay.style.pointerEvents = 'none';
  }

  function removeSelectedOverlay(selector) {
    const idx = selectedModules.findIndex(m => m.selector === selector);
    if (idx !== -1) {
      for (const ov of selectedModules[idx].overlays) ov.remove();
      selectedModules.splice(idx, 1);
    }
    // Safety net: also remove any orphaned overlays matching this selector in the DOM
    document.querySelectorAll(`.mrt-selected-overlay[data-mrt-selector="${CSS.escape(selector)}"]`)
      .forEach(ov => ov.remove());
  }

  function clearAllOverlays() {
    for (const m of selectedModules) {
      for (const ov of m.overlays) ov.remove();
    }
    selectedModules = [];
    // Safety net: remove ALL overlays from DOM
    document.querySelectorAll('.mrt-selected-overlay').forEach(ov => ov.remove());
  }

  function refreshSelectedOverlays() {
    for (const m of selectedModules) {
      try {
        const freshEls = window.MRTSelectorEngine.getMatchingElements(m.selector);
        // Reposition existing overlays (match by index)
        freshEls.forEach((el, i) => {
          if (m.overlays[i]) {
            positionSelectedOverlay(m.overlays[i], el);
          }
        });
        m.elements = freshEls;
      } catch { /* invalid selector */ }
    }
  }

  // Reposition on scroll/resize
  let rafId = null;
  function onScrollOrResize() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      refreshSelectedOverlays();
      refreshMarfeelOverlays();
      if (picking && candidateEl) positionOverlay(candidateEl);
    });
  }
  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize, { passive: true });

  // ---------------------------------------------------------------------------
  // Picker event handlers
  // ---------------------------------------------------------------------------

  function onMouseMove(e) {
    const el = getElementFromPoint(e.clientX, e.clientY);
    if (!el || isIgnored(el)) return;

    hoveredEl = el;
    candidateEl = el;
    positionOverlay(el);
    hideBreadcrumb();
  }

  // Throttle state for DOM walk scroll
  let wheelLastTime = 0;
  const WHEEL_THROTTLE_MS = 200;

  function onMouseWheel(e) {
    if (!candidateEl) return;

    // Only intercept scroll when Alt/Option is held — otherwise allow normal page scroll
    if (!e.altKey) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // Throttle: ignore rapid scroll ticks
    const now = Date.now();
    if (now - wheelLastTime < WHEEL_THROTTLE_MS) return;
    wheelLastTime = now;

    if (e.deltaY < 0) {
      // Scroll up → walk up to parent
      const parent = candidateEl.parentElement;
      if (parent && parent !== document.documentElement && parent !== document.body) {
        candidateEl = parent;
      }
    } else {
      // Scroll down → walk back down to the original hovered element
      if (candidateEl !== hoveredEl && candidateEl.contains(hoveredEl)) {
        let child = hoveredEl;
        while (child.parentElement !== candidateEl) {
          child = child.parentElement;
        }
        candidateEl = child;
      }
    }

    positionOverlay(candidateEl);
    showBreadcrumb(candidateEl, hoveredEl);
  }

  function onClick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    const el = candidateEl || hoveredEl;
    if (!el || isIgnored(el)) return;

    // Shift+click → accumulate for multi-select pattern finding
    if (e.shiftKey) {
      multiSelectBuffer.push(el);
      el.classList.add('mrt-multiselect');
      chrome.runtime.sendMessage({
        type: 'MRT_MULTISELECT_PROGRESS',
        count: multiSelectBuffer.length,
      });
      return;
    }

    // Normal click while multi-selecting → just add this one too (no shift needed for every click)
    if (multiSelectBuffer.length > 0) {
      multiSelectBuffer.push(el);
      el.classList.add('mrt-multiselect');
      chrome.runtime.sendMessage({
        type: 'MRT_MULTISELECT_PROGRESS',
        count: multiSelectBuffer.length,
      });
      return;
    }

    // Normal single click
    selectElement(el);
  }

  function selectElement(el) {
    const selector = window.MRTSelectorEngine.generateSelector(el);
    if (!selector) {
      chrome.runtime.sendMessage({
        type: 'MRT_SELECTION_FAILED',
        reason: 'Could not generate a selector for this element. Try clicking on a different part or use Alt+scroll to walk up.',
      });
      return;
    }

    const { name, category } = window.MRTNamer.proposeModuleName(el);
    const matchCount = window.MRTSelectorEngine.countMatches(selector);
    const pageType = window.MRTSelectorEngine.detectPageType();
    const alternatives = window.MRTSelectorEngine.suggestAlternatives(el);

    let prefix;
    if (category === 'affiliate') {
      prefix = 'Affiliate';
    } else {
      prefix = pageType;
    }
    const prefixedName = `[${prefix}] ${name}`;

    const existingSelectors = selectedModules.map(m => m.selector);
    const overlaps = window.MRTSelectorEngine.checkOverlaps(selector, existingSelectors);

    addSelectedOverlay(el, selector, prefixedName);
    const assignedColor = selectedModules[selectedModules.length - 1]?.color?.border || '#059669';

    chrome.runtime.sendMessage({
      type: 'MRT_ELEMENT_SELECTED',
      selector,
      name: prefixedName,
      category,
      matchCount,
      overlaps,
      alternatives,
      color: assignedColor,
      pageType,
    });
  }

  function finishMultiSelect() {
    if (multiSelectBuffer.length < 2) {
      cancelMultiSelect();
      return;
    }

    // Clean up visual markers
    multiSelectBuffer.forEach(el => el.classList.remove('mrt-multiselect'));

    const patterns = window.MRTSelectorEngine.findCommonPattern(multiSelectBuffer);
    if (patterns && patterns.length > 0) {
      const best = patterns[0];
      const matchCount = window.MRTSelectorEngine.countMatches(best.selector);
      const pageType = window.MRTSelectorEngine.detectPageType();

      // For nested/container cases (1, 6), name from the container (LCA)
      // For similar/sibling cases (2, 3), name from the first selected element
      const nameEl = (best.case === 1 || best.case === 6)
        ? (window.MRTSelectorEngine.getMatchingElements(best.selector)[0] || multiSelectBuffer[0])
        : multiSelectBuffer[0];
      const { name, category } = window.MRTNamer.proposeModuleName(nameEl);

      let prefix;
      if (category === 'affiliate') {
        prefix = 'Affiliate';
      } else {
        prefix = pageType;
      }
      const prefixedName = `[${prefix}] ${name}`;

      const existingSelectors = selectedModules.map(m => m.selector);
      const overlaps = window.MRTSelectorEngine.checkOverlaps(best.selector, existingSelectors);

      const firstEl = multiSelectBuffer[0];
      addSelectedOverlay(firstEl, best.selector, prefixedName);
      const assignedColor = selectedModules[selectedModules.length - 1]?.color?.border || '#059669';

      chrome.runtime.sendMessage({
        type: 'MRT_ELEMENT_SELECTED',
        selector: best.selector,
        name: prefixedName,
        category,
        matchCount,
        overlaps,
        color: assignedColor,
        alternatives: patterns.slice(1).map(p => ({
          selector: p.selector,
          matchCount: window.MRTSelectorEngine.countMatches(p.selector),
          label: p.label || p.selector,
        })),
        pageType,
        // Case 5: partial selection — tell the panel how many total exist
        totalAvailable: best.totalAvailable || null,
        detectedCase: best.case,
      });
    } else {
      // No common pattern found — notify panel
      chrome.runtime.sendMessage({
        type: 'MRT_MULTISELECT_CANCELLED',
      });
    }

    // Notify panel to hide the banner
    chrome.runtime.sendMessage({ type: 'MRT_MULTISELECT_DONE' });
    multiSelectBuffer = [];
  }

  function onKeyDown(e) {
    if (!picking) return;

    if (e.key === 'Enter' && multiSelectBuffer.length > 0) {
      e.preventDefault();
      finishMultiSelect();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (multiSelectBuffer.length > 0) {
        cancelMultiSelect();
        return;
      }
      stopPicking();
      chrome.runtime.sendMessage({ type: 'MRT_PICKING_STOPPED' });
    }
  }

  function cancelMultiSelect() {
    multiSelectBuffer.forEach(el => el.classList.remove('mrt-multiselect'));
    multiSelectBuffer = [];
    chrome.runtime.sendMessage({ type: 'MRT_MULTISELECT_CANCELLED' });
  }

  // ---------------------------------------------------------------------------
  // Start/stop picking
  // ---------------------------------------------------------------------------

  function startPicking() {
    if (picking) return;
    picking = true;
    document.documentElement.classList.add('mrt-picking');

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('wheel', onMouseWheel, { capture: true, passive: false });
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;
    document.documentElement.classList.remove('mrt-picking');

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('wheel', onMouseWheel, { capture: true, passive: false });
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    hideOverlay();
    hoveredEl = null;
    candidateEl = null;
  }

  // ---------------------------------------------------------------------------
  // Highlight (from panel click)
  // ---------------------------------------------------------------------------

  function highlightSelector(selector) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('mrt-flash');
        setTimeout(() => el.classList.remove('mrt-flash'), 1500);
      }
    } catch { /* invalid selector */ }
  }

  // ---------------------------------------------------------------------------
  // Coverage computation
  // ---------------------------------------------------------------------------

  const NAV_SELECTORS = [
    'nav', 'header', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.nav', '.navbar', '.header', '.footer', '.site-header', '.site-footer',
    '.menu', '.main-menu', '.top-bar', '.bottom-bar',
  ];

  function isInNavOrFooter(el) {
    for (const sel of NAV_SELECTORS) {
      try { if (el.closest(sel)) return true; } catch { /* skip */ }
    }
    return false;
  }

  function getContentLinks() {
    return [...document.querySelectorAll('a[href]')].filter(a => {
      if (isIgnored(a)) return false;
      if (isInNavOrFooter(a)) return false;
      const href = a.getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript:')) return false;
      return true;
    });
  }

  function computeCoverage(taggedSelectors) {
    const contentLinks = getContentLinks();
    const totalLinks = contentLinks.length;
    if (totalLinks === 0) return { totalLinks: 0, coveredLinks: 0, uncoveredLinks: 0, marfeelCovered: 0, skippedLinks: 0 };

    // Links covered by user-tagged selectors
    const taggedSet = new Set();
    for (const sel of taggedSelectors) {
      try {
        const moduleEls = document.querySelectorAll(sel);
        for (const moduleEl of moduleEls) {
          for (let i = 0; i < contentLinks.length; i++) {
            if (moduleEl.contains(contentLinks[i]) || moduleEl === contentLinks[i]) {
              taggedSet.add(i);
            }
          }
        }
      } catch { /* invalid selector */ }
    }

    // Links covered by existing Marfeel modules
    const mfModules = detectMarfeelModules();
    const marfeelSet = new Set();
    for (const mod of mfModules) {
      for (let i = 0; i < contentLinks.length; i++) {
        if (mod.el.contains(contentLinks[i]) || mod.el === contentLinks[i]) {
          marfeelSet.add(i);
        }
      }
    }

    // Links explicitly skipped by Marfeel
    const skippedSet = new Set();
    const skippedEls = document.querySelectorAll('[data-mrf-recirculation-skip="true"]');
    for (const skipEl of skippedEls) {
      for (let i = 0; i < contentLinks.length; i++) {
        if (skipEl.contains(contentLinks[i]) || skipEl === contentLinks[i]) {
          skippedSet.add(i);
        }
      }
    }

    // Combined coverage (tagged + marfeel, excluding skipped)
    const allCovered = new Set([...taggedSet, ...marfeelSet]);
    const coveredLinks = allCovered.size;

    return {
      totalLinks,
      coveredLinks,
      uncoveredLinks: totalLinks - coveredLinks - skippedSet.size,
      taggedCovered: taggedSet.size,
      marfeelCovered: marfeelSet.size,
      skippedLinks: skippedSet.size,
      marfeelModuleCount: mfModules.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Uncovered links highlighting
  // ---------------------------------------------------------------------------

  let uncoveredVisible = false;
  let uncoveredNav = null;        // Navigator DOM element
  let uncoveredList = [];         // Current uncovered link elements
  let uncoveredIdx = -1;          // Current position in navigator

  function showUncoveredLinks(taggedSelectors) {
    hideUncoveredLinks();
    const contentLinks = getContentLinks();
    if (!contentLinks.length) return;

    // User-tagged coverage
    const taggedSet = new Set();
    for (const sel of taggedSelectors) {
      try {
        const moduleEls = document.querySelectorAll(sel);
        for (const moduleEl of moduleEls) {
          for (let i = 0; i < contentLinks.length; i++) {
            if (moduleEl.contains(contentLinks[i]) || moduleEl === contentLinks[i]) {
              taggedSet.add(i);
            }
          }
        }
      } catch { /* skip */ }
    }

    // Marfeel existing coverage
    const mfModules = detectMarfeelModules();
    const marfeelSet = new Set();
    for (const mod of mfModules) {
      for (let i = 0; i < contentLinks.length; i++) {
        if (mod.el.contains(contentLinks[i]) || mod.el === contentLinks[i]) {
          marfeelSet.add(i);
        }
      }
    }

    // Skipped links
    const skippedSet = new Set();
    const skippedEls = document.querySelectorAll('[data-mrf-recirculation-skip="true"]');
    for (const skipEl of skippedEls) {
      for (let i = 0; i < contentLinks.length; i++) {
        if (skipEl.contains(contentLinks[i]) || skipEl === contentLinks[i]) {
          skippedSet.add(i);
        }
      }
    }

    uncoveredList = [];
    for (let i = 0; i < contentLinks.length; i++) {
      if (skippedSet.has(i)) {
        contentLinks[i].classList.add('mrt-skipped');
      } else if (!taggedSet.has(i) && !marfeelSet.has(i)) {
        contentLinks[i].classList.add('mrt-uncovered');
        uncoveredList.push(contentLinks[i]);
      }
    }
    uncoveredVisible = true;

    // Show navigator if there are uncovered links
    if (uncoveredList.length > 0) {
      showUncoveredNav();
      navigateUncovered(0);
    }
  }

  function hideUncoveredLinks() {
    document.querySelectorAll('.mrt-uncovered, .mrt-skipped, .mrt-uncovered--active').forEach(el => {
      el.classList.remove('mrt-uncovered', 'mrt-skipped', 'mrt-uncovered--active');
    });
    uncoveredVisible = false;
    uncoveredList = [];
    uncoveredIdx = -1;
    removeUncoveredNav();
  }

  function showUncoveredNav() {
    removeUncoveredNav();
    uncoveredNav = document.createElement('div');
    uncoveredNav.className = 'mrt-uncovered-nav';

    const btnPrev = document.createElement('button');
    btnPrev.textContent = '▲';
    btnPrev.title = 'Previous uncovered link';
    btnPrev.addEventListener('click', (e) => { e.stopPropagation(); navigateUncovered(uncoveredIdx - 1); });

    const label = document.createElement('span');
    label.className = 'mrt-uncovered-nav__label';

    const btnNext = document.createElement('button');
    btnNext.textContent = '▼';
    btnNext.title = 'Next uncovered link';
    btnNext.addEventListener('click', (e) => { e.stopPropagation(); navigateUncovered(uncoveredIdx + 1); });

    uncoveredNav.appendChild(btnPrev);
    uncoveredNav.appendChild(label);
    uncoveredNav.appendChild(btnNext);
    document.documentElement.appendChild(uncoveredNav);
  }

  function removeUncoveredNav() {
    if (uncoveredNav) {
      uncoveredNav.remove();
      uncoveredNav = null;
    }
  }

  function navigateUncovered(idx) {
    if (!uncoveredList.length) return;
    // Wrap around
    if (idx < 0) idx = uncoveredList.length - 1;
    if (idx >= uncoveredList.length) idx = 0;

    // Remove active from previous
    if (uncoveredIdx >= 0 && uncoveredIdx < uncoveredList.length) {
      uncoveredList[uncoveredIdx].classList.remove('mrt-uncovered--active');
    }

    uncoveredIdx = idx;
    const el = uncoveredList[idx];
    el.classList.add('mrt-uncovered--active');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Update label
    if (uncoveredNav) {
      const label = uncoveredNav.querySelector('.mrt-uncovered-nav__label');
      if (label) label.textContent = `${idx + 1} / ${uncoveredList.length}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Marfeel existing modules detection
  // ---------------------------------------------------------------------------

  let marfeelOverlays = [];

  function detectMarfeelModules() {
    const modules = [];
    const els = document.querySelectorAll('[data-mrf-recirculation]');
    for (const el of els) {
      // Skip elements also marked as skip
      if (el.getAttribute('data-mrf-recirculation-skip') === 'true') continue;
      const value = el.getAttribute('data-mrf-recirculation');
      modules.push({ el, name: value || 'unnamed', type: 'tagged' });
    }
    return modules;
  }

  function detectMarfeelSkipped() {
    return [...document.querySelectorAll('[data-mrf-recirculation-skip="true"]')];
  }

  function showMarfeelModules() {
    hideMarfeelModules();

    const mfModules = detectMarfeelModules();
    for (const mod of mfModules) {
      const rect = mod.el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const overlay = document.createElement('div');
      overlay.className = 'mrt-marfeel-overlay';

      const label = document.createElement('div');
      label.className = 'mrt-marfeel-label';
      label.textContent = `MRF: ${mod.name}`;
      overlay.appendChild(label);

      document.documentElement.appendChild(overlay);
      positionSelectedOverlay(overlay, mod.el);
      marfeelOverlays.push({ overlay, el: mod.el });
    }

    const skippedEls = detectMarfeelSkipped();
    for (const el of skippedEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const overlay = document.createElement('div');
      overlay.className = 'mrt-marfeel-overlay mrt-marfeel-overlay--skip';

      const label = document.createElement('div');
      label.className = 'mrt-marfeel-label mrt-marfeel-label--skip';
      label.textContent = 'MRF: skip';
      overlay.appendChild(label);

      document.documentElement.appendChild(overlay);
      positionSelectedOverlay(overlay, el);
      marfeelOverlays.push({ overlay, el });
    }

    return { tagged: mfModules.length, skipped: skippedEls.length };
  }

  function hideMarfeelModules() {
    for (const item of marfeelOverlays) item.overlay.remove();
    marfeelOverlays = [];
  }

  function refreshMarfeelOverlays() {
    for (const item of marfeelOverlays) {
      if (item.el && item.overlay) {
        positionSelectedOverlay(item.overlay, item.el);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'MRT_START_PICKING':
        startPicking();
        sendResponse({ ok: true });
        break;

      case 'MRT_STOP_PICKING':
        stopPicking();
        sendResponse({ ok: true });
        break;

      case 'MRT_FINISH_MULTISELECT':
        if (multiSelectBuffer.length > 0) finishMultiSelect();
        sendResponse({ ok: true });
        break;

      case 'MRT_CANCEL_MULTISELECT':
        cancelMultiSelect();
        sendResponse({ ok: true });
        break;

      case 'MRT_RECOUNT': {
        const matchCount = window.MRTSelectorEngine.countMatches(msg.selector);
        // Update selectedModules with new selector before checking overlaps
        if (msg.oldSelector && msg.oldSelector !== msg.selector) {
          const modEntry = selectedModules.find(m => m.selector === msg.oldSelector);
          if (modEntry) modEntry.selector = msg.selector;
        }
        // Exclude own selector from overlap check
        const otherSelectors = selectedModules
          .map(m => m.selector)
          .filter(s => s !== msg.selector);
        const overlaps = window.MRTSelectorEngine.checkOverlaps(msg.selector, otherSelectors);
        // Refresh overlays for this selector
        removeSelectedOverlay(msg.oldSelector || msg.selector);
        if (matchCount > 0) {
          const firstMatch = window.MRTSelectorEngine.getMatchingElements(msg.selector)[0];
          if (firstMatch) addSelectedOverlay(firstMatch, msg.selector, msg.name || 'Module');
        }
        sendResponse({ matchCount, overlaps });
        break;
      }

      case 'MRT_HIGHLIGHT':
        highlightSelector(msg.selector);
        sendResponse({ ok: true });
        break;

      case 'MRT_REMOVE_MODULE':
        removeSelectedOverlay(msg.selector);
        sendResponse({ ok: true });
        break;

      case 'MRT_CLEAR_ALL':
        clearAllOverlays();
        stopPicking();
        sendResponse({ ok: true });
        break;

      case 'MRT_FIND_COMMON': {
        // User selected multiple elements via their selectors — find what they share
        const elements = [];
        for (const sel of (msg.selectors || [])) {
          try {
            const el = document.querySelector(sel);
            if (el) elements.push(el);
          } catch { /* skip */ }
        }
        const patterns = window.MRTSelectorEngine.findCommonPattern(elements);
        sendResponse({ patterns: patterns || [] });
        break;
      }

      case 'MRT_GET_ALTERNATIVES': {
        // Get alternative selectors for an element matched by a selector
        try {
          const el = document.querySelector(msg.selector);
          if (el) {
            const alts = window.MRTSelectorEngine.suggestAlternatives(el);
            sendResponse({ alternatives: alts });
          } else {
            sendResponse({ alternatives: [] });
          }
        } catch {
          sendResponse({ alternatives: [] });
        }
        break;
      }

      case 'MRT_RESTORE_MODULES':
        // Restore overlays from panel's saved state
        for (const m of (msg.modules || [])) {
          try {
            const el = document.querySelector(m.selector);
            if (el) addSelectedOverlay(el, m.selector, m.name);
          } catch { /* skip invalid */ }
        }
        sendResponse({ ok: true });
        break;

      case 'MRT_GET_COVERAGE': {
        const coverage = computeCoverage(msg.selectors || []);
        sendResponse(coverage);
        break;
      }

      case 'MRT_SHOW_UNCOVERED':
        showUncoveredLinks(msg.selectors || []);
        sendResponse({ ok: true, uncoveredCount: uncoveredList.length });
        break;

      case 'MRT_HIDE_UNCOVERED':
        hideUncoveredLinks();
        sendResponse({ ok: true });
        break;

      case 'MRT_SHOW_MARFEEL':
        const mfResult = showMarfeelModules();
        sendResponse(mfResult);
        break;

      case 'MRT_HIDE_MARFEEL':
        hideMarfeelModules();
        sendResponse({ ok: true });
        break;

      case 'MRT_GET_PAGE_TYPE':
        sendResponse({ pageType: window.MRTSelectorEngine.detectPageType() });
        break;

      case 'MRT_PANEL_CLOSED':
        // Panel was closed — remove all visual elements from the page
        stopPicking();
        clearAllOverlays();
        hideUncoveredLinks();
        hideMarfeelModules();
        hideOverlay();
        sendResponse({ ok: true });
        break;
    }
    return false; // sync response
  });
})();
