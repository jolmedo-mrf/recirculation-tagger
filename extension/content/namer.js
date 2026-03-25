/**
 * Marfeel Recirculation Tagger v2 — Module Namer
 * Proposes human-readable names for selected elements.
 * Extracted and adapted from detector.js v1.
 */

window.MRTNamer = (() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

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

  const JUNK_CLASS_PATTERNS = [
    /^menu-item-\d+$/i,
    /^menu-item-type-/i,
    /^menu-item-object-/i,
    /^menu-item-has-children$/i,
    /^menu-item$/i,
    /^nav-item$/i,
    /^current[-_]?menu[-_]?item/i,
    /^page[-_]item/i,
    /^page-item-\d+$/i,
    /^widget[-_]\d+$/i,
    /^wp-block-/i,
    /^post-\d+$/i,
    /^category-\d+$/i,
    /^tag-\d+$/i,
    /^js-/i,
    /^is-/i,
    /^has-/i,
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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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

  function deriveNameFromAttrs(el) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith('data-') && attr.value && attr.value.length > 2 && !/^\d+$/.test(attr.value)) {
        if (attr.name.startsWith('data-mrf')) continue;
        if (['data-reactid', 'data-reactroot', 'data-testid'].includes(attr.name)) continue;
        return cleanName(attr.value);
      }
    }
    if (el.id && !/^(ember|react|ng-)\d+/.test(el.id)) return cleanName(el.id);
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    return null;
  }

  function bestClassName(el) {
    const classes = [...(el.classList || [])];
    const filtered = filterJunkClasses(classes);
    if (!filtered.length) return null;
    const best = filtered.sort((a, b) => b.length - a.length)[0];
    return cleanName(best);
  }

  /**
   * Try to find a heading inside or just before the element
   * that describes the module (e.g., "Lo más leído", "Related Stories")
   */
  function findHeading(el) {
    const headings = el.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="heading"]');
    for (const h of headings) {
      const text = (h.textContent || '').trim();
      // Only use short headings (likely section titles, not article headlines)
      if (text.length > 2 && text.length < 50) return text;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Category + name rules
  // ---------------------------------------------------------------------------

  const CATEGORY_RULES = [
    [['hero', 'centerpiece', 'opening'], 'recirculation', 'Hero'],
    [['featured', 'spotlight'], 'recirculation', 'Featured Stories'],
    [['editor', 'pick'], 'recirculation', "Editor's Pick"],
    [['top-news', 'breaking', 'headline'], 'recirculation', 'Top News'],
    [['latest', 'recent', 'newest'], 'recirculation', 'Latest News'],
    [['popular', 'trending', 'most-read', 'mostpopular'], 'recirculation', 'Most Popular'],
    [['related', 'also-read', 'tracklink', 'more-stories'], 'recirculation', 'Also Read'],
    [['recommend', 'for-you', 'suggested'], 'recirculation', 'Recommended'],
    [['section', 'category', 'topic', 'tag'], 'recirculation', 'Sections'],
    [['sidebar', 'aside', 'rail'], 'recirculation', 'Sidebar'],
    [['river', 'feed', 'stream'], 'recirculation', 'River'],
    [['promo', 'promoted', 'promotion'], 'affiliate', 'Promo / Sponsored'],
    [['widget'], 'recirculation', 'Widget'],
    [['carousel', 'slider', 'swiper'], 'recirculation', 'Carousel'],
    [['affiliate', 'sponsored', 'partner', 'advert'], 'affiliate', 'Sponsored Content'],
    [['cta', 'buy', 'ticket', 'subscribe', 'donate', 'advertise'], 'cta', 'CTA'],
    [['breadcrumb'], 'navigation', 'Breadcrumbs'],
    [['byline', 'author'], 'navigation', 'Byline'],
    [['footer'], 'navigation', 'Footer'],
    [['header', 'nav-', 'menu', 'navigation'], 'navigation', 'Navigation'],
  ];

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Propose a module name and category for a DOM element.
   * @param {Element} el - The element to name
   * @returns {{ name: string, category: string }}
   */
  function proposeModuleName(el) {
    const classes = [...(el.classList || [])].join(' ').toLowerCase();
    const elId = (el.id || '').toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    let identifiers = `${classes} ${elId} ${ariaLabel}`;

    const MODULE_DATA_ATTRS = window.MRTSelectorEngine?.MODULE_DATA_ATTRS || [];
    for (const attr of MODULE_DATA_ATTRS) {
      const val = el.getAttribute(attr);
      if (val) identifiers += ` ${val.toLowerCase()}`;
    }

    // Try keyword rules
    for (const [keywords, category, defaultName] of CATEGORY_RULES) {
      if (keywords.some(k => {
        const re = new RegExp(`(?:^|[\\s_-])${k}(?:$|[\\s_-])`, 'i');
        return re.test(identifiers);
      })) {
        // Try to find a more specific name
        const heading = findHeading(el);
        if (heading) return { name: heading, category };
        const attrName = deriveNameFromAttrs(el);
        if (attrName && attrName !== defaultName) return { name: attrName, category };
        return { name: defaultName, category };
      }
    }

    // Fallback: try to derive name from attributes or classes
    const heading = findHeading(el);
    if (heading) return { name: heading, category: 'recirculation' };
    const attrName = deriveNameFromAttrs(el);
    if (attrName) return { name: attrName, category: 'recirculation' };
    const className = bestClassName(el);
    if (className) return { name: className, category: 'recirculation' };

    // Last resort: tag name
    const tag = el.tagName.toLowerCase();
    return { name: `${tag.charAt(0).toUpperCase() + tag.slice(1)} Module`, category: 'recirculation' };
  }

  return { proposeModuleName };
})();
