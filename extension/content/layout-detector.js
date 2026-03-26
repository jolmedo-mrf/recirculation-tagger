/**
 * Marfeel Recirculation Tagger v2 — Layout Detector
 * Analyzes the internal structure of a recirculation module to detect
 * element (repeated items), anchor, title, and image selectors.
 */

window.MRTLayoutDetector = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a simple relative CSS selector for an element within a context.
   * Prefers semantic classes, falls back to tag name.
   */
  function relativeSelector(el) {
    if (!el) return null;
    const tag = el.tagName.toLowerCase();

    // Prefer a semantic class
    const classes = [...(el.classList || [])];
    const semantic = classes.filter(c => !isLayoutUtility(c));
    if (semantic.length) return `${tag}.${semantic[0]}`;

    // Fall back to just the tag
    return tag;
  }

  const LAYOUT_UTILITY_PREFIXES = [
    'col-', 'row-', 'flex-', 'grid-', 'p-', 'px-', 'py-', 'pt-', 'pb-',
    'm-', 'mx-', 'my-', 'mt-', 'mb-', 'w-', 'h-', 'd-', 'bg-',
    'text-', 'font-', 'border-', 'rounded-', 'shadow-', 'opacity-',
    'hidden', 'visible', 'block', 'inline', 'relative', 'absolute',
    'overflow-', 'z-', 'cursor-', 'transition-',
  ];

  const LAYOUT_UTILITY_EXACT = new Set([
    'container', 'wrapper', 'inner', 'outer', 'clearfix', 'cf',
    'active', 'disabled', 'show', 'hide', 'open', 'closed',
  ]);

  function isLayoutUtility(cls) {
    const lower = cls.toLowerCase();
    if (LAYOUT_UTILITY_EXACT.has(lower)) return true;
    return LAYOUT_UTILITY_PREFIXES.some(p => lower.startsWith(p));
  }

  // ---------------------------------------------------------------------------
  // Detection logic
  // ---------------------------------------------------------------------------

  /**
   * Detect the layout structure inside a module.
   * @param {string} moduleSelector - CSS selector of the module container
   * @returns {object} Layout detection result
   */
  function detectLayout(moduleSelector) {
    const module = document.querySelector(moduleSelector);
    if (!module) {
      return { success: false, error: 'Module not found on page' };
    }

    // Step 1: Find the repeated element (the "card" / "item" pattern)
    const element = detectRepeatedElement(module);
    let singleElement = null;

    let allItems;
    if (element) {
      const items = [...module.querySelectorAll(`:scope > ${element.selector}`)];
      allItems = items.length > 0 ? items : [...module.querySelectorAll(element.selector)];
      if (allItems.length === 0) {
        return { success: false, error: 'Element selector matched nothing' };
      }
    } else {
      // No repetition — try to find a single child element
      singleElement = detectSingleElement(module);
      if (singleElement) {
        allItems = [singleElement.el];
      } else {
        // The module itself is the element (e.g. <article> selected directly)
        const moduleSel = relativeSelector(module);
        singleElement = moduleSel
          ? { selector: moduleSel, el: module }
          : null;
        allItems = [module];
      }
    }

    // Step 2: Detect anchor, title, image using the first element for selector detection
    const firstItem = allItems[0];
    const anchorResult = detectAnchor(firstItem);
    const titleResult = detectTitle(firstItem);
    const imageResult = detectImage(firstItem);

    // Step 3: Collect examples from ALL elements for navigation
    const anchorExamples = [];
    const titleExamples = [];
    const imageExamples = [];

    for (const item of allItems) {
      const a = anchorResult ? detectAnchor(item) : null;
      const t = titleResult ? detectTitle(item) : null;
      const i = imageResult ? detectImage(item) : null;
      if (a) anchorExamples.push(a.example);
      if (t) titleExamples.push(t.example);
      if (i) imageExamples.push(i.example);
    }

    // Resolve full URLs for anchors
    const baseUrl = window.location.origin;

    // Build element result
    let elementResult;
    if (element) {
      elementResult = { selector: element.selector, count: element.count };
    } else if (singleElement) {
      elementResult = { selector: singleElement.selector, count: 1 };
    } else {
      elementResult = { selector: null, count: 1, error: 'Could not detect element' };
    }

    return {
      success: true,
      element: elementResult,
      anchor: anchorResult
        ? { selector: anchorResult.selector, examples: anchorExamples.map(href => {
            try { return new URL(href, baseUrl).href; } catch { return href; }
          }) }
        : { selector: null, error: 'Could not detect anchor (link)' },
      title: titleResult
        ? { selector: titleResult.selector, examples: titleExamples }
        : { selector: null, error: 'Could not detect title' },
      image: imageResult
        ? { selector: imageResult.selector, examples: imageExamples }
        : { selector: null, error: 'Could not detect image' },
    };
  }

  /**
   * Find the repeated child pattern inside a module.
   * Looks for direct children that repeat (same tag + similar class).
   */
  function detectRepeatedElement(module) {
    // Count direct children by their tag + first semantic class
    const children = [...module.children].filter(
      el => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' &&
            el.offsetHeight > 0 // visible
    );

    if (children.length === 0) return null;

    // Group by signature (tag + semantic class)
    const groups = new Map();
    for (const child of children) {
      const sig = relativeSelector(child) || child.tagName.toLowerCase();
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(child);
    }

    // Find the group with most repetitions (min 2)
    let bestSig = null;
    let bestCount = 1;
    for (const [sig, els] of groups) {
      if (els.length > bestCount) {
        bestCount = els.length;
        bestSig = sig;
      }
    }

    if (bestSig && bestCount >= 2) {
      return { selector: bestSig, count: bestCount };
    }

    // Fallback: look one level deeper (module > wrapper > items)
    for (const child of children) {
      const inner = detectRepeatedElement(child);
      if (inner && inner.count >= 2) {
        // Prefix with the wrapper's selector
        const wrapperSel = relativeSelector(child);
        if (wrapperSel) {
          return {
            selector: `${wrapperSel} > ${inner.selector}`,
            count: inner.count,
          };
        }
        return inner;
      }
    }

    // Last resort: if all children are the same tag, use that
    const tags = children.map(c => c.tagName);
    if (tags.length >= 2 && tags.every(t => t === tags[0])) {
      return {
        selector: tags[0].toLowerCase(),
        count: tags.length,
      };
    }

    return null;
  }

  /**
   * Find the best single child element when there's no repetition.
   * Looks for semantic container elements (article, section, div with class).
   */
  function detectSingleElement(module) {
    const children = [...module.children].filter(
      el => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE' &&
            el.offsetHeight > 0
    );
    if (children.length === 0) return null;

    // Prefer <article>, then elements with semantic classes
    const priority = ['ARTICLE', 'SECTION', 'LI', 'DIV'];
    for (const tag of priority) {
      const match = children.find(c => c.tagName === tag);
      if (match) {
        const sel = relativeSelector(match);
        if (sel) return { selector: sel, el: match };
      }
    }

    // Fallback: first visible child with a class
    for (const child of children) {
      const sel = relativeSelector(child);
      if (sel && sel !== child.tagName.toLowerCase()) {
        return { selector: sel, el: child };
      }
    }

    // Last resort: first child by tag
    if (children.length > 0) {
      const sel = relativeSelector(children[0]) || children[0].tagName.toLowerCase();
      return { selector: sel, el: children[0] };
    }

    return null;
  }

  /**
   * Detect the primary anchor (link) inside an element.
   * Prefers wrapper links (containing images/large areas) and article-path URLs
   * over short category/tag links.
   */
  function detectAnchor(element) {
    // Check if the element itself is an <a> (e.g. <a> wrapping an <article>)
    if (element.tagName === 'A' && element.href) {
      const href = element.getAttribute('href') || '';
      if (href !== '#' && !href.startsWith('javascript:')) {
        const sel = relativeSelector(element) || 'a';
        return { selector: sel, example: href };
      }
    }

    // Check if the parent is an <a> (e.g. <a> > <article> where we selected the <article>)
    const parent = element.parentElement;
    if (parent && parent.tagName === 'A' && parent.href) {
      const href = parent.getAttribute('href') || '';
      if (href !== '#' && !href.startsWith('javascript:')) {
        const sel = relativeSelector(parent) || 'a';
        return { selector: sel, example: href };
      }
    }

    const anchors = [...element.querySelectorAll('a[href]')];
    const candidates = [];
    // Collect all unique hrefs to detect duplicates (same article link used in image + title)
    const hrefCounts = new Map();
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (href === '#' || href.startsWith('javascript:')) continue;
      hrefCounts.set(href, (hrefCounts.get(href) || 0) + 1);
    }

    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (href === '#' || href.startsWith('javascript:')) continue;

      const sel = relativeSelector(a) || 'a';
      const pathSegments = href.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean).length;

      let score = pathSegments * 10; // deeper paths = more likely article URLs

      // Strong bonus: wraps an image (this is THE article link)
      if (a.querySelector('img, picture')) score += 100;
      // Bonus: href appears multiple times (image link + title link = same article)
      if ((hrefCounts.get(href) || 0) > 1) score += 50;
      // Bonus: has a semantic class (more specific selector)
      if (a.classList.length > 0) score += 20;
      // Penalize very short href paths (likely category/section)
      if (pathSegments <= 1) score -= 40;

      candidates.push({ a, href, sel, score });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return { selector: best.sel, example: best.href };
  }

  /**
   * Detect the title element inside an element.
   * Checks headings first, then elements with title/headline in class name.
   */
  function detectTitle(element) {
    // Priority 1: heading tags
    const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of headings) {
      const text = h.textContent?.trim();
      if (text && text.length > 3) {
        const sel = relativeSelector(h) || h.tagName.toLowerCase();
        return { selector: sel, example: text };
      }
    }

    // Priority 2: elements with title/headline in class
    const titleKeywords = ['title', 'headline', 'heading', 'titular', 'titulo'];
    const allEls = element.querySelectorAll('*');
    for (const el of allEls) {
      const classes = (el.className || '').toLowerCase();
      if (titleKeywords.some(kw => classes.includes(kw))) {
        const text = el.textContent?.trim();
        if (text && text.length > 3) {
          const sel = relativeSelector(el);
          if (sel) {
            return { selector: sel, example: text };
          }
        }
      }
    }

    // Priority 3: first link with substantial text (often the title IS the link)
    const links = element.querySelectorAll('a[href]');
    for (const a of links) {
      const text = a.textContent?.trim();
      if (text && text.length > 15) {
        const sel = relativeSelector(a) || 'a';
        return { selector: sel, example: text };
      }
    }

    return null;
  }

  /**
   * Detect the image element inside an element.
   * Skips tiny images (tracking pixels, icons) and prefers content images.
   */
  function detectImage(element) {
    // Priority 1: <img> tag — skip tiny/hidden/tracking images
    const imgs = element.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
      if (!src) continue;
      // Skip tracking pixels and tiny icons
      const w = img.naturalWidth || img.width || parseInt(img.getAttribute('width') || '0', 10);
      const h = img.naturalHeight || img.height || parseInt(img.getAttribute('height') || '0', 10);
      if (w > 0 && w < 30 && h > 0 && h < 30) continue;
      // Skip data URIs that are likely placeholders
      if (src.startsWith('data:') && src.length < 200) continue;
      // Skip images hidden via CSS (display:none on img or its picture/parent)
      const imgOrPicture = img.closest('picture') || img;
      if (imgOrPicture.offsetWidth === 0 && imgOrPicture.offsetHeight === 0) continue;
      const sel = relativeSelector(img) || 'img';
      return { selector: sel, example: src };
    }

    // Priority 2: <picture> > source or img
    const pictures = element.querySelectorAll('picture');
    for (const pic of pictures) {
      const img = pic.querySelector('img');
      if (img) {
        const src = img.src || img.getAttribute('data-src') || '';
        return { selector: 'picture img', example: src };
      }
    }

    // Priority 3: element with background-image
    const allEls = element.querySelectorAll('*');
    for (const el of allEls) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none' && bg.startsWith('url(')) {
        const url = bg.slice(4, -1).replace(/['"]/g, '');
        const sel = relativeSelector(el);
        if (sel) return { selector: sel, example: url };
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MRT_DETECT_LAYOUT') {
      const result = detectLayout(msg.moduleSelector);
      sendResponse(result);
      return false;
    }

    if (msg.type === 'MRT_PREVIEW_LAYOUT_FIELD') {
      const { moduleSelector, fieldSelector, field } = msg;
      const module = document.querySelector(moduleSelector);
      if (!module) {
        sendResponse({ success: false, error: 'Module not found' });
        return false;
      }

      try {
        if (field === 'element') {
          // Count how many elements match within the module
          const matches = module.querySelectorAll(fieldSelector);
          sendResponse({
            success: true,
            count: matches.length,
            examples: [],
          });
        } else {
          // For anchor/title/image: find all matching elements and extract values
          const baseUrl = window.location.origin;
          const matches = module.querySelectorAll(fieldSelector);
          const examples = [];

          for (const el of matches) {
            if (field === 'anchor') {
              const href = el.getAttribute('href') || el.closest('a')?.getAttribute('href') || '';
              if (href && href !== '#') {
                try { examples.push(new URL(href, baseUrl).href); }
                catch { examples.push(href); }
              }
            } else if (field === 'title') {
              const text = el.textContent?.trim();
              if (text) examples.push(text);
            } else if (field === 'image') {
              const src = el.src || el.getAttribute('data-src') ||
                          el.getAttribute('data-lazy-src') || '';
              if (src) examples.push(src);
            }
          }

          sendResponse({ success: examples.length > 0, examples });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return false;
    }
  });

  return { detectLayout };
})();
