/**
 * Marfeel Recirculation Tagger v2 — Side Panel Controller
 * Selection-driven state with editable cards and Hub autofill.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let modules = [];     // Array of { id, selector, name, category, matchCount }
  let isPicking = false;
  let currentDomain = '';
  let nextId = 1;
  let showingUncovered = false;
  let showingMarfeel = false;

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
              files: ['content/selector-engine.js', 'content/namer.js', 'content/picker.js'],
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

  function createCard(mod) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = mod.id;
    card.style.borderLeftColor = mod.color || '#22c55e';
    card.style.borderLeftWidth = '3px';

    const matchClass = mod.matchCount === 0 ? ' card__match--zero' : '';
    const overlapHtml = mod.overlaps?.length
      ? `<div class="card__warning">⚠ Overlaps with: ${mod.overlaps.map(o => {
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

    card.innerHTML = `
      <div class="card__header">
        <input class="card__name" type="text" value="${escapeHtml(mod.name)}"
               spellcheck="false" title="Module name (editable)">
        <button class="card__confirm-name" title="Confirm name" style="display:none">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M3 8.5l3.5 3.5 6.5-7"/>
          </svg>
        </button>
        <button class="card__delete" title="Remove module">&times;</button>
      </div>
      <div class="card__selector-row">
        <input class="card__selector" type="text" value="${escapeHtml(mod.selector)}"
               spellcheck="false" title="CSS selector (editable)">
        <span class="card__match${matchClass}" title="Elements matching this selector"
              style="${mod.matchCount > 0 ? `background:${mod.color}18;color:${mod.color}` : ''}">${mod.matchCount}</span>
      </div>
      ${overlapHtml}
      ${altsHtml}
      <div class="card__actions">
        <button class="card__btn card__btn--locate" title="Scroll to element on page">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
            <circle cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.5"/>
            <line x1="8" y1="1" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="15"/>
            <line x1="1" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="15" y2="8"/>
          </svg>
          Locate
        </button>
        <button class="card__btn card__btn--copy" title="Copy selector to clipboard">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="14" height="14">
            <rect x="5" y="5" width="9" height="9" rx="1.5"/>
            <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/>
          </svg>
          Copy
        </button>
      </div>
    `;

    // Event listeners
    const nameInput = card.querySelector('.card__name');
    const selectorInput = card.querySelector('.card__selector');
    const deleteBtn = card.querySelector('.card__delete');
    const locateBtn = card.querySelector('.card__btn--locate');
    const copyBtn = card.querySelector('.card__btn--copy');
    const matchBadge = card.querySelector('.card__match');

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

    // Locate on page
    locateBtn.addEventListener('click', () => {
      sendToTab({ type: 'MRT_HIGHLIGHT', selector: mod.selector });
    });

    // Copy selector
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(mod.selector);
      showToast('Selector copied!');
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
    updatePageType();
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

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'MRT_SEND_TO_HUB',
        modules: payload,
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
      const mod = {
        id: nextId++,
        selector: msg.selector,
        name: msg.name,
        category: msg.category,
        matchCount: msg.matchCount,
        overlaps: msg.overlaps || [],
        alternatives: msg.alternatives || [],
        color: msg.color || '#22c55e',
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
    updatePageType();
    await loadModules();
    // Always show coverage, even with 0 modules
    requestCoverage();
    // Check for updates
    checkForUpdate();
  }

  init();
})();
