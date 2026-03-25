/**
 * Marfeel Recirculation Tagger v2 — Selector Engine
 * Generates stable CSS selectors for DOM elements.
 * Extracted from detector.js v1.
 */

window.MRTSelectorEngine = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const MODULE_DATA_ATTRS = [
    'data-eid', 'data-module', 'data-component', 'data-block',
    'data-section', 'data-zone', 'data-region', 'data-widget',
    'data-track', 'data-area',
  ];

  const UTILITY_PREFIXES = [
    'col-', 'row-', 'flex-', 'grid-', 'p-', 'px-', 'py-', 'pt-', 'pb-',
    'm-', 'mx-', 'my-', 'mt-', 'mb-', 'w-', 'h-', 'd-', 'bg-',
    'text-', 'font-', 'border-', 'rounded-', 'shadow-', 'opacity-',
    'hidden', 'visible', 'block', 'inline', 'relative', 'absolute',
    'overflow-', 'z-', 'cursor-', 'transition-', 'transform-',
    'animate-', 'duration-', 'ease-', 'delay-',
  ];

  const UTILITY_EXACT = new Set([
    'container', 'wrapper', 'inner', 'outer', 'clearfix', 'cf',
    'active', 'disabled', 'show', 'hide', 'open', 'closed',
    'left', 'right', 'center', 'top', 'bottom', 'ignore-parser',
    'global-wrapper', 'page-wrapper', 'site-wrapper', 'main-wrapper',
    'content-wrapper', 'layout-wrapper', 'body-wrapper',
  ]);

  const MODULE_KEYWORDS = [
    'widget', 'module', 'sidebar', 'related', 'trending', 'popular',
    'latest', 'recent', 'recommended', 'featured', 'hero', 'spotlight',
    'top-news', 'breaking', 'headlines', 'stories', 'articles',
    'post-list', 'card-list', 'news-box', 'content-list',
    'river', 'feed', 'stream', 'carousel', 'slider', 'gallery',
    'promo', 'editor', 'pick', 'must-read', 'dont-miss',
    'breadcrumb', 'byline', 'author', 'tag-list', 'category',
    'footer', 'header', 'navigation', 'nav-', 'menu',
    'recommender', 'recirculation', 'recirc',
    'affiliate', 'sponsored', 'partner', 'ad-',
    'article-body', 'article__body', 'articleBody', 'entry-content',
    'post-content', 'story-body', 'single-news-content',
    'section-link', 'things-to-do',
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isUtilityClass(cls) {
    const lower = cls.toLowerCase();
    if (UTILITY_EXACT.has(lower)) return true;
    return UTILITY_PREFIXES.some(p => lower.startsWith(p));
  }

  function classSpecificityScore(cls) {
    const lower = cls.toLowerCase();
    let score = 0;
    const highValue = [
      'news', 'article', 'post', 'story', 'hero', 'sidebar',
      'widget', 'module', 'latest', 'popular', 'trending',
      'related', 'featured', 'carousel', 'slider', 'promo',
      'recommend', 'footer', 'header', 'content', 'body',
      'section', 'category', 'tag', 'breadcrumb', 'byline',
    ];
    for (const kw of highValue) {
      if (lower.includes(kw)) score += 10;
    }
    if (cls.includes('__') || cls.includes('--')) score += 5;
    if (cls.includes('-')) score += 2;
    return score;
  }

  /**
   * Check if a selector is too broad to be useful as a module selector.
   * Selectors like `main`, `body main`, `.layout` that select huge page regions
   * should be disambiguated further rather than used directly.
   */
  const TOO_GENERIC_SELECTORS = new Set([
    'main', 'body main', 'body > main', 'div', 'section', 'article',
  ]);
  const TOO_GENERIC_CLASSES = new Set([
    'layout', 'main', 'content', 'page', 'site', 'app', 'root',
    'main-content', 'page-content', 'site-content',
  ]);

  function isTooGeneric(selector) {
    const s = selector.trim();
    if (TOO_GENERIC_SELECTORS.has(s)) return true;
    // Check if it's a single class that's too generic
    const match = s.match(/^\.([a-zA-Z0-9_-]+)$/);
    if (match && TOO_GENERIC_CLASSES.has(match[1].toLowerCase())) return true;
    // Tag-only selectors without classes are too broad (e.g., 'main', 'section')
    if (/^[a-z]+$/.test(s)) return true;
    // Compound tag-only selectors are too broad (e.g., 'body main', 'body > main > section')
    if (/^[a-z]+(\s*[>+~]?\s*[a-z]+)+$/.test(s)) return true;
    return false;
  }

  /**
   * Check if a selector would only match <a> elements.
   * Recirculation modules are always containers, never links.
   */
  function selectsOnlyLinks(selector) {
    // Quick check: selector starts with 'a' tag or 'a.' or 'a[' or 'a#'
    const trimmed = selector.trim();
    const startsWithA = /^a(?:[.#\[\s:,]|$)/.test(trimmed);
    if (!startsWithA) {
      // Check the last segment after space (descendant selector ending in a)
      const parts = trimmed.split(/\s+/);
      const last = parts[parts.length - 1];
      if (!/^a(?:[.#\[\s:,]|$)/.test(last)) return false;
    }
    // Verify by querying: if ALL matches are <a> tags AND none are CTAs, reject
    try {
      const matches = [...document.querySelectorAll(selector)];
      if (matches.length === 0) return false;
      if (!matches.every(el => el.tagName === 'A')) return false;
      // Allow if any matched link is a CTA/affiliate
      return !matches.some(el => isCtaLink(el));
    } catch { return false; }
  }

  function simpleSelector(el) {
    if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`;
    const classes = [...(el.classList || [])];
    const semantic = classes.filter(c => !isUtilityClass(c));
    if (semantic.length) return `.${semantic[0]}`;
    const tag = el.tagName.toLowerCase();
    return ['div', 'span', 'section'].includes(tag) ? null : tag;
  }

  // ---------------------------------------------------------------------------
  // Selector generation
  // ---------------------------------------------------------------------------

  /**
   * Generate the best CSS selector for an element.
   * If the clicked element is a repeated item inside a module container,
   * returns the container's selector instead (since that's what the user
   * typically wants to tag as a recirculation module).
   */
  // Keywords that indicate a link IS a taggable module (CTA, affiliate, subscription)
  const CTA_KEYWORDS = [
    'subscribe', 'subscri', 'pretplat', 'suscri', 'abonn',  // subscription
    'cta', 'call-to-action',
    'affiliate', 'sponsored', 'partner', 'promo',
    'buy', 'compra', 'kupn', 'shop', 'store', 'tienda',
    'donate', 'dona', 'support',
    'signup', 'sign-up', 'register', 'registr',
    'download', 'descarg',
    'newsletter',
  ];

  function isCtaLink(el) {
    if (el.tagName !== 'A') return false;
    const cls = (el.className || '').toLowerCase();
    const href = (el.getAttribute('href') || '').toLowerCase();
    const text = (el.textContent || '').trim().toLowerCase();
    return CTA_KEYWORDS.some(kw => cls.includes(kw) || href.includes(kw) || text.includes(kw));
  }

  /**
   * When the clicked element has no selector (utility-only classes),
   * check if a direct child has a good unique selector.
   * e.g., user clicks div.container but div.four-news-big is the real module.
   * Skips headings and links — we want the content container, not the title.
   */
  function findBestChildSelector(parent) {
    // Find the heading in the parent (if any) — we'll use it to disambiguate children
    const parentHeading = findSectionHeading(parent);

    for (const child of parent.children) {
      // Skip heading-like elements — they identify sections, not content
      if (HEADING_TAGS.has(child.tagName)) continue;
      const cls = [...(child.classList || [])];
      if (cls.some(c => HEADING_CLASSES.some(hc => c.toLowerCase().includes(hc)))) continue;
      // Skip bare links (unless CTA)
      if (child.tagName === 'A' && !isCtaLink(child)) continue;

      const childSel = generateBaseSelector(child);
      if (childSel && !isTooGeneric(childSel)) {
        const count = countMatches(childSel);
        if (count === 1) return childSel;
        if (count > 1 && count <= 10) {
          // Try disambiguating child using its own heading
          const hSel = buildHeadingSelector(childSel, child);
          if (hSel) return hSel;

          // Use the PARENT's heading as adjacent sibling combinator:
          // e.g., a.section-title + .four-news-big (heading sibling of child)
          if (parentHeading && child.previousElementSibling === parentHeading.el) {
            const hTag = parentHeading.el.tagName.toLowerCase();
            const hClasses = [...(parentHeading.el.classList || [])].filter(c => !isUtilityClass(c));
            const hSelStr = hClasses.length ? `${hTag}.${hClasses[0]}` : hTag;
            const sibSel = `${hSelStr} + ${childSel}`;
            try { if (countMatches(sibSel) === 1) return sibSel; } catch { /* skip */ }
            // Also try sibling with general sibling combinator (~) in case there's whitespace/text between
            const genSibSel = `${hSelStr} ~ ${childSel}`;
            try { if (countMatches(genSibSel) === 1) return genSibSel; } catch { /* skip */ }
          }

          // Use parent tag + :has() on heading to scope the child
          // e.g., div:has(> .section-title) > .four-news-big
          if (parentHeading) {
            const pTag = parent.tagName.toLowerCase();
            const hTag = parentHeading.el.tagName.toLowerCase();
            const hClasses = [...(parentHeading.el.classList || [])].filter(c => !isUtilityClass(c));
            const hSelStr = hClasses.length ? `${hTag}.${hClasses[0]}` : hTag;
            const scopedCandidates = [
              `${pTag}:has(> ${hSelStr}) > ${childSel}`,
              `${pTag}:has(${hSelStr}) ${childSel}`,
            ];
            for (const c of scopedCandidates) {
              try { if (countMatches(c) === 1) return c; } catch { /* skip */ }
            }
          }
        }
      }
    }
    return null;
  }

  function generateSelector(el) {
    // Regular content links should walk up to their container.
    // But CTA/affiliate/subscription links ARE the module — keep them.
    if (el.tagName === 'A' && !isCtaLink(el)) {
      el = el.parentElement;
      if (!el || el === document.documentElement || el === document.body) return null;
    }

    let candidate = generateBaseSelector(el);

    // If no selector found for this element, try walking DOWN first.
    // The user may have clicked a wrapper (div.container) but the real
    // module is a direct child with a semantic class (div.four-news-big).
    if (!candidate) {
      const childSel = findBestChildSelector(el);
      if (childSel) return childSel;
    }

    // If still no selector, try heading-based disambiguation on self.
    if (!candidate) {
      const selfHeading = findSectionHeading(el);
      if (selfHeading) {
        const tag = el.tagName.toLowerCase();
        const hSel = buildHeadingSelector(tag, el);
        if (hSel) return hSel;
      }
    }

    // Walk UP until we find a selectable parent.
    // Prefer parents that can be disambiguated by heading over overly broad ones.
    if (!candidate) {
      let walker = el.parentElement;
      let depth = 0;
      let bestBroad = null;
      while (walker && walker !== document.documentElement && walker !== document.body && depth < 8) {
        const walkerSel = generateBaseSelector(walker);

        if (walkerSel) {
          const walkerCount = countMatches(walkerSel);

          // If this parent has a heading, we can disambiguate → use it
          if (walkerCount > 1 && walkerCount <= 10) {
            const hSel = buildHeadingSelector(walkerSel, walker);
            if (hSel) return hSel;
          }

          // Unique and not too broad
          if (walkerCount === 1 && !isTooGeneric(walkerSel)) {
            candidate = walkerSel;
            el = walker;
            break;
          }

          if (!bestBroad) bestBroad = { sel: walkerSel, el: walker };
        } else {
          // No base selector (utility-only classes or bare div), BUT
          // if this element contains a heading, build a tag:has() selector.
          const heading = findSectionHeading(walker);
          if (heading) {
            const tag = walker.tagName.toLowerCase();
            const hSel = buildHeadingSelector(tag, walker);
            if (hSel) return hSel;
          }
        }

        walker = walker.parentElement;
        depth++;
      }

      // If we didn't find a good candidate, try heading on the best broad parent
      if (!candidate && bestBroad) {
        const hSel = buildHeadingSelector(bestBroad.sel, bestBroad.el);
        if (hSel) return hSel;
        // Only use the broad selector if it's not too generic
        if (!isTooGeneric(bestBroad.sel)) {
          candidate = bestBroad.sel;
          el = bestBroad.el;
        }
      }

      if (!candidate) return null;
    }

    // If already unique → done
    if (countMatches(candidate) === 1) return candidate;

    const matchCount = countMatches(candidate);
    if (matchCount > 1) {
      // Strategy A: disambiguate the element itself using its heading
      // e.g., .news-box → .news-box:has(a[href="/matura"]) = 1 match
      const selfHeadingSel = buildHeadingSelector(candidate, el);
      if (selfHeadingSel) return selfHeadingSel;

      // Strategy B: walk up through parents, trying heading disambiguation at each level
      // This catches cases like clicking .news-box-inner where .news-box has the heading
      let walker = el.parentElement;
      let walkDepth = 0;
      while (walker && walker !== document.documentElement && walker !== document.body && walkDepth < 6) {
        const walkerSel = generateBaseSelector(walker);
        if (walkerSel) {
          const walkerCount = countMatches(walkerSel);
          if (walkerCount === 1) return walkerSel;
          if (walkerCount > 1 && walkerCount <= 10) {
            const hSel = buildHeadingSelector(walkerSel, walker);
            if (hSel) return hSel;
          }
        }
        walker = walker.parentElement;
        walkDepth++;
      }

      // Strategy C: module ancestor fallback (broader container)
      const ancestor = findModuleAncestor(el);
      if (ancestor) {
        const ancestorSel = generateBaseSelector(ancestor);
        if (ancestorSel) {
          const ancestorCount = countMatches(ancestorSel);
          if (ancestorCount === 1) {
            return ancestorSel;
          }
          if (ancestorCount > 1) {
            const headingSel = buildHeadingSelector(ancestorSel, ancestor);
            if (headingSel) return headingSel;
          }
          if (ancestorCount <= 3) {
            return ancestorSel;
          }
          const scoped = `${ancestorSel} ${candidate}`;
          const scopedCount = countMatches(scoped);
          if (scopedCount < matchCount && scopedCount >= 1) {
            return scoped;
          }
        }
      }
    }

    // Try to refine for specificity
    const refined = refineSelector(el, candidate);
    const result = refined || candidate;

    // SAFETY NET: never return a too-generic selector
    if (isTooGeneric(result)) return null;

    return result;
  }

  // Patterns for instance-specific values that change per page/article and should
  // NOT be used as selectors (UUIDs, hashes, timestamps, long numeric IDs, etc.)
  const INSTANCE_VALUE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;  // UUID prefix
  const HASH_VALUE_RE = /^[0-9a-f]{12,}$/i;                // hex hash (12+ chars)
  const LONG_NUMERIC_RE = /^\d{6,}$/;                       // numeric ID (6+ digits)
  const TIMESTAMP_RE = /^\d{10,13}$/;                        // Unix timestamps

  // Data attribute names that typically hold instance-specific values
  const INSTANCE_ATTR_PATTERNS = [
    /id$/i, /uid$/i, /uuid$/i, /hash$/i, /token$/i, /nonce$/i,
    /timestamp$/i, /time$/i, /date$/i, /key$/i, /ref$/i,
  ];

  /**
   * Check if a data attribute value looks instance-specific (not stable across pages).
   */
  function isInstanceSpecificAttr(name, value) {
    if (!value) return true;
    if (INSTANCE_VALUE_RE.test(value)) return true;
    if (HASH_VALUE_RE.test(value)) return true;
    if (LONG_NUMERIC_RE.test(value)) return true;
    if (TIMESTAMP_RE.test(value)) return true;
    if (INSTANCE_ATTR_PATTERNS.some(p => p.test(name))) return true;
    // Values with mixed alphanumeric that look like generated IDs (e.g., "a3f8b2c1")
    if (/^[a-f0-9]{8,}$/i.test(value) && !/[g-zG-Z]/.test(value)) return true;
    return false;
  }

  /**
   * Generate an initial selector candidate (may not be unique).
   * Prioritizes STABLE selectors that work across all pages of the same type.
   */
  function generateBaseSelector(el) {
    const tag = el.tagName.toLowerCase();

    // 1. ID (skip auto-generated and instance-specific)
    if (el.id && !/^(ember|react|ng-|__|js-)\d+/.test(el.id) && !isInstanceSpecificAttr('id', el.id)) {
      return `${tag}#${el.id}`;
    }

    // 2. Known semantic data attributes (skip instance-specific values)
    for (const attr of MODULE_DATA_ATTRS) {
      if (attr.startsWith('data-mrf')) continue;
      const val = el.getAttribute(attr);
      if (val && !isInstanceSpecificAttr(attr, val)) return `${tag}[${attr}="${val}"]`;
    }

    // 3. ARIA label (stable across pages)
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;

    // 4. Semantic classes (ranked by specificity) — most stable for recirculation
    const classes = [...(el.classList || [])];
    const semantic = classes.filter(c => !isUtilityClass(c));
    if (semantic.length) {
      const ranked = semantic.sort((a, b) => {
        const diff = classSpecificityScore(b) - classSpecificityScore(a);
        return diff !== 0 ? diff : b.length - a.length;
      });
      return `.${ranked[0]}`;
    }

    // 5. Other data attributes (only if value looks stable/semantic)
    for (const a of el.attributes) {
      if (a.name.startsWith('data-') && a.value) {
        if (a.name.startsWith('data-mrf')) continue;
        if (['data-reactid', 'data-reactroot', 'data-testid'].includes(a.name)) continue;
        if (isInstanceSpecificAttr(a.name, a.value)) continue;
        if (a.value.length > 3) {
          return `${tag}[${a.name}="${a.value}"]`;
        }
      }
    }

    // 6. Tag + parent context
    const parent = el.parentElement;
    if (parent && parent !== document.documentElement) {
      const parentSel = simpleSelector(parent);
      const childSel = simpleSelector(el);
      if (parentSel && childSel) return `${parentSel} ${childSel}`;
    }

    return null;
  }

  // Heading tags used to identify sections by their title text
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const HEADING_CLASSES = ['section-title', 'section-heading', 'block-title', 'widget-title',
    'module-title', 'sidebar-title', 'category-title', 'title'];

  /**
   * Find a heading inside (or just before) an element that can identify the section.
   * Returns { headingSelector, text } or null.
   */
  function findSectionHeading(el) {
    // 1. Look for a heading as direct child
    for (const child of el.children) {
      if (HEADING_TAGS.has(child.tagName)) {
        const text = child.textContent.trim();
        if (text && text.length < 60) return { el: child, text };
      }
      // Also check for heading-like classes on non-heading elements
      const cls = [...(child.classList || [])];
      if (cls.some(c => HEADING_CLASSES.some(hc => c.toLowerCase().includes(hc)))) {
        const text = child.textContent.trim();
        if (text && text.length < 60) return { el: child, text };
      }
    }

    // 2. Look at the previous sibling (heading just before the container)
    let prev = el.previousElementSibling;
    if (prev && HEADING_TAGS.has(prev.tagName)) {
      const text = prev.textContent.trim();
      if (text && text.length < 60) return { el: prev, text, isSibling: true };
    }

    return null;
  }

  /**
   * Build a selector to disambiguate a non-unique container using its heading.
   * Strategies (in order):
   *   1. :has() with a link inside the heading whose href is unique
   *   2. :has() with a heading class that's unique to this container
   *   3. Adjacent sibling combinator (heading + container)
   *   4. :nth-of-type on the container among its same-class siblings
   */
  function buildHeadingSelector(containerSel, container) {
    const heading = findSectionHeading(container);

    if (heading) {
      const hTag = heading.el.tagName.toLowerCase();
      const hClasses = [...(heading.el.classList || [])].filter(c => !isUtilityClass(c));
      const hSel = hClasses.length ? `${hTag}.${hClasses[0]}` : hTag;

      // Strategy A: heading has a link with a unique href (most reliable)
      // The heading itself may BE the link (e.g., <a class="section-title" href="...">)
      // or contain one as a descendant (e.g., <h2><a href="...">...</a></h2>)
      const headingIsLink = heading.el.tagName === 'A';
      const headingLink = headingIsLink ? heading.el : heading.el.querySelector('a[href]');
      if (headingLink) {
        const href = headingLink.getAttribute('href');
        if (href && href !== '#') {
          const escapedHref = href.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const bareLinkSel = `a[href="${escapedHref}"]`;
          // When heading IS the link and has a class, use class+href for max specificity
          // e.g., a.section-title[href="/srednjahr-zajednica"]
          const qualifiedLinkSel = headingIsLink && hClasses.length
            ? `${hSel}[href="${escapedHref}"]`
            : bareLinkSel;

          const candidates = [];
          // Most specific first: container:has(> heading-class[href])
          if (qualifiedLinkSel !== bareLinkSel) {
            candidates.push(`${containerSel}:has(> ${qualifiedLinkSel})`);
          }
          candidates.push(
            `${containerSel}:has(> ${bareLinkSel})`,
            // When heading is NOT the link: container:has(> heading link)
            ...(!headingIsLink ? [`${containerSel}:has(> ${hSel} ${bareLinkSel})`] : []),
            `${containerSel}:has(${qualifiedLinkSel})`,
            `${containerSel}:has(${bareLinkSel})`,
          );

          for (const c of candidates) {
            try { if (countMatches(c) === 1) return c; } catch { /* skip */ }
          }

          // Try adjacent sibling: a heading-link followed by the container
          if (heading.isSibling) {
            const sibSel = qualifiedLinkSel !== bareLinkSel
              ? `${hSel}[href="${escapedHref}"] + ${containerSel}`
              : `${hSel}:has(${bareLinkSel}) + ${containerSel}`;
            try { if (countMatches(sibSel) === 1) return sibSel; } catch { /* skip */ }
          }
        }
      }

      // Strategy B: :has() with heading class (works when only some containers have this heading type)
      if (heading.isSibling) {
        const candidate = `${hSel} + ${containerSel}`;
        try { if (countMatches(candidate) === 1) return candidate; } catch { /* skip */ }
      }
      const hasDirect = `${containerSel}:has(> ${hSel})`;
      try { if (countMatches(hasDirect) === 1) return hasDirect; } catch { /* skip */ }
      const hasDesc = `${containerSel}:has(${hSel})`;
      try { if (countMatches(hasDesc) === 1) return hasDesc; } catch { /* skip */ }
    }

    // Strategy C: :nth-of-type — positional among siblings of the same selector
    return buildNthSelector(containerSel, container);
  }

  /**
   * Build a :nth-of-type selector for a container among its same-selector siblings.
   * E.g., .news-box:nth-of-type(1) if there are multiple .news-box under the same parent.
   */
  function buildNthSelector(baseSel, el) {
    const parent = el.parentElement;
    if (!parent || parent === document.documentElement || parent === document.body) return null;

    const tag = el.tagName.toLowerCase();

    // Count position among siblings matching the same tag
    let idx = 0;
    for (const sibling of parent.children) {
      if (sibling.tagName === el.tagName) {
        idx++;
        if (sibling === el) break;
      }
    }

    // Try with parent context: .parent > .news-box:nth-of-type(N)
    const parentSel = generateBaseSelector(parent);
    if (parentSel) {
      const candidate = `${parentSel} > ${tag}:nth-of-type(${idx})`;
      try { if (countMatches(candidate) === 1) return candidate; } catch { /* skip */ }
    }

    // Try just baseSel:nth-of-type(N) — may work if all instances share the same parent
    const simpleNth = `${baseSel}:nth-of-type(${idx})`;
    try { if (countMatches(simpleNth) === 1) return simpleNth; } catch { /* skip */ }

    return null;
  }

  /**
   * Refine a selector to make it more specific when it matches multiple elements.
   * Tries (in order): heading-based :has(), compound classes, ancestor context, nth-of-type.
   */
  function refineSelector(el, baseSel) {
    const tag = el.tagName.toLowerCase();

    // Strategy 0: Heading-based disambiguation with :has()
    // If the element (or its ancestor) contains a heading, use it to uniquely identify
    const headingSel = buildHeadingSelector(baseSel, el);
    if (headingSel) return headingSel;

    // Also try on parent — common pattern: .main-content has a heading that names the section
    const parent = el.parentElement;
    if (parent && parent !== document.documentElement && parent !== document.body) {
      const parentSel = generateBaseSelector(parent);
      if (parentSel && countMatches(parentSel) > 1) {
        const parentHeadingSel = buildHeadingSelector(parentSel, parent);
        if (parentHeadingSel) return parentHeadingSel;
      }
    }

    // Strategy 1: Compound all semantic classes (e.g., .article-card.featured)
    const classes = [...(el.classList || [])];
    const semantic = classes.filter(c => !isUtilityClass(c));
    if (semantic.length >= 2) {
      const compound = semantic.map(c => `.${c}`).join('');
      if (countMatches(compound) < countMatches(baseSel)) {
        if (countMatches(compound) === 1) return compound;
        baseSel = compound;
      }
    }

    // Strategy 2: Ancestor context (parent > child or ancestor descendant)
    if (parent && parent !== document.documentElement && parent !== document.body) {
      const parentSel = generateBaseSelector(parent);
      if (parentSel) {
        const directChild = `${parentSel} > ${baseSel}`;
        if (countMatches(directChild) >= 1 && countMatches(directChild) < countMatches(baseSel)) {
          if (countMatches(directChild) === 1) return directChild;
          baseSel = directChild;
        }

        const grandparent = parent.parentElement;
        if (grandparent && grandparent !== document.documentElement && grandparent !== document.body) {
          const gpSel = generateBaseSelector(grandparent);
          if (gpSel) {
            const deeper = `${gpSel} ${baseSel}`;
            if (countMatches(deeper) >= 1 && countMatches(deeper) < countMatches(baseSel)) {
              if (countMatches(deeper) === 1) return deeper;
              baseSel = deeper;
            }
          }
        }
      }
    }

    // Strategy 3: nth-of-type to disambiguate among siblings
    if (el.parentElement) {
      const siblings = el.parentElement.children;
      let idx = 0;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i].tagName === el.tagName) {
          idx++;
          if (siblings[i] === el) break;
        }
      }
      const parentPart = simpleSelector(parent);
      if (parentPart) {
        const candidate = `${parentPart} > ${tag}:nth-of-type(${idx})`;
        if (countMatches(candidate) === 1) return candidate;
      }
    }

    return baseSel;
  }

  // ---------------------------------------------------------------------------
  // Module ancestor detection (for walking up from clicked element)
  // ---------------------------------------------------------------------------

  function hasSemanticClass(el) {
    const classes = [...(el.classList || [])];
    for (const cls of classes) {
      const lower = cls.toLowerCase();
      if (MODULE_KEYWORDS.some(kw => lower.includes(kw))) return true;
    }
    return false;
  }

  function isModuleContainer(el) {
    for (const attr of MODULE_DATA_ATTRS) {
      if (el.getAttribute(attr)) return true;
    }
    if (el.getAttribute('aria-label')) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['complementary', 'contentinfo', 'navigation', 'region'].includes(role)) return true;
    return hasSemanticClass(el);
  }

  function findModuleAncestor(el) {
    let current = el.parentElement;
    let best = null;
    let depth = 0;

    while (current && current !== document.documentElement && depth < 10) {
      if (isModuleContainer(current)) { best = current; break; }
      if (['LI', 'ARTICLE', 'SECTION', 'ASIDE'].includes(current.tagName)) {
        const parent = current.parentElement;
        if (parent && parent !== document.documentElement) {
          if (isModuleContainer(parent) || ['UL', 'OL', 'SECTION', 'ASIDE', 'DIV'].includes(parent.tagName)) {
            best = parent; break;
          }
        }
      }
      current = current.parentElement;
      depth++;
    }

    if (!best) {
      current = el.parentElement;
      depth = 0;
      while (current && current !== document.documentElement && depth < 8) {
        if (['SECTION', 'ASIDE', 'ARTICLE', 'MAIN', 'NAV'].includes(current.tagName)) {
          best = current; break;
        }
        if (current.tagName === 'DIV' && (current.id || hasSemanticClass(current))) {
          best = current; break;
        }
        current = current.parentElement;
        depth++;
      }
    }

    return best;
  }

  // ---------------------------------------------------------------------------
  // Match counting
  // ---------------------------------------------------------------------------

  function countMatches(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  /**
   * Get all elements matching a selector.
   */
  function getMatchingElements(selector) {
    try {
      return [...document.querySelectorAll(selector)];
    } catch {
      return [];
    }
  }

  /**
   * Check if a selector overlaps with any of the existing selectors.
   * Returns an array of { selector, overlapCount } for selectors that share elements.
   */
  function checkOverlaps(newSelector, existingSelectors) {
    const overlaps = [];
    let newEls;
    try {
      newEls = new Set(document.querySelectorAll(newSelector));
    } catch {
      return overlaps;
    }
    if (!newEls.size) return overlaps;

    for (const existing of existingSelectors) {
      if (existing === newSelector) continue;
      try {
        const existingEls = document.querySelectorAll(existing);
        let overlapCount = 0;
        for (const el of existingEls) {
          if (newEls.has(el)) overlapCount++;
        }
        if (overlapCount > 0) {
          overlaps.push({ selector: existing, overlapCount });
        }
      } catch { /* skip invalid */ }
    }
    return overlaps;
  }

  // ---------------------------------------------------------------------------
  // Alternative selectors
  // ---------------------------------------------------------------------------

  /**
   * Generate multiple selector candidates for an element, ranked by usefulness.
   * Includes the parent container as an option when the element is a repeated item.
   * Returns array of { selector, matchCount, label } sorted best-first.
   */
  function suggestAlternatives(el) {
    const alternatives = [];
    const tag = el.tagName.toLowerCase();
    const seen = new Set();

    function add(selector, label) {
      if (!selector || seen.has(selector)) return;
      // Never suggest a selector that targets <a> elements
      if (selectsOnlyLinks(selector)) return;
      seen.add(selector);
      try {
        const mc = countMatches(selector);
        if (mc > 0) alternatives.push({ selector, matchCount: mc, label });
      } catch { /* invalid selector */ }
    }

    // --- Container / module ancestor (often what the user actually wants) ---
    const ancestor = findModuleAncestor(el);
    if (ancestor) {
      const ancestorSel = generateBaseSelector(ancestor);
      if (ancestorSel) {
        add(ancestorSel, `container: ${ancestorSel}`);
        // Try heading-based and positional disambiguation on ancestor
        if (countMatches(ancestorSel) > 1) {
          const hSel = buildHeadingSelector(ancestorSel, ancestor);
          if (hSel) add(hSel, `section: ${hSel}`);
          // Also offer nth-of-type explicitly
          const nthSel = buildNthSelector(ancestorSel, ancestor);
          if (nthSel) add(nthSel, `positional: ${nthSel}`);
        }
      }
    }
    // Walk up looking for semantic parents (aside, section, etc.)
    let walker = el.parentElement;
    let walkDepth = 0;
    while (walker && walker !== document.documentElement && walker !== document.body && walkDepth < 5) {
      const ws = generateBaseSelector(walker);
      if (ws) {
        const wsCount = countMatches(ws);
        if (wsCount === 1) {
          add(ws, `parent: ${ws}`);
        } else if (wsCount <= 5) {
          add(ws, `parent: ${ws}`);
          // Try heading-based disambiguation
          const hSel = buildHeadingSelector(ws, walker);
          if (hSel) add(hSel, `section: ${hSel}`);
        }
      }
      walker = walker.parentElement;
      walkDepth++;
    }

    // --- Scoped selectors (element within a container) ---
    const classes = [...(el.classList || [])];
    const semantic = classes.filter(c => !isUtilityClass(c));

    // Parent > element selectors
    const parent = el.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) {
      const parentSel = generateBaseSelector(parent);
      if (parentSel && semantic.length) {
        add(`${parentSel} > .${semantic[0]}`, `${parentSel} > .${semantic[0]}`);
        // Also try grandparent scope for more specificity
        const gp = parent.parentElement;
        if (gp && gp !== document.body && gp !== document.documentElement) {
          const gpSel = generateBaseSelector(gp);
          if (gpSel && gpSel !== parentSel) {
            add(`${gpSel} .${semantic[0]}`, `${gpSel} .${semantic[0]}`);
          }
        }
      }
      if (parent) {
        const ps = generateBaseSelector(parent);
        if (ps) add(`${ps} > ${tag}`, `${ps} > ${tag}`);
      }
    }

    // --- Element-level selectors ---
    // Compound classes
    if (semantic.length >= 2) {
      const ranked = semantic.sort((a, b) => classSpecificityScore(b) - classSpecificityScore(a));
      add(ranked.map(c => `.${c}`).join(''), ranked.map(c => `.${c}`).join(''));
    }
    // Individual classes
    for (const cls of semantic) {
      add(`.${cls}`, `.${cls}`);
    }

    // Data attributes (only stable ones)
    for (const a of el.attributes) {
      if (a.name.startsWith('data-') && a.value && !isInstanceSpecificAttr(a.name, a.value)) {
        if (a.name.startsWith('data-mrf') || ['data-reactid', 'data-reactroot', 'data-testid'].includes(a.name)) continue;
        add(`[${a.name}="${a.value}"]`, `[${a.name}="${a.value}"]`);
      }
    }

    // ARIA
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) add(`[aria-label="${ariaLabel}"]`, `[aria-label="${ariaLabel}"]`);

    // Sort: containers (matchCount=1) first, then by fewer matches
    alternatives.sort((a, b) => {
      if (a.matchCount === 1 && b.matchCount !== 1) return -1;
      if (b.matchCount === 1 && a.matchCount !== 1) return 1;
      return a.matchCount - b.matchCount;
    });

    return alternatives.slice(0, 8);
  }

  // ---------------------------------------------------------------------------
  // Find common pattern across multiple elements
  // ---------------------------------------------------------------------------

  /**
   * Classify the relationship between multi-selected elements.
   * Returns one of:
   *   'similar'    — high tag/class overlap → find common CSS pattern (case 2/3)
   *   'nested'     — elements are at different depths inside a shared container (case 6)
   *   'different'  — low similarity, share an ancestor → LCA container (case 1)
   *   'scattered'  — no meaningful shared ancestor → comma-join (case 7)
   */
  function classifyMultiSelect(elements, lca) {
    // --- Check for nested: are some elements ancestors/descendants of others? ---
    for (let i = 0; i < elements.length; i++) {
      for (let j = 0; j < elements.length; j++) {
        if (i !== j && elements[i].contains(elements[j])) return 'nested';
      }
    }

    // --- Compute similarity score across selected elements ---
    const tagSet = new Set(elements.map(el => el.tagName));
    const classSets = elements.map(el => {
      return new Set([...(el.classList || [])].filter(c => !isUtilityClass(c)));
    });

    // Shared semantic classes across ALL elements
    const sharedClasses = classSets[0] ? [...classSets[0]].filter(cls =>
      classSets.every(s => s.has(cls))
    ) : [];

    // Union of all semantic classes
    const allClasses = new Set();
    for (const s of classSets) for (const c of s) allClasses.add(c);

    const jaccardSimilarity = allClasses.size > 0
      ? sharedClasses.length / allClasses.size
      : 0;

    const sameTag = tagSet.size === 1;
    const sameParent = new Set(elements.map(el => el.parentElement)).size === 1;

    // Similar: same tag + shared classes, or siblings under same parent
    if (sameTag && (jaccardSimilarity >= 0.3 || sameParent)) return 'similar';
    if (jaccardSimilarity >= 0.5) return 'similar';

    // No meaningful LCA → scattered / unrelated
    if (!lca) return 'scattered';

    // LCA is too high up (body-level wrapper) → likely unrelated
    const lcaDepth = getDepth(lca);
    if (lcaDepth <= 2) return 'scattered';

    return 'different';
  }

  function getDepth(el) {
    let depth = 0;
    let current = el;
    while (current && current !== document.documentElement) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  /**
   * Given an array of DOM elements, detect the case and find the best selectors.
   *
   * Cases handled:
   *   1. Different elements, common ancestor → LCA container selector
   *   2. Similar elements, shared structure  → common CSS pattern
   *   3. Siblings at same level              → parent > repeated child
   *   4. Same component, different locations  → broad selector or per-location
   *   5. Partial selection of repeated set    → flag: "Found N total — use all?"
   *   6. Nested elements from same module     → LCA = the module container
   *   7. Unrelated elements, no pattern       → comma-joined individual selectors
   *
   * Returns array of { selector, matchCount, label, case, totalAvailable? }
   */
  function findCommonPattern(elements) {
    if (!elements.length) return null;
    if (elements.length === 1) return null;

    const lca = findLowestCommonAncestor(elements);
    const classification = classifyMultiSelect(elements, lca);
    const results = [];
    const seen = new Set();

    function add(selector, label, caseNum) {
      if (!selector || seen.has(selector)) return;
      if (selectsOnlyLinks(selector)) return;
      seen.add(selector);
      try {
        const mc = countMatches(selector);
        if (mc > 0) results.push({ selector, matchCount: mc, label, case: caseNum });
      } catch { /* invalid selector */ }
    }

    // ------------------------------------------------------------------
    // CASE: similar / siblings (2, 3, 5)
    // Elements share structure → find shared CSS pattern
    // ------------------------------------------------------------------
    if (classification === 'similar') {
      const classSets = elements.map(el => new Set([...(el.classList || [])].filter(c => !isUtilityClass(c))));
      const sharedClasses = [...classSets[0]].filter(cls => classSets.every(s => s.has(cls)));
      const sameParent = new Set(elements.map(el => el.parentElement)).size === 1;
      const sameTag = new Set(elements.map(el => el.tagName)).size === 1;

      // Rank shared classes by specificity
      const ranked = sharedClasses.sort((a, b) => classSpecificityScore(b) - classSpecificityScore(a));

      // Case 3: siblings under same parent
      if (sameParent && sameTag) {
        const parent = elements[0].parentElement;
        const parentSel = generateBaseSelector(parent);
        const tag = elements[0].tagName.toLowerCase();
        if (parentSel) {
          // Direct children by tag
          add(`${parentSel} > ${tag}`, `siblings: ${parentSel} > ${tag}`, 3);
          // Direct children by shared class
          for (const cls of ranked.slice(0, 2)) {
            add(`${parentSel} > .${cls}`, `siblings: ${parentSel} > .${cls}`, 3);
          }
        }
      }

      // Case 2: shared class patterns
      for (const cls of ranked.slice(0, 3)) {
        add(`.${cls}`, `shared: .${cls}`, 2);
      }

      // Compound shared classes
      if (ranked.length >= 2) {
        add(ranked.slice(0, 2).map(c => `.${c}`).join(''), `compound: ${ranked.slice(0, 2).map(c => `.${c}`).join('')}`, 2);
      }

      // Scoped to LCA
      if (lca) {
        const lcaSel = generateBaseSelector(lca);
        if (lcaSel) {
          for (const cls of ranked.slice(0, 2)) {
            const scoped = `${lcaSel} .${cls}`;
            const globalCount = countMatches(`.${cls}`);
            const scopedCount = countMatches(scoped);
            if (scopedCount >= elements.length && scopedCount < globalCount) {
              add(scoped, `scoped: ${scoped}`, 2);
            }
          }

          // Same tag scoped to ancestor
          if (sameTag) {
            const tag = elements[0].tagName.toLowerCase();
            add(`${lcaSel} > ${tag}`, `children: ${lcaSel} > ${tag}`, 3);
          }
        }
      }

      // Case 4: same component in different locations
      // If the best shared selector matches in multiple distinct ancestors
      if (ranked.length && lca) {
        const bestCls = ranked[0];
        const allMatches = getMatchingElements(`.${bestCls}`);
        const distinctParents = new Set(allMatches.map(el => {
          const anc = findModuleAncestor(el);
          return anc ? generateBaseSelector(anc) : null;
        }).filter(Boolean));

        if (distinctParents.size > 1) {
          // Offer per-location scoped selectors
          for (const parentSel of distinctParents) {
            const scoped = `${parentSel} .${bestCls}`;
            add(scoped, `location: ${scoped}`, 4);
          }
        }
      }

      // Case 5: partial selection check
      // If the best result matches more elements than selected, flag it
      if (results.length > 0) {
        const best = results[0];
        if (best.matchCount > elements.length) {
          best.totalAvailable = best.matchCount;
          best.label = `${best.label} (${elements.length} selected of ${best.matchCount})`;
        }
      }
    }

    // ------------------------------------------------------------------
    // CASE: nested (6)
    // Elements at different depths inside the same module → use LCA
    // ------------------------------------------------------------------
    if (classification === 'nested') {
      if (lca) {
        // Try the LCA itself
        const lcaSel = generateBaseSelector(lca);
        if (lcaSel) {
          add(lcaSel, `container: ${lcaSel}`, 6);
          // Try heading-based disambiguation
          if (countMatches(lcaSel) > 1) {
            const hSel = buildHeadingSelector(lcaSel, lca);
            if (hSel) add(hSel, `section: ${hSel}`, 6);
          }
        }

        // Also try module ancestor above the LCA
        const moduleAnc = findModuleAncestor(lca);
        if (moduleAnc && moduleAnc !== lca) {
          const maSel = generateBaseSelector(moduleAnc);
          if (maSel) {
            add(maSel, `module: ${maSel}`, 6);
            if (countMatches(maSel) > 1) {
              const hSel = buildHeadingSelector(maSel, moduleAnc);
              if (hSel) add(hSel, `section: ${hSel}`, 6);
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // CASE: different (1)
    // Low similarity but share a meaningful ancestor → container selector
    // ------------------------------------------------------------------
    if (classification === 'different') {
      if (lca) {
        const lcaSel = generateBaseSelector(lca);
        if (lcaSel) {
          add(lcaSel, `container: ${lcaSel}`, 1);
          if (countMatches(lcaSel) > 1) {
            const hSel = buildHeadingSelector(lcaSel, lca);
            if (hSel) add(hSel, `section: ${hSel}`, 1);
            const nSel = buildNthSelector(lcaSel, lca);
            if (nSel) add(nSel, `positional: ${nSel}`, 1);
          }
        }

        // Walk up from LCA to find module ancestor
        const moduleAnc = findModuleAncestor(lca);
        if (moduleAnc && moduleAnc !== lca) {
          const maSel = generateBaseSelector(moduleAnc);
          if (maSel) add(maSel, `module: ${maSel}`, 1);
        }
      }

      // Also add any shared classes as fallback options
      const classSets = elements.map(el => new Set([...(el.classList || [])].filter(c => !isUtilityClass(c))));
      if (classSets[0]) {
        const shared = [...classSets[0]].filter(cls => classSets.every(s => s.has(cls)));
        for (const cls of shared.slice(0, 2)) {
          add(`.${cls}`, `shared: .${cls}`, 2);
        }
      }
    }

    // ------------------------------------------------------------------
    // CASE: scattered (7)
    // No meaningful shared pattern → comma-join individual selectors
    // ------------------------------------------------------------------
    if (classification === 'scattered') {
      // Try to generate a selector for each element and comma-join them
      const individualSels = [];
      for (const el of elements) {
        const sel = generateSelector(el);
        if (sel) individualSels.push(sel);
      }

      if (individualSels.length > 0) {
        const joined = individualSels.join(', ');
        add(joined, `combined: ${individualSels.length} selectors`, 7);

        // Also offer each individual selector as alternative
        for (const sel of individualSels) {
          add(sel, `individual: ${sel}`, 7);
        }
      }

      // Still try LCA as a long-shot
      if (lca) {
        const lcaSel = generateBaseSelector(lca);
        if (lcaSel) add(lcaSel, `ancestor: ${lcaSel}`, 1);
      }
    }

    // ------------------------------------------------------------------
    // Sorting: prefer selectors closest to the selected count,
    // then unique (1 match) selectors, then fewer matches
    // ------------------------------------------------------------------
    if (results.length === 0) return null;

    results.sort((a, b) => {
      // Exact match to selection count is ideal
      const exactA = a.matchCount === elements.length ? 1 : 0;
      const exactB = b.matchCount === elements.length ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;

      // Prefer fewer matches (more specific)
      const diffA = Math.abs(a.matchCount - elements.length);
      const diffB = Math.abs(b.matchCount - elements.length);
      if (diffA !== diffB) return diffA - diffB;

      // Prefer container cases (1, 6) over scattered (7)
      const caseOrder = { 6: 0, 1: 1, 3: 2, 2: 3, 4: 4, 5: 5, 7: 6 };
      return (caseOrder[a.case] || 9) - (caseOrder[b.case] || 9);
    });

    return results;
  }

  /**
   * Find the lowest common ancestor of a set of elements.
   */
  function findLowestCommonAncestor(elements) {
    if (elements.length === 0) return null;
    if (elements.length === 1) return elements[0].parentElement;

    // Get ancestor chain for first element
    function getAncestors(el) {
      const ancestors = [];
      let current = el;
      while (current) {
        ancestors.push(current);
        current = current.parentElement;
      }
      return ancestors;
    }

    const firstAncestors = getAncestors(elements[0]);
    for (const ancestor of firstAncestors) {
      if (elements.every(el => ancestor.contains(el)) &&
          ancestor !== document.documentElement &&
          ancestor !== document.body) {
        return ancestor;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Page type detection
  // ---------------------------------------------------------------------------

  /**
   * Detect if the current page is a homepage, article, section, etc.
   * Returns 'Home' | 'Article' | 'Section' | 'Page'
   */
  function detectPageType() {
    const path = location.pathname;

    // Homepage
    if (path === '/' || path === '/index.html' || path === '/index.php') {
      return 'Home';
    }

    // Article detection: look for article body, structured data, long content
    const hasArticleBody = !!document.querySelector(
      'article, [itemtype*="Article"], [class*="article-body"], [class*="article__body"], ' +
      '[class*="entry-content"], [class*="post-content"], [class*="story-body"]'
    );
    const hasLdJson = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .some(s => {
        try { return JSON.parse(s.textContent)?.['@type']?.includes('Article'); }
        catch { return false; }
      });

    if (hasArticleBody || hasLdJson) return 'Article';

    // Section page: path has 1-2 segments, no long slugs
    const segments = path.split('/').filter(Boolean);
    if (segments.length <= 2 && segments.every(s => s.length < 30 && !/\d{4}/.test(s))) {
      return 'Section';
    }

    return 'Page';
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    generateSelector,
    generateBaseSelector,
    findModuleAncestor,
    isModuleContainer,
    countMatches,
    getMatchingElements,
    checkOverlaps,
    suggestAlternatives,
    findCommonPattern,
    detectPageType,
    // Exposed for namer.js
    MODULE_DATA_ATTRS,
    MODULE_KEYWORDS,
    isUtilityClass,
  };
})();
