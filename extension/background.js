/**
 * Marfeel Recirculation Tagger v2 — Background Service Worker
 * Handles side panel, Hub tab management, and message routing.
 */

// Open side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ---------------------------------------------------------------------------
// Hub tab management
// ---------------------------------------------------------------------------

const HUB_ORIGIN = 'https://hub.marfeel.com';
const RECIRCULATION_TEMPLATE = '64539153c8ce696fad64f972';

/**
 * Find an existing Hub tab with a Recirculation experience form open
 * (either editing an existing experience or creating a new one).
 * If already on a recirculation form → reuse it (append new selectors).
 * Otherwise → open a new experience form.
 */
async function getOrCreateHubTab() {
  const tabs = await chrome.tabs.query({ url: `${HUB_ORIGIN}/*` });

  // 1. Look for a tab already on the recirculation form (existing OR new experience)
  for (const tab of tabs) {
    if (!tab.url) continue;
    const isRecircForm = (
      // Editing an existing experience
      (tab.url.includes('/experiences/') && tab.url.includes('compass/format')) ||
      // Creating a new experience with the recirculation template
      (tab.url.includes(RECIRCULATION_TEMPLATE))
    );
    if (isRecircForm) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { tab, isExisting: true };
    }
  }

  // 2. If we found any Hub tab, focus it and navigate to a new form
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, {
      active: true,
      url: `${HUB_ORIGIN}/experiences/new/compass/format?template=${RECIRCULATION_TEMPLATE}`,
    });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { tab, isExisting: false };
  }

  // 3. No Hub tab — open a new one
  const tab = await chrome.tabs.create({
    url: `${HUB_ORIGIN}/experiences/new/compass/format?template=${RECIRCULATION_TEMPLATE}`,
  });
  return { tab, isExisting: false };
}

/**
 * Wait for a tab to finish loading.
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // Check if already loaded
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Panel lifecycle — clean up overlays when the side panel closes
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'mrt-panel') return;

  port.onDisconnect.addListener(async () => {
    // Panel closed — tell the active tab to hide all overlays
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { type: 'MRT_PANEL_CLOSED' }).catch(() => {});
      }
    } catch { /* tab may not exist */ }
  });
});

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MRT_SEND_TO_HUB') {
    handleSendToHub(msg.modules)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

async function handleSendToHub(modules) {
  if (!modules || !modules.length) {
    return { success: false, error: 'No modules to send.' };
  }

  const { tab, isExisting } = await getOrCreateHubTab();

  // Wait for the page to load (only needed if navigating to a new URL)
  if (!isExisting) {
    await waitForTabLoad(tab.id);
    // Give the React app a moment to render
    await new Promise(r => setTimeout(r, 2000));
  } else {
    // Existing form — shorter wait for content script
    await new Promise(r => setTimeout(r, 500));
  }

  // Send autofill message — autofill.js already handles finding empty pairs
  // or clicking "Add" to create new rows, so it works for both new and existing forms.
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, {
      type: 'MRT_AUTOFILL',
      modules,
    }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: 'Could not reach Hub page. Make sure you are logged in to hub.marfeel.com.',
        });
      } else {
        resolve(response || { success: true });
      }
    });
  });
}
