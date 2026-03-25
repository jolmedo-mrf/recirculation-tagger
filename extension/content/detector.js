/**
 * Marfeel Recirculation Tagger — Module Detector
 * Port of analyze_recirculation.py to browser-native JS.
 * Runs directly on the live DOM — no Playwright/BeautifulSoup needed.
 */

window.MRTDetector = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const SOCIAL_DOMAINS = new Set([
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
    'pinterest.com', 'youtube.com', 'tiktok.com', 'whatsapp.com', 't.me',
    'telegram.org', 'reddit.com', 'tumblr.com',
  ]);

  const THIRD_PARTY_WIDGETS = [
    'taboola', 'outbrain', 'revcontent', 'mgid', 'content.ad',
    'nativo', 'sharethrough', 'triplelift', 'zergnet',
  ];

  const MARFEEL_ATTRS = ['data-mrf-recirculation', 'data-mrf-experience', 'data-mrf-module'];

  const SHARE_PATTERNS = [
    'share', 'sharer', 'intent/tweet', 'pin/create', 'shareArticle',
    'send?text', 'wa.me', 'api.whatsapp',
  ];

  const SKIP_HREF_RE = /^(#|javascript:|mailto:|tel:|data:)/;

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

  const CARD_KEYWORDS = [
    'news-article', 'article-card', 'post-card', 'story-card',
    'card-item', 'news-card', 'content-card', 'feed-item',
    'news-item', 'story-item', 'article-item',
  ];

  const CONTAINER_PATTERNS = [
    'related-links', 'related-news', 'recommended-news', 'recommended-articles',
    'related-articles', 'related-posts', 'related-stories',
    'last-news', 'latest-news', 'ultimas-noticias',
    'agenda-caliente', 'breaking-news',
    'most-read', 'most-popular', 'mas-leidas',
    'also-read', 'te-puede-interesar',
    'trending-now', 'trending-stories',
    'news-column', 'news-list', 'news-grid',
    'widget-wrapper',
    'last-news-column-image', 'last-news-column-without-image',
  ];

  const BODY_SELECTORS = [
    'article-body', 'article__body', 'articleBody', 'entry-content',
    'post-content', 'story-body', 'single-news-content', 'article-content',
    'post-body', 'content-body',
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function safeURL(href) {
    try { return new URL(href, location.origin); }
    catch { return null; }
  }

  function getSiteDomain() {
    const parts = location.hostname.split('.');
    if (parts[0] === 'www' && parts.length > 2) return parts.slice(1).join('.');
    return location.hostname;
  }

  function isInternalLink(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return false;
    const url = safeURL(href);
    if (!url) return false;
    const domain = getSiteDomain();
    const linkDomain = url.hostname.replace(/^www\./, '');
    return linkDomain === domain || linkDomain.endsWith('.' + domain);
  }

  function isSocialLink(href) {
    if (!href) return false;
    const url = safeURL(href);
    if (url) {
      const domain = url.hostname.replace(/^www\./, '');
      if (SOCIAL_DOMAINS.has(domain)) return true;
    }
    const lower = href.toLowerCase();
    return SHARE_PATTERNS.some(p => lower.includes(p));
  }

  function isShareButton(el) {
    const text = [
      ...(el.classList || []),
      el.getAttribute('aria-label') || '',
      el.getAttribute('title') || '',
    ].join(' ').toLowerCase();
    const kws = ['share', 'social', 'facebook', 'twitter', 'whatsapp',
      'linkedin', 'pinterest', 'telegram', 'email-share', 'copy-link', 'copy_link'];
    return kws.some(k => text.includes(k));
  }

  function shouldSkipHref(href) {
    if (!href) return true;
    if (SKIP_HREF_RE.test(href)) return true;
    const lower = href.toLowerCase();
    return THIRD_PARTY_WIDGETS.some(w => lower.includes(w));
  }

  function isThirdPartyWidget(el) {
    let current = el;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 15) {
      const id = (current.id || '').toLowerCase();
      const cls = [...(current.classList || [])].join(' ').toLowerCase();
      let dataAttrs = '';
      for (const attr of current.attributes || []) {
        if (attr.name.startsWith('data-') && typeof attr.value === 'string') {
          dataAttrs += ` ${attr.name}=${attr.value}`;
        }
      }
      const combined = `${id} ${cls} ${dataAttrs.toLowerCase()}`;
      if (THIRD_PARTY_WIDGETS.some(w => combined.includes(w))) return true;
      if (id && (id.includes('trc_') || id.includes('trc-'))) return true;
      const dataItem = current.getAttribute('data-item-id') || '';
      if (dataItem.includes('~~V1~~')) return true;
      current = current.parentElement;
      depth++;
    }
    return false;
  }

  function isUtilityClass(cls) {
    const lower = cls.toLowerCase();
    if (UTILITY_EXACT.has(lower)) return true;
    return UTILITY_PREFIXES.some(p => lower.startsWith(p));
  }

  function classSpecificityScore(cls) {
    const lower = cls.toLowerCase();
    let score = 0;
    const highValue = ['news', 'article', 'post', 'story', 'hero', 'sidebar',
      'widget', 'module', 'latest', 'popular', 'trending',
      'related', 'featured', 'carousel', 'slider', 'promo',
      'recommend', 'footer', 'header', 'content', 'body',
      'section', 'category', 'tag', 'breadcrumb', 'byline'];
    for (const kw of highValue) {
      if (lower.includes(kw)) score += 10;
    }
    if (cls.includes('__') || cls.includes('--')) score += 5;
    if (cls.includes('-')) score += 2;
    return score;
  }

  // ---------------------------------------------------------------------------
  // Selector generation
  // ---------------------------------------------------------------------------

  function generateSelector(el) {
    const tag = el.tagName.toLowerCase();

    // 1. ID
    if (el.id && !/^(ember|react|ng-|__|js-)\d+/.test(el.id)) {
      return `${tag}#${el.id}`;
    }

    // 2. Data attributes
    for (const attr of MODULE_DATA_ATTRS) {
      if (attr.startsWith('data-mrf')) continue;
      const val = el.getAttribute(attr);
      if (val) return `${tag}[${attr}="${val}"]`;
    }

    // 2b. Other data attributes
    for (const a of el.attributes) {
      if (a.name.startsWith('data-') && a.value) {
        if (a.name.startsWith('data-mrf')) continue;
        if (['data-reactid', 'data-reactroot', 'data-testid'].includes(a.name)) continue;
        if (a.value.length > 3 && !/^\d+$/.test(a.value)) {
          return `${tag}[${a.name}="${a.value}"]`;
        }
      }
    }

    // 3. ARIA label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;

    // 4. Semantic classes
    const classes = [...(el.classList || [])];
    const semantic = classes.filter(c => !isUtilityClass(c));
    if (semantic.length) {
      const ranked = semantic.sort((a, b) => {
        const diff = classSpecificityScore(b) - classSpecificityScore(a);
        return diff !== 0 ? diff : b.length - a.length;
      });
      return `.${ranked[0]}`;
    }

    // 5. Tag with parent context
    const parent = el.parentElement;
    if (parent && parent !== document.documentElement) {
      const parentSel = simpleSelector(parent);
      const childSel = simpleSelector(el);
      if (parentSel && childSel) return `${parentSel} ${childSel}`;
    }

    return null;
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
  // Module ancestor detection
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

  function findModuleAncestor(link) {
    let current = link.parentElement;
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
      current = link.parentElement;
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
  // Link cluster detection
  // ---------------------------------------------------------------------------

  function findLinkClusters() {
    const siteDomain = getSiteDomain();
    const allLinks = document.querySelectorAll('a[href]');
    const ancestorGroups = new Map();

    for (const link of allLinks) {
      const href = link.getAttribute('href');
      if (shouldSkipHref(href)) continue;
      const resolved = safeURL(href);
      if (!resolved) continue;
      const fullHref = resolved.href;
      if (isSocialLink(fullHref) || isShareButton(link)) continue;
      if (isThirdPartyWidget(link)) continue;

      const ancestor = findModuleAncestor(link);
      if (!ancestor) continue;

      // Use a WeakRef-compatible key
      if (!ancestor._mrt_id) ancestor._mrt_id = Math.random().toString(36).slice(2);
      const key = ancestor._mrt_id;

      if (!ancestorGroups.has(key)) ancestorGroups.set(key, []);
      ancestorGroups.get(key).push({
        element: link,
        href: fullHref,
        text: (link.textContent || '').trim().slice(0, 100),
        isInternal: isInternalLink(fullHref),
        ancestor,
      });
    }

    const clusters = [];
    for (const [, links] of ancestorGroups) {
      if (!links.length) continue;
      const ancestor = links[0].ancestor;
      const selector = generateSelector(ancestor);
      if (!selector) continue;
      clusters.push({
        ancestor,
        selector,
        links,
        totalLinks: links.length,
        internalLinks: links.filter(l => l.isInternal).length,
        externalLinks: links.filter(l => !l.isInternal).length,
      });
    }

    // Additional passes
    clusters.push(...detectLinkCardPatterns());
    clusters.push(...detectRecirculationContainers());
    clusters.push(...detectBodySubClusters());
    clusters.push(...detectIndividualElements());

    return clusters;
  }

  function detectLinkCardPatterns() {
    const results = [];
    const allCardLinks = document.querySelectorAll('a[href][class]');
    const classGroups = new Map();

    for (const link of allCardLinks) {
      if (isThirdPartyWidget(link)) continue;
      const href = link.getAttribute('href');
      if (shouldSkipHref(href)) continue;
      const resolved = safeURL(href);
      if (!resolved) continue;
      const fullHref = resolved.href;
      if (isSocialLink(fullHref) || isShareButton(link)) continue;

      const classes = [...link.classList];
      const matching = classes.filter(c => CARD_KEYWORDS.some(kw => c.toLowerCase().includes(kw)));
      if (!matching.length) continue;

      const compoundKey = matching.sort().join('.');
      if (!classGroups.has(compoundKey)) classGroups.set(compoundKey, []);
      classGroups.get(compoundKey).push({
        element: link,
        href: fullHref,
        text: (link.textContent || '').trim().slice(0, 100),
        isInternal: isInternalLink(fullHref),
        ancestor: link,
      });
    }

    for (const [compoundKey, links] of classGroups) {
      if (!links.length) continue;
      const parts = compoundKey.split('.');
      const selector = parts.map(p => `.${p}`).join('');
      const sampleEl = links[0].element;

      const containerSel = findScopingContainer(sampleEl);
      if (containerSel) {
        results.push({
          ancestor: sampleEl.parentElement || sampleEl,
          selector: `${containerSel} ${selector}`,
          links,
          totalLinks: links.length,
          internalLinks: links.filter(l => l.isInternal).length,
          externalLinks: links.filter(l => !l.isInternal).length,
          _forceCategory: 'recirculation',
          _forceName: cleanName(parts[parts.length - 1]),
        });
      }

      results.push({
        ancestor: sampleEl.parentElement || sampleEl,
        selector,
        links,
        totalLinks: links.length,
        internalLinks: links.filter(l => l.isInternal).length,
        externalLinks: links.filter(l => !l.isInternal).length,
        _forceCategory: 'recirculation',
        _forceName: cleanName(parts[parts.length - 1]),
      });
    }
    return results;
  }

  function findScopingContainer(link) {
    let current = link.parentElement;
    let depth = 0;
    const scopeKeywords = [
      'widget', 'module', 'sidebar', 'ratingcero', 'rating',
      'agenda', 'carousel', 'slider', 'spotlight', 'hero',
      'featured', 'trending', 'popular', 'breaking',
    ];
    while (current && current !== document.documentElement && depth < 8) {
      for (const cls of current.classList || []) {
        if (scopeKeywords.some(kw => cls.toLowerCase().includes(kw))) {
          return `.${cls}`;
        }
      }
      current = current.parentElement;
      depth++;
    }
    return null;
  }

  function detectRecirculationContainers() {
    const results = [];
    const foundSelectors = new Set();

    for (const pattern of CONTAINER_PATTERNS) {
      const elements = document.querySelectorAll(`[class*="${pattern}"]`);
      for (const el of elements) {
        if (isThirdPartyWidget(el)) continue;
        const linksInEl = el.querySelectorAll('a[href]');
        if (!linksInEl.length) continue;

        const matchedClasses = [...el.classList].filter(c => c.toLowerCase().includes(pattern.toLowerCase()));
        const sel = matchedClasses.length
          ? matchedClasses.map(c => `.${c}`).join('')
          : generateSelector(el);
        if (!sel || foundSelectors.has(sel)) continue;

        const linkData = [];
        for (const link of linksInEl) {
          const href = link.getAttribute('href');
          if (shouldSkipHref(href)) continue;
          const resolved = safeURL(href);
      if (!resolved) continue;
      const fullHref = resolved.href;
          if (isSocialLink(fullHref) || isShareButton(link) || isThirdPartyWidget(link)) continue;
          linkData.push({
            element: link,
            href: fullHref,
            text: (link.textContent || '').trim().slice(0, 100),
            isInternal: isInternalLink(fullHref),
            ancestor: el,
          });
        }

        if (linkData.length) {
          foundSelectors.add(sel);
          results.push({
            ancestor: el,
            selector: sel,
            links: linkData,
            totalLinks: linkData.length,
            internalLinks: linkData.filter(l => l.isInternal).length,
            externalLinks: linkData.filter(l => !l.isInternal).length,
            _forceCategory: 'recirculation',
            _forceName: cleanName(pattern),
          });
        }
      }
    }
    return results;
  }

  function detectBodySubClusters() {
    const subClusters = [];
    for (const bodyCls of BODY_SELECTORS) {
      let bodyEl = document.querySelector(`.${bodyCls}`) ||
                   document.querySelector(`[class*="${bodyCls}"]`) ||
                   document.querySelector(`#${bodyCls}`) ||
                   document.querySelector(`[id*="${bodyCls}"]`);
      if (!bodyEl) continue;

      const bodySelector = generateSelector(bodyEl);
      if (!bodySelector) continue;

      // Paragraph links
      const pLinks = [];
      for (const p of bodyEl.querySelectorAll('p')) {
        for (const link of p.querySelectorAll('a[href]')) {
          const href = link.getAttribute('href');
          if (shouldSkipHref(href)) continue;
          const resolved = safeURL(href);
      if (!resolved) continue;
      const fullHref = resolved.href;
          if (isSocialLink(fullHref)) continue;
          pLinks.push({
            element: link, href: fullHref,
            text: (link.textContent || '').trim().slice(0, 100),
            isInternal: isInternalLink(fullHref), ancestor: bodyEl,
          });
        }
      }
      if (pLinks.length) {
        subClusters.push({
          ancestor: bodyEl, selector: `${bodySelector} p`, links: pLinks,
          totalLinks: pLinks.length,
          internalLinks: pLinks.filter(l => l.isInternal).length,
          externalLinks: pLinks.filter(l => !l.isInternal).length,
          _forceCategory: 'body_links', _forceName: 'Paragraph Links',
        });
      }

      // List links
      const liLinks = [];
      for (const li of bodyEl.querySelectorAll('li')) {
        for (const link of li.querySelectorAll('a[href]')) {
          const href = link.getAttribute('href');
          if (shouldSkipHref(href)) continue;
          const resolved = safeURL(href);
      if (!resolved) continue;
      const fullHref = resolved.href;
          if (isSocialLink(fullHref)) continue;
          liLinks.push({
            element: link, href: fullHref,
            text: (link.textContent || '').trim().slice(0, 100),
            isInternal: isInternalLink(fullHref), ancestor: bodyEl,
          });
        }
      }
      if (liLinks.length) {
        subClusters.push({
          ancestor: bodyEl, selector: `${bodySelector} li`, links: liLinks,
          totalLinks: liLinks.length,
          internalLinks: liLinks.filter(l => l.isInternal).length,
          externalLinks: liLinks.filter(l => !l.isInternal).length,
          _forceCategory: 'body_links', _forceName: 'Related Posts',
        });
      }
    }
    return subClusters;
  }

  function detectIndividualElements() {
    const results = [];
    const foundSelectors = new Set();
    const patterns = [
      { match: /buy|ticket|purchase/i, attr: 'class', category: 'cta', name: 'Buy CTA' },
      { match: /\bcta\b/i, attr: 'class', category: 'cta', name: 'CTA' },
      { match: /subscribe|signup|sign-up/i, attr: 'class', category: 'cta', name: 'Subscribe CTA' },
      { match: /donate|donation/i, attr: 'class', category: 'cta', name: 'Donate CTA' },
      { match: /tracklink|track-link/i, attr: 'class', category: 'recirculation', name: 'Also Read' },
      { match: /also.?read/i, attr: 'class', category: 'recirculation', name: 'Also Read' },
      { match: /recommender|recommendation/i, attr: 'class', category: 'recirculation', name: 'Recommender Module' },
    ];

    for (const pattern of patterns) {
      const all = document.querySelectorAll(`[class]`);
      for (const el of all) {
        const cls = el.className;
        if (typeof cls !== 'string' || !pattern.match.test(cls)) continue;
        if (isThirdPartyWidget(el)) continue;

        const sel = generateSelector(el);
        if (!sel || foundSelectors.has(sel)) continue;

        let linksInEl = el.querySelectorAll('a[href]');
        if (!linksInEl.length && el.tagName === 'A' && el.href) {
          linksInEl = [el];
        }
        if (!linksInEl.length) continue;

        const linkData = [];
        for (const link of linksInEl) {
          const href = link.getAttribute('href');
          if (shouldSkipHref(href)) continue;
          const resolved = safeURL(href);
      if (!resolved) continue;
      const fullHref = resolved.href;
          if (isSocialLink(fullHref)) continue;
          linkData.push({
            element: link, href: fullHref,
            text: (link.textContent || '').trim().slice(0, 100),
            isInternal: isInternalLink(fullHref), ancestor: el,
          });
        }

        if (linkData.length) {
          foundSelectors.add(sel);
          results.push({
            ancestor: el, selector: sel, links: linkData,
            totalLinks: linkData.length,
            internalLinks: linkData.filter(l => l.isInternal).length,
            externalLinks: linkData.filter(l => !l.isInternal).length,
            _forceCategory: pattern.category, _forceName: pattern.name,
          });
        }
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Dynamic confidence scoring
  // ---------------------------------------------------------------------------

  function computeConfidence(cluster, category, baseConfidence) {
    const confValues = { low: 1, medium: 2, high: 3 };
    let score = confValues[baseConfidence] || 1;

    // Signal: link count
    const linkCount = cluster.internalLinks || 0;
    if (linkCount >= 10) score += 1;
    else if (linkCount >= 5) score += 0.5;

    // Signal: links look like articles (2+ path segments, slug-like)
    const articleLikeLinks = (cluster.links || []).filter(l => {
      const url = safeURL(l.href);
      if (!url) return false;
      const segs = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
      return segs.length >= 2;
    }).length;
    if (articleLikeLinks >= linkCount * 0.7 && linkCount >= 3) score += 1;

    // Signal: links contain images (article card pattern)
    const hasImages = (cluster.links || []).some(l =>
      l.element && (l.element.querySelector('img, picture') || l.element.closest('a')?.querySelector('img, picture'))
    );
    if (hasImages) score += 0.5;

    // Signal: semantic data attributes on ancestor
    const el = cluster.ancestor;
    if (el) {
      for (const attr of MODULE_DATA_ATTRS) {
        if (el.getAttribute(attr)) { score += 0.5; break; }
      }
      if (el.getAttribute('aria-label')) score += 0.5;
    }

    // Penalty: very few links for recirculation
    if (category === 'recirculation' && linkCount <= 2) score -= 1;

    // Penalty: all links are same-page anchors
    const anchorLinks = (cluster.links || []).filter(l => {
      const url = safeURL(l.href);
      return url && url.pathname === location.pathname;
    }).length;
    if (anchorLinks >= linkCount * 0.8 && linkCount >= 2) score -= 2;

    // Map score back to confidence level
    if (score >= 3) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  // ---------------------------------------------------------------------------
  // Navigation detection
  // ---------------------------------------------------------------------------

  const NAV_CLASS_PATTERNS = [
    /^footer-nav/i, /^nav[-_]/i, /[-_]nav[-_]/i, /[-_]nav$/i,
    /^main-nav/i, /^header[-_]nav/i, /^site[-_]nav/i,
    /^footer__/i, /^footer-/i, /^footer[-_]apps/i, /^footer[-_]logo/i,
    /^footer[-_]top/i, /^footer[-_]bottom/i, /^footer[-_]middle/i,
    /menu[-_]?link/i, /[-_]menu[-_]/i, /^menu[-_]/i, /[-_]menu$/i,
    /^tags[-_]?wrapper/i, /[-_]tags[-_]?wrapper/i,
  ];

  const NAV_CONTENT_PATTERNS = [
    /clima|weather|tiempo/i, /app[-_]?store|play[-_]?store|download[-_]?app/i,
    /apps[-_]?logo/i, /social[-_]?link/i, /copyright/i,
  ];

  function isNavigationElement(el, identifiers) {
    // Check if element is inside <nav>, <header>, or <footer>
    let parent = el.parentElement;
    let depth = 0;
    while (parent && parent !== document.documentElement && depth < 6) {
      if (parent.tagName === 'NAV') return true;
      if (parent.tagName === 'FOOTER') return true;
      parent = parent.parentElement;
      depth++;
    }

    // Check role="navigation" on element or ancestors
    if ((el.getAttribute('role') || '').toLowerCase() === 'navigation') return true;

    // Check individual class names against BEM nav patterns
    const classes = [...(el.classList || [])];
    for (const cls of classes) {
      if (NAV_CLASS_PATTERNS.some(p => p.test(cls))) return true;
      if (NAV_CONTENT_PATTERNS.some(p => p.test(cls))) return true;
    }

    return false;
  }

  function hasRecirculationSignal(identifiers) {
    const recircKeywords = [
      'related', 'recommend', 'trending', 'popular', 'most-read',
      'latest-news', 'last-news', 'breaking', 'featured', 'spotlight',
      'hero', 'also-read', 'for-you', 'suggested', 'river', 'feed',
      'news-article', 'article-card', 'post-card', 'story-card',
    ];
    return recircKeywords.some(k => identifiers.includes(k));
  }

  // ---------------------------------------------------------------------------
  // Classification & naming
  // ---------------------------------------------------------------------------

  function classifyCluster(cluster, pageType) {
    let category, name, confidence;

    if (cluster._forceCategory) {
      category = cluster._forceCategory;
      name = cluster._forceName;
      confidence = computeConfidence(cluster, category, 'high');
    } else {
      let baseConfidence;
      [category, name, baseConfidence] = determineCategoryAndName(cluster);
      confidence = baseConfidence ? computeConfidence(cluster, category, baseConfidence) : baseConfidence;
    }

    if (!category) return null;

    // Validate on live DOM
    let matchedElements = 0;
    let matchedLinks = 0;
    const sampleLinks = cluster.links.slice(0, 5).map(l => l.href);

    try {
      const els = document.querySelectorAll(cluster.selector);
      matchedElements = els.length;
      for (const el of els) {
        const anchors = el.tagName === 'A' ? [el] : [...el.querySelectorAll('a[href]')];
        matchedLinks += anchors.length;
      }
    } catch { /* invalid selector */ }

    if (matchedElements === 0) return null;

    return {
      selector: cluster.selector,
      name: `[${pageType}] ${name}`,
      pageType,
      linkCount: matchedLinks || cluster.totalLinks,
      sampleLinks,
      confidence,
      category,
      matchedElements,
      matchedLinks,
      // Keep references to DOM elements for overlay
      elements: (() => {
        try { return [...document.querySelectorAll(cluster.selector)]; }
        catch { return []; }
      })(),
    };
  }

  function determineCategoryAndName(cluster) {
    const el = cluster.ancestor;
    const tag = el.tagName.toLowerCase();
    const classes = [...(el.classList || [])].join(' ').toLowerCase();
    const elId = (el.id || '').toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    let identifiers = `${classes} ${elId} ${ariaLabel}`;

    for (const attr of MODULE_DATA_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) identifiers += ` ${val.toLowerCase()}`;
    }

    // Navigation — check tag, keywords, and BEM/structural patterns
    const isNavTag = tag === 'nav' || identifiers.includes('navigation') || identifiers.includes('nav-main');
    const isNavElement = isNavigationElement(el, identifiers);

    if (isNavTag || (isNavElement && !hasRecirculationSignal(identifiers))) {
      if (identifiers.includes('topic') || identifiers.includes('sub')) {
        return ['navigation', 'Topic Navigation', 'high'];
      }
      // Elements inside footer/nav that contain recirculation signals → keep as recirculation
      if (isNavElement && !isNavTag && hasRecirculationSignal(identifiers)) {
        // Fall through to keyword rules below
      } else if (isNavTag) {
        return [null, '', ''];  // Skip main nav elements
      } else {
        // Footer/nav descendant without recirculation signal → navigation
        const navName = deriveNameFromAttrs(el) || bestClassName(el);
        return ['navigation', navName || 'Navigation', 'high'];
      }
    }

    // Body links
    const bodyPatterns = ['article-body', 'article__body', 'articlebody', 'entry-content',
      'post-content', 'story-body', 'single-news-content', 'modulebody'];
    if (bodyPatterns.some(p => identifiers.includes(p))) {
      if (identifiers.includes('recommender')) return ['recirculation', 'Recommender Module', 'high'];
      return ['body_links', 'Body Links', 'high'];
    }

    if (identifiers.includes('breadcrumb')) return ['navigation', 'Breadcrumbs', 'high'];
    if (identifiers.includes('byline') || identifiers.includes('author')) return ['navigation', 'Byline', 'medium'];

    const rules = [
      [['hero', 'centerpiece', 'opening'], 'recirculation', 'Hero', 'high'],
      [['featured', 'spotlight'], 'recirculation', 'Featured Stories', 'high'],
      [['editor', 'pick'], 'recirculation', "Editor's Pick", 'high'],
      [['top-news', 'breaking', 'headline'], 'recirculation', 'Top News', 'high'],
      [['latest', 'recent', 'newest'], 'recirculation', 'Latest News', 'high'],
      [['popular', 'trending', 'most-read', 'mostpopular'], 'recirculation', 'Most Popular', 'high'],
      [['related', 'also-read', 'tracklink', 'more-stories'], 'recirculation', 'Also Read', 'high'],
      [['recommend', 'for-you', 'suggested'], 'recirculation', 'Recommended', 'high'],
      [['section', 'category', 'topic', 'tag'], 'recirculation', 'Sections', 'medium'],
      [['sidebar', 'aside', 'rail'], 'recirculation', 'Sidebar', 'medium'],
      [['river', 'feed', 'stream'], 'recirculation', 'River', 'high'],
      [['promo', 'promoted', 'promotion'], 'affiliate', 'Promo / Sponsored', 'medium'],
      [['widget'], 'recirculation', 'Widget', 'medium'],
      [['carousel', 'slider', 'swiper'], 'recirculation', 'Carousel', 'medium'],
      [['affiliate', 'sponsored', 'partner', 'advert'], 'affiliate', 'Sponsored Content', 'high'],
      [['cta', 'buy', 'ticket', 'subscribe', 'donate', 'advertise'], 'cta', 'CTA', 'high'],
    ];

    // Use word-boundary matching to avoid false positives
    // e.g. "hero" should not match "therobserver", "feed" should not match "feedback"
    for (const [keywords, cat, defaultName, conf] of rules) {
      if (keywords.some(k => {
        const re = new RegExp(`(?:^|[\\s_-])${k}(?:$|[\\s_-])`, 'i');
        return re.test(identifiers);
      })) {
        return [cat, defaultName, conf];
      }
    }

    // Generic fallback
    const internalCount = cluster.internalLinks;
    if (internalCount >= 3) {
      const derivedName = deriveNameFromAttrs(el);
      if (derivedName) return ['recirculation', derivedName, 'medium'];
      const className = bestClassName(el);
      if (className) return ['recirculation', className, 'low'];
      return ['recirculation', `Link Module (${internalCount} links)`, 'low'];
    }

    return [null, '', ''];
  }

  function bestClassName(el) {
    const classes = [...(el.classList || [])];
    const filtered = filterJunkClasses(classes);
    if (!filtered.length) return null;
    // Pick longest meaningful class
    const best = filtered.sort((a, b) => b.length - a.length)[0];
    return cleanName(best);
  }

  function deriveNameFromAttrs(el) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value && attr.value.length > 2 && !/^\d+$/.test(attr.value)) {
        return cleanName(attr.value);
      }
    }
    if (el.id && !/^(ember|react|ng-)\d+/.test(el.id)) return cleanName(el.id);
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    return null;
  }

  // Patterns for junk classes that should be stripped before naming
  const JUNK_CLASS_PATTERNS = [
    /^menu-item-\d+$/i,                   // menu-item-3624
    /^menu-item-type-/i,                  // menu-item-type-taxonomy
    /^menu-item-object-/i,               // menu-item-object-category
    /^menu-item-has-children$/i,
    /^menu-item$/i,
    /^nav-item$/i,
    /^current[-_]?menu[-_]?item/i,
    /^page[-_]item/i,
    /^page-item-\d+$/i,
    /^widget[-_]\d+$/i,                   // widget_123
    /^wp-block-/i,                        // wp-block-*
    /^post-\d+$/i,                        // post-123
    /^category-\d+$/i,
    /^tag-\d+$/i,
    /^js-/i,                              // js-* (behaviour hooks)
    /^is-/i,                              // is-active, is-visible
    /^has-/i,                             // has-children
  ];

  function filterJunkClasses(classes) {
    const meaningful = classes.filter(c =>
      !JUNK_CLASS_PATTERNS.some(p => p.test(c)) &&
      !UTILITY_PREFIXES.some(p => c.startsWith(p)) &&
      !UTILITY_EXACT.has(c) &&
      c.length > 2
    );
    return meaningful.length ? meaningful : classes;
  }

  function cleanName(raw) {
    raw = raw.replace(/^\[(Home|Article)\]\s*/, '');
    raw = raw.replace(/^(HP|Home|Article)\s*[-–]\s*/, '');
    raw = raw.replace(/^(dynamic_|module_|widget_|block_)/, '');

    // If raw looks like multiple space-separated classes, pick the best one
    if (raw.includes(' ') && !raw.includes('__')) {
      const parts = raw.split(/\s+/);
      const filtered = filterJunkClasses(parts);
      // Pick the longest meaningful class (usually the most specific)
      raw = filtered.sort((a, b) => b.length - a.length)[0] || raw;
    }

    if (raw.includes('--')) {
      const parts = raw.split('--');
      const modifier = parts[parts.length - 1];
      raw = modifier.length > 2 ? modifier : parts[0];
    }
    raw = raw.replace(/__/g, ' ');
    raw = raw.replace(/^(news|article|post|story|content|widget|n)[_-]/i, '');
    raw = raw.replace(/^(news|article)\s+\1/i, '$1');
    raw = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
    raw = raw.replace(/[_-]+/g, ' ');
    let result = raw.trim().replace(/\b\w/g, c => c.toUpperCase());
    if (['Article', 'News', 'Articles', 'News Article'].includes(result)) result = 'All Links';
    return result;
  }

  // ---------------------------------------------------------------------------
  // Filtering & dedup
  // ---------------------------------------------------------------------------

  // Structural wrappers that should never be modules — too generic
  const STRUCTURAL_SELECTORS = new Set([
    '.global-wrapper', '.page-wrapper', '.site-wrapper', '.main-wrapper',
    '.content-wrapper', '.layout-wrapper', '.body-wrapper',
    '.page-container', '.site-container', '.main-container',
  ]);

  function filterLowValue(modules) {
    const lowPatterns = [
      /login/i, /registra/i, /sign.?up/i, /sign.?in/i,
      /impressum/i, /privacy/i, /cookie/i, /gdpr/i,
      /about.?us/i, /contact/i, /terms/i, /legal/i, /disclaimer/i,
    ];
    return modules.filter(m => {
      // Skip structural wrappers
      if (STRUCTURAL_SELECTORS.has(m.selector)) return false;
      const lowCount = m.sampleLinks.filter(l =>
        lowPatterns.some(p => p.test(l))
      ).length;
      if (lowCount >= m.sampleLinks.length * 0.5) return false;
      if (m.selector && m.selector.toLowerCase().includes('data-mrf')) return false;
      return true;
    });
  }

  function resolveHierarchy(modules) {
    if (modules.length < 2) return modules;

    // For each module, get first matched DOM element
    const moduleEls = modules.map(m => {
      try {
        return document.querySelector(m.selector);
      } catch { return null; }
    });

    // Find parent-child relationships
    const children = new Set();

    for (let i = 0; i < modules.length; i++) {
      if (!moduleEls[i]) continue;
      for (let j = 0; j < modules.length; j++) {
        if (i === j || !moduleEls[j]) continue;
        // Check if module i contains module j
        if (moduleEls[i].contains(moduleEls[j]) && moduleEls[i] !== moduleEls[j]) {
          // i is parent of j — if same category, remove child; if different, keep both but mark child
          if (modules[i].category === modules[j].category) {
            children.add(j);
          }
          // For different categories, keep both (e.g., a navigation element inside a recirculation container)
        }
      }
    }

    // Recalculate parent link counts excluding children's links
    for (let i = 0; i < modules.length; i++) {
      if (children.has(i) || !moduleEls[i]) continue;

      // Find all children of this module
      const childIndices = [];
      for (let j = 0; j < modules.length; j++) {
        if (i !== j && !children.has(j) && moduleEls[j] && moduleEls[i].contains(moduleEls[j])) {
          childIndices.push(j);
        }
      }

      if (childIndices.length > 0) {
        // Get child links to subtract from parent
        const childLinks = new Set();
        for (const ci of childIndices) {
          try {
            const els = document.querySelectorAll(modules[ci].selector);
            for (const el of els) {
              const anchors = el.tagName === 'A' ? [el] : [...el.querySelectorAll('a[href]')];
              for (const a of anchors) childLinks.add(a);
            }
          } catch { /* skip */ }
        }

        // Recount parent's own links (excluding child links)
        try {
          const parentEls = document.querySelectorAll(modules[i].selector);
          let ownLinks = 0;
          for (const el of parentEls) {
            const anchors = el.tagName === 'A' ? [el] : [...el.querySelectorAll('a[href]')];
            for (const a of anchors) {
              if (!childLinks.has(a)) ownLinks++;
            }
          }
          // If parent has very few own links after subtraction, it's just a wrapper — remove it
          if (ownLinks <= 1) {
            children.add(i);
          } else {
            modules[i].linkCount = ownLinks;
            modules[i].matchedLinks = ownLinks;
          }
        } catch { /* skip */ }
      }
    }

    return modules.filter((_, idx) => !children.has(idx));
  }

  function deduplicateByLinks(modules) {
    if (modules.length < 2) return modules;

    // Collect all hrefs for each module by querying the DOM
    const moduleHrefs = modules.map(m => {
      const hrefs = new Set();
      try {
        const els = document.querySelectorAll(m.selector);
        for (const el of els) {
          const anchors = el.tagName === 'A' ? [el] : [...el.querySelectorAll('a[href]')];
          for (const a of anchors) {
            const url = safeURL(a.getAttribute('href'));
            if (url) hrefs.add(url.href);
          }
        }
      } catch { /* invalid selector */ }
      return hrefs;
    });

    const confOrder = { high: 0, medium: 1, low: 2 };
    const removed = new Set();

    for (let i = 0; i < modules.length; i++) {
      if (removed.has(i)) continue;
      for (let j = i + 1; j < modules.length; j++) {
        if (removed.has(j)) continue;

        const setA = moduleHrefs[i];
        const setB = moduleHrefs[j];
        if (!setA.size || !setB.size) continue;

        // Jaccard similarity
        let intersection = 0;
        for (const href of setA) { if (setB.has(href)) intersection++; }
        const union = setA.size + setB.size - intersection;
        const similarity = union > 0 ? intersection / union : 0;

        if (similarity >= 0.8) {
          // Keep the better module: higher confidence, then more links
          const confDiff = (confOrder[modules[i].confidence] || 3) - (confOrder[modules[j].confidence] || 3);
          if (confDiff > 0 || (confDiff === 0 && modules[j].linkCount > modules[i].linkCount)) {
            removed.add(i);
          } else {
            removed.add(j);
          }
        }
      }
    }

    return modules.filter((_, idx) => !removed.has(idx));
  }

  function deduplicateNames(modules) {
    const counts = {};
    modules.forEach(m => counts[m.name] = (counts[m.name] || 0) + 1);
    const seen = {};
    for (const m of modules) {
      if (counts[m.name] > 1) {
        seen[m.name] = (seen[m.name] || 0) + 1;
        const hint = nameHintFromSelector(m.selector);
        if (hint) {
          const prefixMatch = m.name.match(/^(\[(?:Home|Article)\])\s*/);
          const prefix = prefixMatch ? prefixMatch[1] + ' ' : '';
          m.name = `${prefix}${hint}`;
        } else {
          m.name = `${m.name} #${seen[m.name]}`;
        }
      }
    }
    // Second pass for remaining dupes
    const finalCounts = {};
    modules.forEach(m => finalCounts[m.name] = (finalCounts[m.name] || 0) + 1);
    const finalSeen = {};
    for (const m of modules) {
      if (finalCounts[m.name] > 1) {
        finalSeen[m.name] = (finalSeen[m.name] || 0) + 1;
        if (finalSeen[m.name] > 1) m.name = `${m.name} #${finalSeen[m.name]}`;
      }
    }
    return modules;
  }

  function nameHintFromSelector(selector) {
    const classMatch = selector.match(/\.([a-zA-Z][\w-]*)/g);
    if (classMatch) return cleanName(classMatch[classMatch.length - 1].slice(1));
    const idMatch = selector.match(/#([a-zA-Z][\w-]*)/);
    if (idMatch) return cleanName(idMatch[1]);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Uncovered areas
  // ---------------------------------------------------------------------------

  function findUncoveredAreas(validatedSelectors) {
    const siteDomain = getSiteDomain();
    const covered = new Set();

    for (const sel of validatedSelectors) {
      try {
        document.querySelectorAll(sel).forEach(el => {
          const anchors = el.tagName === 'A' ? [el] : [...el.querySelectorAll('a[href]')];
          anchors.forEach(a => covered.add(a));
        });
      } catch { /* skip invalid selectors */ }
    }

    const NAV_TAGS = new Set(['NAV', 'HEADER', 'FOOTER']);
    const candidates = document.querySelectorAll('section, aside, div, ul, ol, article');
    const results = [];
    const seenSelectors = new Set();

    for (const el of candidates) {
      if (NAV_TAGS.has(el.tagName)) continue;
      if ((el.getAttribute('role') || '').toLowerCase() === 'navigation') continue;

      const anchors = [...el.querySelectorAll('a[href]')].filter(a => {
        if (covered.has(a)) return false;
        try {
          const url = new URL(a.href);
          if (!url.hostname.includes(siteDomain)) return false;
          const segs = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
          return segs.length >= 2;
        } catch { return false; }
      });

      if (anchors.length < 3) continue;

      let sel = el.tagName.toLowerCase();
      if (el.id) {
        sel = '#' + el.id;
      } else if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/)
          .filter(c => c.length > 2 && !isUtilityClass(c))[0];
        if (cls) sel = '.' + cls;
      }

      if (seenSelectors.has(sel)) continue;
      seenSelectors.add(sel);

      results.push({
        selector: sel,
        linkCount: anchors.length,
        sampleLinks: anchors.slice(0, 5).map(a => a.href),
        sampleTexts: anchors.slice(0, 3).map(a => (a.textContent || '').trim().slice(0, 80)),
        elements: [el],
      });
    }

    results.sort((a, b) => b.linkCount - a.linkCount);
    return results.slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // Main analysis
  // ---------------------------------------------------------------------------

  function analyze() {
    const pageType = isArticlePage() ? 'Article' : 'Home';
    console.log(`[MRT] Analyzing page as: ${pageType}`);

    const clusters = findLinkClusters();
    console.log(`[MRT] Found ${clusters.length} raw clusters`);

    // Classify & validate
    const seenSelectors = new Set();
    let modules = [];
    for (const cluster of clusters) {
      const m = classifyCluster(cluster, pageType);
      if (m && !seenSelectors.has(m.selector)) {
        seenSelectors.add(m.selector);
        modules.push(m);
      }
    }

    modules = filterLowValue(modules);
    modules = resolveHierarchy(modules);
    modules = deduplicateByLinks(modules);
    modules = deduplicateNames(modules);

    // Sort by confidence then link count
    const confOrder = { high: 0, medium: 1, low: 2 };
    modules.sort((a, b) => (confOrder[a.confidence] || 3) - (confOrder[b.confidence] || 3) || b.linkCount - a.linkCount);

    // Find uncovered areas
    const validatedSelectors = modules.map(m => m.selector);
    const uncovered = findUncoveredAreas(validatedSelectors);

    console.log(`[MRT] Detected ${modules.length} modules, ${uncovered.length} uncovered areas`);

    return { pageType, modules, uncovered, url: location.href };
  }

  function isArticlePage() {
    // Heuristic: article pages have <article>, long content, or specific URL patterns
    if (document.querySelector('article .entry-content, article .article-body, article .post-content')) return true;
    const path = location.pathname.replace(/\/$/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      const last = segments[segments.length - 1];
      if (last.length > 20 || /\d{3,}/.test(last)) return true;
    }
    return false;
  }

  // Public API
  return { analyze, getSiteDomain };
})();
