/**
 * Marfeel Recirculation Tagger v2 — Side Panel Controller
 * Selection-driven state with editable cards and Hub autofill.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let modules = [];     // Array of { id, selector, name, category, matchCount, layout?, collapsed? }
  let isPicking = false;
  let currentDomain = '';
  let nextId = 1;
  let showingUncovered = false;
  let showingMarfeel = false;
  let currentPageType = 'Page';

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------

  const siteLogo = document.getElementById('site-logo');
  const btnPick = document.getElementById('btn-pick');
  const pickLabel = document.getElementById('pick-label');
  const btnReload = document.getElementById('btn-reload');
  const btnClear = document.getElementById('btn-clear');
  const btnSend = document.getElementById('btn-send');
  const statusEl = document.getElementById('status');
  const modulesEl = document.getElementById('modules');
  const emptyState = document.getElementById('empty-state');
  const domainEl = document.getElementById('domain');
  const pageTypeEl = document.getElementById('page-type');
  const moduleCount = document.getElementById('module-count');
  const footerEl = document.getElementById('footer');
  const toastContainer = document.getElementById('toast-container');
  const coverageEl = document.getElementById('coverage');
  const coverageRingTagged = document.getElementById('coverage-ring-tagged');
  const coverageRingMarfeel = document.getElementById('coverage-ring-marfeel');
  const coveragePct = document.getElementById('coverage-pct');
  const coverageCount = document.getElementById('coverage-count');
  const legendTagged = document.getElementById('legend-tagged');
  const legendMarfeel = document.getElementById('legend-marfeel');
  const legendUncovered = document.getElementById('legend-uncovered');
  const chkToggleUncovered = document.getElementById('chk-toggle-uncovered');
  const chkToggleMarfeel = document.getElementById('chk-toggle-marfeel');
  const multiselectBanner = document.getElementById('multiselect-banner');
  const multiselectCount = document.getElementById('multiselect-count');
  const btnFindPattern = document.getElementById('btn-find-pattern');
  const btnCancelMultiselect = document.getElementById('btn-cancel-multiselect');
  const updateNotice = document.getElementById('update-notice');
  const updateVersion = document.getElementById('update-version');
  const updateFilename = document.getElementById('update-filename');
  const updateInstructions = document.getElementById('update-instructions');
  const btnDownloadUpdate = document.getElementById('btn-download-update');
  const btnDismissUpdate = document.getElementById('btn-dismiss-update');
  const btnDismissInstructions = document.getElementById('btn-dismiss-instructions');
  const btnCopyChromeUrl = document.getElementById('btn-copy-chrome-url');
  const updateOldVersion = document.getElementById('update-old-version');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
  }

  /**
   * Merge two CSS selectors with comma, avoiding duplicates.
   */
  function mergeSelectors(a, b) {
    if (!a) return b || '';
    if (!b) return a;
    if (a === b) return a;
    const parts = new Set(a.split(',').map(s => s.trim()));
    for (const p of b.split(',').map(s => s.trim())) parts.add(p);
    return [...parts].join(', ');
  }

  function showToast(text, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = text;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
      toast.classList.remove('toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  async function sendToTab(msg) {
    try {
      // Try currentWindow first, then lastFocusedWindow as fallback
      let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      }
      if (!tab) return null;
      return await chrome.tabs.sendMessage(tab.id, msg);
    } catch (err) {
      console.warn('[MRT] sendToTab failed:', err.message);
      // Content script not injected — try programmatic injection
      if (err.message.includes('Receiving end does not exist')) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (tab) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content/selector-engine.js', 'content/namer.js', 'content/layout-detector.js', 'content/picker.js'],
            });
            await chrome.scripting.insertCSS({
              target: { tabId: tab.id },
              files: ['content/picker.css'],
            });
            // Retry after injection
            return await chrome.tabs.sendMessage(tab.id, msg);
          }
        } catch (retryErr) {
          console.warn('[MRT] Retry injection failed:', retryErr.message);
          showToast('Could not connect to page. Try refreshing.', 'error');
        }
      }
      return null;
    }
  }

  // Store last raw coverage data for recalculation when toggles change
  let lastCoverageData = null;

  function updateCoverage(data) {
    if (!data || !data.totalLinks) {
      coverageEl.style.display = 'none';
      return;
    }
    coverageEl.style.display = '';
    lastCoverageData = data;
    renderCoverageRing(data);
  }

  function renderCoverageRing(data) {
    const { totalLinks, taggedCovered, marfeelCovered, uncoveredLinks, skippedLinks } = data;
    if (!totalLinks) return;

    // Only count segments that are toggled on
    const includeMarfeel = chkToggleMarfeel.checked;

    const taggedPct = Math.round((taggedCovered / totalLinks) * 100);
    const marfeelPct = includeMarfeel ? Math.round((marfeelCovered / totalLinks) * 100) : 0;
    const totalPct = Math.min(taggedPct + marfeelPct, 100);
    const effectiveUncovered = includeMarfeel
      ? uncoveredLinks
      : (totalLinks - taggedCovered - (skippedLinks || 0));

    // SVG ring segments — circumference ≈ 100 by design (r=15.9)
    // Marfeel segment starts at 0, tagged starts after marfeel
    coverageRingMarfeel.setAttribute('stroke-dasharray', `${marfeelPct} ${100 - marfeelPct}`);
    coverageRingMarfeel.setAttribute('stroke-dashoffset', '0');

    coverageRingTagged.setAttribute('stroke-dasharray', `${taggedPct} ${100 - taggedPct}`);
    coverageRingTagged.setAttribute('stroke-dashoffset', `${-marfeelPct}`);

    coveragePct.textContent = `${totalPct}%`;
    coverageCount.textContent = `${taggedCovered + (includeMarfeel ? marfeelCovered : 0)}/${totalLinks}`;

    // Legend
    legendTagged.textContent = taggedCovered;
    legendMarfeel.textContent = includeMarfeel ? marfeelCovered : '—';
    legendUncovered.textContent = effectiveUncovered;
  }

  async function requestCoverage() {
    const selectors = modules.map(m => m.selector);
    const resp = await sendToTab({ type: 'MRT_GET_COVERAGE', selectors });
    if (resp) updateCoverage(resp);
    // Refresh uncovered highlights if toggle is active
    if (showingUncovered) {
      sendToTab({ type: 'MRT_SHOW_UNCOVERED', selectors });
    }
  }

  function updateSiteLogo(domain) {
    if (domain) {
      // Google's favicon service — reliable, fast, supports any domain
      siteLogo.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
      siteLogo.alt = domain;
    } else {
      siteLogo.src = '../icons/icon48.png';
      siteLogo.alt = 'Logo';
    }
  }

  async function getDomain() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return '';
    try {
      const url = new URL(tab.url);
      return url.hostname.replace(/^www\./, '');
    } catch { return ''; }
  }

  const PAGE_TYPE_LABELS = {
    Home: 'Home',
    Article: 'Article',
    Section: 'Section / Tag',
    Page: 'Undefined',
  };

  async function updatePageType() {
    const resp = await sendToTab({ type: 'MRT_GET_PAGE_TYPE' });
    const type = resp?.pageType || 'Page';
    currentPageType = type;
    pageTypeEl.textContent = PAGE_TYPE_LABELS[type] || type;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  function storageKey() {
    return `mrt_v2_${currentDomain}`;
  }

  async function saveModules() {
    if (!currentDomain) return;
    const data = modules.map(m => ({
      id: m.id, selector: m.selector, name: m.name,
      category: m.category, matchCount: m.matchCount,
      layout: m.layout || null, collapsed: m.collapsed || false,
    }));
    await chrome.storage.local.set({ [storageKey()]: data });
  }

  async function loadModules() {
    if (!currentDomain) return;
    const result = await chrome.storage.local.get(storageKey());
    const saved = result[storageKey()];
    if (saved && saved.length) {
      modules = saved;
      nextId = Math.max(...modules.map(m => m.id)) + 1;
      renderModules();
      // Restore overlays on the page
      sendToTab({ type: 'MRT_RESTORE_MODULES', modules });
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function renderModules() {
    modulesEl.innerHTML = '';

    if (modules.length === 0) {
      emptyState.style.display = '';
      footerEl.classList.remove('footer--visible');
      moduleCount.textContent = '0';
      btnSend.disabled = true;
      requestCoverage();
      return;
    }

    emptyState.style.display = 'none';
    footerEl.classList.add('footer--visible');
    moduleCount.textContent = modules.length;
    btnSend.disabled = false;

    for (const mod of modules) {
      modulesEl.appendChild(createCard(mod));
    }

    requestCoverage();
  }

  function buildLayoutHtml(layout, moduleName) {
    if (!layout) return '';

    const fields = [
      { key: 'element', label: 'Element', critical: true },
      { key: 'anchor',  label: 'Anchor',  critical: true },
      { key: 'title',   label: 'Title',   critical: false },
      { key: 'image',   label: 'Image',   critical: false },
    ];

    // Determine example count for unified navigator
    const exampleCount = layout.element?.count || 0;

    let html = `<div class="card__layout">
      <div class="card__layout-header">
        <span class="card__layout-title">Layout</span>
      </div>`;

    for (const f of fields) {
      const data = layout[f.key];
      const hasSelector = data?.selector;
      const hasError = data?.error;
      const warningClass = hasError
        ? (f.critical ? 'layout-field__warning--critical' : 'layout-field__warning--amber')
        : '';

      if (hasSelector) {
        let previewHtml = '';
        const examples = data.examples || (data.example ? [data.example] : []);

        if (f.key === 'element') {
          previewHtml = '';
        } else if (f.key === 'image' && examples.length) {
          previewHtml = `<div class="layout-field__preview layout-field__preview--image" data-field="${f.key}">
            <img class="layout-field__thumb" src="${escapeHtml(examples[0])}" alt="" onerror="this.style.display='none'">
            <span class="layout-field__preview-text">${escapeHtml(examples[0].split('/').pop() || '')}</span>
          </div>`;
        } else if (f.key === 'anchor' && examples.length) {
          previewHtml = `<div class="layout-field__preview layout-field__preview--anchor" data-field="${f.key}">
            <svg class="layout-field__link-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
              <path d="M6.5 9.5l3-3M7 11.5l-1.8 1.8a2 2 0 01-2.8 0l-.7-.7a2 2 0 010-2.8L3.5 8M9 4.5l1.8-1.8a2 2 0 012.8 0l.7.7a2 2 0 010 2.8L12.5 8"/>
            </svg>
            <a class="layout-field__link" href="${escapeHtml(examples[0])}" target="_blank" rel="noopener" title="${escapeHtml(examples[0])}">${escapeHtml(examples[0])}</a>
          </div>`;
        } else if (f.key === 'title' && examples.length) {
          previewHtml = `<div class="layout-field__preview layout-field__preview--title" data-field="${f.key}">
            <span class="layout-field__title-text">${escapeHtml(examples[0])}</span>
          </div>`;
        }

        html += `
          <div class="layout-field">
            <div class="layout-field__header">
              <span class="layout-field__label">${f.label}</span>
              <input class="layout-field__selector" type="text"
                     value="${escapeHtml(data.selector)}" spellcheck="false"
                     data-field="${f.key}" data-original="${escapeHtml(data.selector)}" title="CSS selector (editable)">
              <button class="layout-field__confirm" data-field="${f.key}" title="Apply selector" style="display:none">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg>
              </button>
              ${f.key === 'element' && data.count ? `<span class="layout-field__count">&times;${data.count}</span>` : ''}
            </div>
            ${previewHtml}
          </div>`;
      } else {
        html += `
          <div class="layout-field">
            <div class="layout-field__header">
              <span class="layout-field__label">${f.label}</span>
              <input class="layout-field__selector" type="text" value=""
                     placeholder="Enter selector manually"
                     spellcheck="false" data-field="${f.key}" data-original="">
              <button class="layout-field__confirm" data-field="${f.key}" title="Apply selector" style="display:none">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg>
              </button>
            </div>
            <div class="layout-field__warning ${warningClass}">&#9888; ${hasError || 'Not detected'}</div>
          </div>`;
      }
    }

    // Navigator at the bottom, centered
    if (exampleCount > 1) {
      html += `<div class="layout-nav-wrap">
        <span class="layout-nav" data-example-count="${exampleCount}">
          <button class="layout-nav__btn" data-dir="-1" title="Previous example">&#9666;</button>
          <span class="layout-nav__pos">1/${exampleCount}</span>
          <button class="layout-nav__btn" data-dir="1" title="Next example">&#9656;</button>
        </span>
      </div>`;
    }

    html += '</div>';
    return html;
  }

  function createCard(mod) {
    const card = document.createElement('div');
    card.className = `card${mod.collapsed ? ' card--collapsed' : ''}`;
    card.dataset.id = mod.id;
    card.style.borderLeftColor = mod.color || '#059669';
    card.style.borderLeftWidth = '3px';

    const matchClass = mod.matchCount === 0 ? ' card__match--zero' : '';
    const overlapHtml = mod.overlaps?.length
      ? `<div class="card__warning">&#9888; Overlaps with: ${mod.overlaps.map(o => {
          const other = modules.find(m => m.selector === o.selector);
          return `<strong>${escapeHtml(other?.name || o.selector)}</strong> (${o.overlapCount})`;
        }).join(', ')}</div>`
      : '';

    // Build alternatives HTML if available
    const altsHtml = mod.alternatives?.length
      ? `<div class="card__alternatives">
          <button class="card__btn card__btn--alts" title="Show alternative selectors">▾ Alternatives</button>
          <div class="card__alts-list" hidden>
            ${mod.alternatives.map(a => `
              <button class="card__alt" data-selector="${escapeHtml(a.selector)}" title="${escapeHtml(a.label)}">
                <code>${escapeHtml(a.selector)}</code>
                <span class="card__alt-count">${a.matchCount}</span>
              </button>
            `).join('')}
          </div>
        </div>`
      : '';

    // Build inline layout HTML (only for Home/Section pages)
    const hasLayout = mod.layout && (currentPageType === 'Home' || currentPageType === 'Section');
    let layoutHtml = '';
    if (hasLayout) {
      layoutHtml = buildLayoutHtml(mod.layout);
    }

    card.innerHTML = `
      <div class="card__header">
        <button class="card__collapse" title="${mod.collapsed ? 'Expand' : 'Collapse'}">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="${mod.collapsed ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'}"/>
          </svg>
        </button>
        <input class="card__name" type="text" value="${escapeHtml(mod.name)}"
               spellcheck="false" title="Module name (editable)">
        <button class="card__confirm-name" title="Confirm name" style="display:none">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M3 8.5l3.5 3.5 6.5-7"/>
          </svg>
        </button>
        <span class="card__match${matchClass}" title="Elements matching this selector">${mod.matchCount}</span>
        <button class="card__delete" title="Remove module">&times;</button>
      </div>
      <div class="card__body">
        <div class="card__selector-row">
          <input class="card__selector" type="text" value="${escapeHtml(mod.selector)}"
                 spellcheck="false" title="CSS selector (editable)">
          <button class="card__copy" title="Copy selector">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
              <rect x="5" y="5" width="9" height="9" rx="1.5"/>
              <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/>
            </svg>
          </button>
        </div>
        ${overlapHtml}
        ${altsHtml}
        ${layoutHtml}
      </div>
    `;

    // Event listeners
    const nameInput = card.querySelector('.card__name');
    const selectorInput = card.querySelector('.card__selector');
    const deleteBtn = card.querySelector('.card__delete');
    const copyBtn = card.querySelector('.card__copy');
    const collapseBtn = card.querySelector('.card__collapse');

    // Collapse toggle
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mod.collapsed = !mod.collapsed;
      card.classList.toggle('card--collapsed', mod.collapsed);
      collapseBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
        <path d="${mod.collapsed ? 'M6 4l4 4-4 4' : 'M4 6l4 4 4-4'}"/>
      </svg>`;
      collapseBtn.title = mod.collapsed ? 'Expand' : 'Collapse';
      saveModules();
    });

    // Edit name — confirm via Enter key or confirm button
    const confirmNameBtn = card.querySelector('.card__confirm-name');
    let originalName = mod.name;

    function confirmNameChange() {
      const newName = nameInput.value.trim() || 'Module';
      mod.name = newName;
      originalName = newName;
      saveModules();
      nameInput.blur();
      confirmNameBtn.style.display = 'none';
      showToast('Name updated', 'success');
    }

    nameInput.addEventListener('focus', () => {
      originalName = mod.name;
    });

    nameInput.addEventListener('input', () => {
      const dirty = nameInput.value.trim() !== originalName;
      confirmNameBtn.style.display = dirty ? 'flex' : 'none';
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmNameChange();
      }
      if (e.key === 'Escape') {
        nameInput.value = originalName;
        confirmNameBtn.style.display = 'none';
        nameInput.blur();
      }
    });

    nameInput.addEventListener('blur', () => {
      // If blurred without confirming, revert
      setTimeout(() => {
        if (nameInput.value.trim() !== originalName) {
          nameInput.value = originalName;
          confirmNameBtn.style.display = 'none';
        }
      }, 150); // Small delay to allow confirm button click to fire first
    });

    confirmNameBtn.addEventListener('click', () => {
      confirmNameChange();
    });

    // Edit selector — recount matches and check overlaps
    selectorInput.addEventListener('change', async () => {
      const newSelector = selectorInput.value.trim();
      if (!newSelector) return;

      const oldSelector = mod.selector;
      mod.selector = newSelector;

      const resp = await sendToTab({
        type: 'MRT_RECOUNT',
        selector: newSelector,
        oldSelector,
        name: mod.name,
      });
      mod.matchCount = resp?.matchCount ?? 0;
      mod.overlaps = resp?.overlaps || [];

      // Re-render this card to show updated overlaps
      renderModules();
      saveModules();
    });

    // Delete
    deleteBtn.addEventListener('click', () => {
      sendToTab({ type: 'MRT_REMOVE_MODULE', selector: mod.selector });
      modules = modules.filter(m => m.id !== mod.id);
      renderModules();
      saveModules();
    });

    // Inline copy button
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(mod.selector);
      copyBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="#059669" stroke-width="2" width="12" height="12"><path d="M3 8.5l3.5 3.5 6.5-7"/></svg>`;
      setTimeout(() => {
        copyBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/></svg>`;
      }, 1500);
    });

    // Layout field editing — apply on confirm button or Enter
    card.querySelectorAll('.layout-field__selector').forEach(input => {
      const field = input.dataset.field;
      const confirmBtn = card.querySelector(`.layout-field__confirm[data-field="${field}"]`);

      // Show/hide confirm button when input value changes
      input.addEventListener('input', () => {
        const changed = input.value.trim() !== (input.dataset.original || '');
        if (confirmBtn) confirmBtn.style.display = changed ? '' : 'none';
      });

      // Enter key triggers apply
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyLayoutField(input, field, confirmBtn);
        }
      });

      // Confirm button triggers apply
      if (confirmBtn) {
        confirmBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          applyLayoutField(input, field, confirmBtn);
        });
      }
    });

    async function applyLayoutField(input, field, confirmBtn) {
      const value = input.value.trim();
      if (!mod.layout) return;

      // Update the stored selector
      if (mod.layout[field]) {
        mod.layout[field].selector = value || null;
      } else {
        mod.layout[field] = { selector: value || null };
      }

      // Update original to track future changes
      input.dataset.original = value;
      if (confirmBtn) confirmBtn.style.display = 'none';

      if (!value) {
        // Clear preview and examples when selector is emptied
        if (mod.layout[field]) {
          mod.layout[field].examples = [];
          mod.layout[field].count = 0;
        }
        const layoutEl = card.querySelector('.card__layout');
        const fieldEl = [...layoutEl.querySelectorAll('.layout-field')]
          .find(f => f.querySelector(`[data-field="${field}"]`));
        if (fieldEl) {
          const preview = fieldEl.querySelector('.layout-field__preview');
          if (preview) preview.remove();
          const countEl = fieldEl.querySelector('.layout-field__count');
          if (countEl) countEl.remove();
          // Show warning
          const existing = fieldEl.querySelector('.layout-field__warning');
          if (!existing) {
            const warn = document.createElement('div');
            const critical = field === 'element' || field === 'anchor';
            warn.className = `layout-field__warning ${critical ? 'layout-field__warning--critical' : 'layout-field__warning--amber'}`;
            warn.innerHTML = '&#9888; Not detected';
            fieldEl.appendChild(warn);
          }
        }
        saveModules();
        return;
      }

      // Ask content script to preview this selector
      const result = await sendToTab({
        type: 'MRT_PREVIEW_LAYOUT_FIELD',
        moduleSelector: mod.selector,
        fieldSelector: value,
        field,
      });

      if (!result?.success) {
        input.style.borderColor = 'var(--error)';
        setTimeout(() => { input.style.borderColor = ''; }, 1500);
        return;
      }

      // Update examples in layout data
      mod.layout[field].examples = result.examples;
      if (field === 'element' && result.count !== undefined) {
        mod.layout[field].count = result.count;
      }
      saveModules();

      // Update preview in the DOM
      const layoutEl = card.querySelector('.card__layout');
      const fieldEl = [...layoutEl.querySelectorAll('.layout-field')]
        .find(f => f.querySelector(`[data-field="${field}"]`));
      if (!fieldEl) return;

      // Remove existing warning
      const warning = fieldEl.querySelector('.layout-field__warning');
      if (warning) warning.remove();

      // Update or create preview
      let preview = fieldEl.querySelector('.layout-field__preview');
      if (field === 'element') {
        const countEl = fieldEl.querySelector('.layout-field__count');
        if (countEl) {
          countEl.textContent = `×${result.count}`;
        } else if (result.count) {
          const header = fieldEl.querySelector('.layout-field__header');
          const badge = document.createElement('span');
          badge.className = 'layout-field__count';
          badge.textContent = `×${result.count}`;
          header.appendChild(badge);
        }
      } else if (field === 'image' && result.examples.length) {
        if (preview) {
          const img = preview.querySelector('.layout-field__thumb');
          const text = preview.querySelector('.layout-field__preview-text');
          if (img) { img.src = result.examples[0]; img.style.display = ''; }
          if (text) text.textContent = result.examples[0].split('/').pop() || '';
        } else {
          const div = document.createElement('div');
          div.className = 'layout-field__preview layout-field__preview--image';
          div.dataset.field = field;
          div.innerHTML = `<img class="layout-field__thumb" src="${escapeHtml(result.examples[0])}" alt="" onerror="this.style.display='none'">
            <span class="layout-field__preview-text">${escapeHtml(result.examples[0].split('/').pop() || '')}</span>`;
          fieldEl.appendChild(div);
        }
      } else if (field === 'anchor' && result.examples.length) {
        if (preview) {
          const link = preview.querySelector('.layout-field__link');
          if (link) { link.href = result.examples[0]; link.textContent = result.examples[0]; link.title = result.examples[0]; }
        } else {
          const div = document.createElement('div');
          div.className = 'layout-field__preview layout-field__preview--anchor';
          div.dataset.field = field;
          div.innerHTML = `<svg class="layout-field__link-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="12" height="12">
            <path d="M6.5 9.5l3-3M7 11.5l-1.8 1.8a2 2 0 01-2.8 0l-.7-.7a2 2 0 010-2.8L3.5 8M9 4.5l1.8-1.8a2 2 0 012.8 0l.7.7a2 2 0 010 2.8L12.5 8"/>
          </svg>
          <a class="layout-field__link" href="${escapeHtml(result.examples[0])}" target="_blank" rel="noopener" title="${escapeHtml(result.examples[0])}">${escapeHtml(result.examples[0])}</a>`;
          fieldEl.appendChild(div);
        }
      } else if (field === 'title' && result.examples.length) {
        if (preview) {
          const text = preview.querySelector('.layout-field__title-text');
          if (text) text.textContent = result.examples[0];
        } else {
          const div = document.createElement('div');
          div.className = 'layout-field__preview layout-field__preview--title';
          div.dataset.field = field;
          div.innerHTML = `<span class="layout-field__title-text">${escapeHtml(result.examples[0])}</span>`;
          fieldEl.appendChild(div);
        }
      }

      // Flash success
      input.style.borderColor = 'var(--success)';
      setTimeout(() => { input.style.borderColor = ''; }, 1000);
    }

    // Unified layout example navigator
    card.querySelectorAll('.layout-nav__btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nav = btn.closest('.layout-nav');
        const total = parseInt(nav.dataset.exampleCount);
        const dir = parseInt(btn.dataset.dir);
        const posEl = nav.querySelector('.layout-nav__pos');
        const current = parseInt(posEl.textContent.split('/')[0]) - 1;
        const next = (current + dir + total) % total;
        posEl.textContent = `${next + 1}/${total}`;

        // Update all previews at once
        const layoutEl = card.querySelector('.card__layout');
        for (const field of ['anchor', 'title', 'image']) {
          const examples = mod.layout?.[field]?.examples || [];
          if (next >= examples.length) continue;
          const preview = layoutEl.querySelector(`.layout-field__preview[data-field="${field}"]`);
          if (!preview) continue;

          if (field === 'image') {
            const img = preview.querySelector('.layout-field__thumb');
            const text = preview.querySelector('.layout-field__preview-text');
            if (img) { img.src = examples[next]; img.style.display = ''; }
            if (text) text.textContent = examples[next].split('/').pop() || '';
          } else if (field === 'anchor') {
            const link = preview.querySelector('.layout-field__link');
            if (link) { link.href = examples[next]; link.textContent = examples[next]; link.title = examples[next]; }
          } else if (field === 'title') {
            const text = preview.querySelector('.layout-field__title-text');
            if (text) text.textContent = examples[next];
          }
        }
      });
    });

    // Alternatives dropdown
    const altsToggle = card.querySelector('.card__btn--alts');
    const altsList = card.querySelector('.card__alts-list');
    if (altsToggle && altsList) {
      altsToggle.addEventListener('click', () => {
        const hidden = altsList.hidden;
        altsList.hidden = !hidden;
        altsToggle.textContent = hidden ? '▴ Alternatives' : '▾ Alternatives';
      });
      altsList.querySelectorAll('.card__alt').forEach(btn => {
        btn.addEventListener('click', async () => {
          const newSelector = btn.dataset.selector;
          if (!newSelector) return;
          const oldSelector = mod.selector;
          mod.selector = newSelector;
          selectorInput.value = newSelector;

          const resp = await sendToTab({
            type: 'MRT_RECOUNT',
            selector: newSelector,
            oldSelector,
            name: mod.name,
          });
          mod.matchCount = resp?.matchCount ?? 0;
          mod.overlaps = resp?.overlaps || [];

          // Re-detect layout with the new selector
          if (currentPageType === 'Home' || currentPageType === 'Section') {
            const layoutResult = await sendToTab({
              type: 'MRT_DETECT_LAYOUT',
              moduleSelector: newSelector,
            });
            mod.layout = layoutResult?.success ? layoutResult : null;
          }

          renderModules();
          saveModules();
        });
      });
    }

    // Highlight on hover
    card.addEventListener('mouseenter', () => {
      sendToTab({ type: 'MRT_HIGHLIGHT', selector: mod.selector });
    });

    return card;
  }

  // ---------------------------------------------------------------------------
  // Picking mode
  // ---------------------------------------------------------------------------

  function togglePicking() {
    if (isPicking) {
      stopPicking();
    } else {
      startPicking();
    }
  }

  function startPicking() {
    isPicking = true;
    btnPick.classList.add('btn--picking');
    pickLabel.textContent = 'Selecting...';
    statusEl.innerHTML = 'Click on a recirculation module. <strong>Shift+click</strong> multiple to find common pattern.<br><small><strong>⌥/Alt + scroll</strong> to expand/shrink. <strong>Esc</strong> to stop.</small>';
    sendToTab({ type: 'MRT_START_PICKING' });
  }

  function stopPicking() {
    isPicking = false;
    btnPick.classList.remove('btn--picking');
    pickLabel.textContent = 'Select Element';
    statusEl.innerHTML = 'Click <strong>Select Element</strong> then click on recirculation modules in the page.<br><small>Hold <strong>⌥/Alt</strong> + scroll to expand/shrink. <strong>Shift+click</strong> for multi-select.</small>';
    sendToTab({ type: 'MRT_STOP_PICKING' });
  }

  // ---------------------------------------------------------------------------
  // Reload — re-detect current page, clear overlays, load saved modules
  // ---------------------------------------------------------------------------

  async function reload() {
    // Clear current state on page
    sendToTab({ type: 'MRT_CLEAR_ALL' });
    stopPicking();

    // Reset toggles
    chkToggleUncovered.checked = false;
    chkToggleMarfeel.checked = false;
    showingUncovered = false;
    showingMarfeel = false;
    lastCoverageData = null;

    // Re-detect domain and reload saved modules for the new page
    modules = [];
    nextId = 1;
    currentDomain = await getDomain();
    domainEl.textContent = currentDomain || '—';
    updateSiteLogo(currentDomain);
    await updatePageType();
    await loadModules();
    requestCoverage();
    showToast(`Loaded: ${currentDomain || 'unknown'}`, 'info');
  }

  // ---------------------------------------------------------------------------
  // Send to Hub
  // ---------------------------------------------------------------------------

  async function sendToHub() {
    if (!modules.length) return;
    stopPicking();

    btnSend.disabled = true;
    btnSend.textContent = 'Sending...';

    const payload = modules.map(m => ({ selector: m.selector, name: m.name }));
    // Build layouts, merging those with the same Element selector
    const rawLayouts = modules
      .filter(m => m.layout)
      .map(m => ({
        element: m.layout.element?.selector || '',
        anchor: m.layout.anchor?.selector || '',
        title: m.layout.title?.selector || '',
        image: m.layout.image?.selector || '',
      }))
      .filter(l => l.element && l.anchor);

    // Merge layouts by element: concatenate anchor/title/image with comma
    const mergedMap = new Map();
    for (const l of rawLayouts) {
      if (mergedMap.has(l.element)) {
        const existing = mergedMap.get(l.element);
        existing.anchor = mergeSelectors(existing.anchor, l.anchor);
        existing.title = mergeSelectors(existing.title, l.title);
        existing.image = mergeSelectors(existing.image, l.image);
      } else {
        mergedMap.set(l.element, { ...l });
      }
    }
    const layoutPayload = [...mergedMap.values()];

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'MRT_SEND_TO_HUB',
        modules: payload,
        layouts: layoutPayload,
      });

      if (response?.success) {
        showToast(`${response.filled || modules.length} module(s) sent to Hub!`, 'success');
      } else {
        showToast(response?.error || 'Failed to send to Hub.', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }

    btnSend.disabled = false;
    btnSend.innerHTML = `Send to Hub
      <svg class="btn__icon btn__icon--right" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 8h10M9 4l4 4-4 4"/>
      </svg>`;
  }

  // ---------------------------------------------------------------------------
  // Message listener (from content script)
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MRT_ELEMENT_SELECTED') {
      // Collapse all existing modules before adding new one
      for (const m of modules) {
        m.collapsed = true;
      }

      const mod = {
        id: nextId++,
        selector: msg.selector,
        name: msg.name,
        category: msg.category,
        matchCount: msg.matchCount,
        overlaps: msg.overlaps || [],
        alternatives: msg.alternatives || [],
        color: msg.color || '#059669',
        collapsed: false,
      };
      modules.push(mod);

      // Show overlap warning if detected
      if (mod.overlaps.length) {
        const names = mod.overlaps.map(o => {
          const other = modules.find(m => m.selector === o.selector);
          return other?.name || o.selector;
        });
        showToast(`Warning: overlaps with ${names.join(', ')}`, 'error');
      }

      // Case 5: partial selection — inform user about total available
      if (msg.totalAvailable && msg.totalAvailable > msg.matchCount) {
        showToast(`Selector matches ${msg.totalAvailable} elements total (you selected ${msg.matchCount})`, 'info');
      }

      // Case 7: comma-joined selectors
      if (msg.detectedCase === 7) {
        showToast('No common pattern found — selectors combined with ","', 'info');
      }

      renderModules();
      saveModules();

      // Auto-detect layout on Home/Section pages
      if (currentPageType === 'Home' || currentPageType === 'Section') {
        sendToTab({ type: 'MRT_DETECT_LAYOUT', moduleSelector: mod.selector })
          .then(result => {
            if (result && result.success) {
              mod.layout = {
                element: result.element,
                anchor: result.anchor,
                title: result.title,
                image: result.image,
              };
              renderModules();
              saveModules();
            }
          });
      }

      // Scroll to the new card
      const lastCard = modulesEl.lastElementChild;
      if (lastCard) lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      sendResponse({ ok: true });
    }

    if (msg.type === 'MRT_PICKING_STOPPED') {
      stopPicking();
      sendResponse({ ok: true });
    }

    if (msg.type === 'MRT_SELECTION_FAILED') {
      showToast(msg.reason || 'Could not select this element', 'error');
      sendResponse({ ok: true });
    }

    if (msg.type === 'MRT_MULTISELECT_PROGRESS') {
      multiselectBanner.style.display = '';
      multiselectCount.textContent = msg.count;
      statusEl.innerHTML = `<strong>Multi-select:</strong> <strong>Shift+click</strong> more elements, then press <strong>Enter</strong> or click <strong>Find Common Pattern</strong>. <strong>Esc</strong> to cancel.`;
      sendResponse({ ok: true });
    }

    if (msg.type === 'MRT_MULTISELECT_CANCELLED') {
      multiselectBanner.style.display = 'none';
      statusEl.innerHTML = 'Click on a recirculation module. <strong>Shift+click</strong> multiple to find common pattern.<br><small><strong>⌥/Alt + scroll</strong> to expand/shrink. <strong>Esc</strong> to stop.</small>';
      sendResponse({ ok: true });
    }

    if (msg.type === 'MRT_MULTISELECT_DONE') {
      multiselectBanner.style.display = 'none';
      sendResponse({ ok: true });
    }

    if (msg.type === 'MRT_COVERAGE_UPDATE') {
      updateCoverage(msg);
      sendResponse({ ok: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  btnPick.addEventListener('click', togglePicking);
  btnReload.addEventListener('click', reload);
  btnSend.addEventListener('click', sendToHub);

  // Stop picking when user interacts with panel elements (not the pick button itself)
  document.addEventListener('click', (e) => {
    if (!isPicking) return;
    // Don't stop picking when clicking the pick button itself or multiselect buttons
    if (e.target.closest('#btn-pick') || e.target.closest('#btn-find-pattern') ||
        e.target.closest('#btn-cancel-multiselect')) return;
    // Stop picking when clicking on other interactive elements
    if (e.target.closest('.card, .btn, input, button')) {
      stopPicking();
    }
  }, true);

  // Clear all — double-click confirm
  let clearConfirmTimer = null;
  btnClear.addEventListener('click', () => {
    if (btnClear.classList.contains('btn--clear--confirm')) {
      // Second click — confirmed, clear everything
      clearTimeout(clearConfirmTimer);
      btnClear.classList.remove('btn--clear--confirm');
      btnClear.title = 'Clear all modules';
      modules = [];
      renderModules();
      saveModules();
      sendToTab({ type: 'MRT_CLEAR_ALL' });
      stopPicking();
      showToast('All modules cleared', 'info');
    } else {
      // First click — enter confirm state
      stopPicking();
      btnClear.classList.add('btn--clear--confirm');
      btnClear.title = 'Click again to confirm';
      clearConfirmTimer = setTimeout(() => {
        btnClear.classList.remove('btn--clear--confirm');
        btnClear.title = 'Clear all modules';
      }, 3000);
    }
  });

  // Escape key — stop picking or cancel multi-select from panel
  // (keydown in the side panel doesn't fire on the page's document)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPicking) {
      e.preventDefault();
      sendToTab({ type: 'MRT_CANCEL_MULTISELECT' });
      multiselectBanner.style.display = 'none';
      stopPicking();
    }
  });

  btnFindPattern.addEventListener('click', () => {
    sendToTab({ type: 'MRT_FINISH_MULTISELECT' });
  });
  btnCancelMultiselect.addEventListener('click', () => {
    sendToTab({ type: 'MRT_CANCEL_MULTISELECT' });
    multiselectBanner.style.display = 'none';
  });

  chkToggleUncovered.addEventListener('change', async () => {
    showingUncovered = chkToggleUncovered.checked;
    if (showingUncovered) {
      const selectors = modules.map(m => m.selector);
      const result = await sendToTab({ type: 'MRT_SHOW_UNCOVERED', selectors });
      if (result && result.uncoveredCount > 0) {
        showToast(`${result.uncoveredCount} uncovered link(s) — use ▲▼ to navigate`, 'info');
      } else if (result && result.uncoveredCount === 0) {
        showToast('No uncovered links found!', 'success');
      }
    } else {
      sendToTab({ type: 'MRT_HIDE_UNCOVERED' });
    }
  });

  chkToggleMarfeel.addEventListener('change', async () => {
    showingMarfeel = chkToggleMarfeel.checked;
    if (showingMarfeel) {
      const result = await sendToTab({ type: 'MRT_SHOW_MARFEEL' });
      if (result) {
        const parts = [];
        if (result.tagged) parts.push(`${result.tagged} module(s)`);
        if (result.skipped) parts.push(`${result.skipped} skipped`);
        showToast(`Marfeel: ${parts.join(', ') || 'none found'}`, 'info');
      }
    } else {
      sendToTab({ type: 'MRT_HIDE_MARFEEL' });
    }
    // Recalculate ring to include/exclude Marfeel coverage
    if (lastCoverageData) renderCoverageRing(lastCoverageData);
  });

  // ---------------------------------------------------------------------------
  // Auto-update
  // ---------------------------------------------------------------------------

  let pendingUpdate = null;

  async function checkForUpdate() {
    const result = await chrome.runtime.sendMessage({ type: 'MRT_CHECK_UPDATE' });
    if (result) {
      pendingUpdate = result;
      updateVersion.textContent = result.remoteVersion;
      updateFilename.textContent = `recirculation-tagger-v${result.remoteVersion}.zip`;
      updateNotice.style.display = '';
    }
  }

  btnDownloadUpdate.addEventListener('click', async () => {
    if (!pendingUpdate) return;
    btnDownloadUpdate.disabled = true;
    btnDownloadUpdate.textContent = 'Downloading...';
    const result = await chrome.runtime.sendMessage({
      type: 'MRT_DOWNLOAD_UPDATE',
      remoteVersion: pendingUpdate.remoteVersion,
    });
    if (result?.success) {
      // Hide alert, show instructions
      updateNotice.style.display = 'none';
      updateOldVersion.textContent = pendingUpdate.localVersion;
      updateInstructions.style.display = '';
    } else {
      btnDownloadUpdate.disabled = false;
      btnDownloadUpdate.textContent = 'Download update';
      showToast('Download failed: ' + (result?.error || 'unknown error'), 'error');
    }
  });

  btnDismissUpdate.addEventListener('click', () => {
    updateNotice.style.display = 'none';
  });

  btnDismissInstructions.addEventListener('click', () => {
    updateInstructions.style.display = 'none';
  });

  btnCopyChromeUrl.addEventListener('click', () => {
    navigator.clipboard.writeText('chrome://extensions');
    btnCopyChromeUrl.textContent = 'copied!';
    setTimeout(() => { btnCopyChromeUrl.textContent = 'copy'; }, 2000);
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async function init() {
    // Connect to background — port disconnect signals panel close for cleanup
    chrome.runtime.connect({ name: 'mrt-panel' });

    currentDomain = await getDomain();
    domainEl.textContent = currentDomain || '—';
    updateSiteLogo(currentDomain);
    await updatePageType();
    await loadModules();
    // Always show coverage, even with 0 modules
    requestCoverage();
    // Check for updates
    checkForUpdate();
  }

  init();
})();
