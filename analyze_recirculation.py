#!/usr/bin/env python3
"""
Marfeel Recirculation Tagger
Analyzes web pages to detect recirculation modules and generate CSS selectors
for Marfeel's no-code Tag Experience configuration.

Usage:
    python3 analyze_recirculation.py <homepage_url> [article_url1] [article_url2] [article_url3]
"""

import sys
import re
import json
import argparse
from urllib.parse import urlparse, urljoin
from collections import defaultdict, Counter
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup, Tag


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class LinkInfo:
    """A single link found on the page."""
    href: str
    text: str
    is_internal: bool
    is_external: bool
    is_social: bool
    is_affiliate: bool
    element_path: str  # simplified DOM path for grouping


@dataclass
class ModuleCandidate:
    """A detected cluster of links that forms a recirculation module."""
    selector: str
    name: str
    page_type: str  # "Home" or "Article"
    link_count: int
    sample_links: List[str]
    confidence: str  # "high", "medium", "low"
    category: str  # "recirculation", "navigation", "body_links", "cta", "affiliate"
    description: str
    found_in_urls: List[str] = field(default_factory=list)
    matched_elements: int = 0  # live querySelectorAll count
    matched_links: int = 0  # links found inside matched elements


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SOCIAL_DOMAINS = {
    'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com',
    'pinterest.com', 'youtube.com', 'tiktok.com', 'whatsapp.com', 't.me',
    'telegram.org', 'reddit.com', 'tumblr.com',
}

# Third-party recommendation / ad widgets — never tag these
THIRD_PARTY_WIDGETS = {
    'taboola', 'outbrain', 'revcontent', 'mgid', 'content.ad',
    'nativo', 'sharethrough', 'triplelift', 'zergnet',
}

# Marfeel's own recommender attributes — skip elements that are Marfeel-injected
# recommender containers (not site-native modules with Marfeel tracking)
MARFEEL_RECOMMENDER_ATTRS = {
    'data-mrf-recirculation', 'data-mrf-experience', 'data-mrf-module',
}

SHARE_PATTERNS = [
    'share', 'sharer', 'intent/tweet', 'pin/create', 'shareArticle',
    'send?text', 'wa.me', 'api.whatsapp',
]

SKIP_HREF_PATTERNS = [
    r'^#', r'^javascript:', r'^mailto:', r'^tel:', r'^data:',
]

# Selectors to skip — these are UI elements, not recirculation
SKIP_SELECTORS = [
    'nav', 'header nav', 'footer nav',  # main navigation
]

# Attribute names that often identify modules
MODULE_DATA_ATTRS = [
    'data-eid', 'data-module', 'data-component', 'data-block',
    'data-section', 'data-zone', 'data-region', 'data-widget',
    'data-track', 'data-area',
]

DESKTOP_VIEWPORT = {'width': 1440, 'height': 900}
MOBILE_VIEWPORT = {'width': 390, 'height': 844}

USER_AGENT_DESKTOP = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)
USER_AGENT_MOBILE = (
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) '
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
)


# ---------------------------------------------------------------------------
# Page fetcher
# ---------------------------------------------------------------------------

def fetch_page(url: str, viewport: dict, user_agent: str, pw):
    """Fetch a fully rendered page using Playwright.

    Returns (html, page, browser).  Caller must call browser.close()
    when finished (after validation).
    """
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(
        viewport=viewport,
        user_agent=user_agent,
        locale='en-US',
    )
    page = context.new_page()

    # Block images/fonts/media for speed
    page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,eot,mp4,webm}',
               lambda route: route.abort())

    try:
        # Use domcontentloaded + manual wait — networkidle can hang on ad-heavy sites
        page.goto(url, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(5000)  # settle time for JS rendering and lazy-loaded content
        html = page.content()
    except Exception as e:
        print(f"  Warning: Error loading {url}: {e}", file=sys.stderr)
        html = ""

    return html, page, browser


# ---------------------------------------------------------------------------
# Link analysis helpers
# ---------------------------------------------------------------------------

def get_site_domain(url: str) -> str:
    """Extract the base domain from a URL."""
    parsed = urlparse(url)
    parts = parsed.netloc.split('.')
    # Handle www. prefix
    if parts[0] == 'www' and len(parts) > 2:
        return '.'.join(parts[1:])
    return parsed.netloc


def is_internal_link(href: str, site_domain: str) -> bool:
    """Check if a link points to the same site."""
    if not href or href.startswith('#') or href.startswith('javascript:'):
        return False
    parsed = urlparse(href)
    if not parsed.netloc:  # relative URL
        return True
    link_domain = get_site_domain(href)
    return link_domain == site_domain or link_domain.endswith('.' + site_domain)


def is_social_link(href: str) -> bool:
    """Check if a link is to a social media platform."""
    if not href:
        return False
    parsed = urlparse(href)
    domain = parsed.netloc.lower().replace('www.', '')
    if domain in SOCIAL_DOMAINS:
        return True
    for pattern in SHARE_PATTERNS:
        if pattern in href.lower():
            return True
    return False


def is_share_button(element: Tag) -> bool:
    """Detect share/social buttons by class, aria, or data attributes."""
    classes = ' '.join(element.get('class', []))
    all_text = classes + ' ' + str(element.get('aria-label', '')) + ' ' + str(element.get('title', ''))
    all_text = all_text.lower()
    share_keywords = ['share', 'social', 'facebook', 'twitter', 'whatsapp',
                      'linkedin', 'pinterest', 'telegram', 'email-share',
                      'copy-link', 'copy_link']
    return any(kw in all_text for kw in share_keywords)


def should_skip_href(href: str) -> bool:
    """Check if this href should be ignored entirely."""
    if not href:
        return True
    for pattern in SKIP_HREF_PATTERNS:
        if re.match(pattern, href):
            return True
    # Skip third-party widget links
    href_lower = href.lower()
    for widget in THIRD_PARTY_WIDGETS:
        if widget in href_lower:
            return True
    return False


def _is_third_party_widget(element: Tag) -> bool:
    """Check if an element belongs to a third-party widget or Marfeel recommender."""
    # Walk up the DOM checking each ancestor
    current = element
    depth = 0
    while current and current.name and current.name != '[document]' and depth < 15:
        # Check id
        eid = (current.get('id') or '').lower()
        # Check classes
        classes = ' '.join(current.get('class', [])).lower()
        # Check data attributes
        data_attrs = ''
        for k, v in current.attrs.items():
            if isinstance(k, str) and k.startswith('data-') and isinstance(v, str):
                data_attrs += f' {k}={v}'
        data_attrs = data_attrs.lower()
        combined = f'{eid} {classes} {data_attrs}'

        for widget in THIRD_PARTY_WIDGETS:
            if widget in combined:
                return True

        # Taboola-specific patterns: data-item-id with ~~V1~~ or trc_ prefixed IDs
        if eid and ('trc_' in eid or 'trc-' in eid):
            return True
        data_item = current.get('data-item-id', '')
        if isinstance(data_item, str) and '~~V1~~' in data_item:
            return True

        current = current.parent
        depth += 1
    return False


# ---------------------------------------------------------------------------
# Selector generation
# ---------------------------------------------------------------------------

def generate_selector(element: Tag) -> Optional[str]:
    """
    Generate the most stable CSS selector for an element.
    Priority:
      1. #id
      2. [data-attribute="value"]
      3. [aria-label="..."]
      4. .semantic-class (exact match)
      5. [class*="keyword"] (partial — CSS Modules, hashed classes)
      6. parent > tag:nth-of-type(n) (structural position)
      7. Ancestor chain path (multi-level structural)
    """
    tag = element.name

    # 1. ID (most stable) — but skip auto-generated/numeric IDs
    if element.get('id'):
        eid = element['id']
        # Skip auto-generated IDs (React, Ember, Angular, hashed, numeric)
        if not re.match(r'^(ember|react|ng-|__|js-)\d+', eid) \
           and not re.match(r'^[a-f0-9]{6,}$', eid) \
           and not re.match(r'^m?\d[\d-]+$', eid):
            return f'{tag}#{eid}'

    # 2. Data attributes (very stable in CMS-generated sites)
    # Skip Marfeel's own attributes — we want the site's native selectors
    for attr in MODULE_DATA_ATTRS:
        if attr.startswith('data-mrf'):
            continue
        val = element.get(attr)
        if val:
            return f'{tag}[{attr}="{val}"]'

    # 2b. Other data attributes (like SFGate's data-eid*=)
    for attr_name, attr_val in element.attrs.items():
        if attr_name.startswith('data-') and isinstance(attr_val, str) and attr_val:
            # Skip Marfeel's own attributes and generic ones
            if attr_name.startswith('data-mrf'):
                continue
            if attr_name in ('data-reactid', 'data-reactroot', 'data-testid'):
                continue
            if len(attr_val) > 3 and not attr_val.isdigit():
                return f'{tag}[{attr_name}="{attr_val}"]'

    # 3. ARIA label
    aria_label = element.get('aria-label')
    if aria_label:
        return f'{tag}[aria-label="{aria_label}"]'

    # 4. Semantic classes — use compound selectors when multiple meaningful classes exist
    classes = element.get('class', [])
    if classes:
        # Filter out utility/layout classes
        semantic = [c for c in classes if not _is_utility_class(c)]
        if semantic:
            # Prefer the most specific/descriptive class
            ranked = sorted(semantic, key=lambda c: (
                -_class_specificity_score(c), -len(c)
            ))
            # If multiple semantic classes, use compound selector for precision
            # E.g., .o-container.o-container-board or .news-category-top.lifestyleNews
            if len(ranked) >= 2 and _class_specificity_score(ranked[0]) == _class_specificity_score(ranked[1]):
                # Two equally specific classes — compound is more precise
                return f'.{ranked[0]}.{ranked[1]}'
            return f'.{ranked[0]}'

    # 5. Partial class match — for CSS Modules / hashed classes
    # e.g., class="Module_sidebar_a3f2b" → [class*="Module_sidebar"]
    if classes:
        partial = _partial_class_selector(classes)
        if partial:
            return partial

    # 6. Structural: parent > tag:nth-of-type(n)
    structural = _structural_selector(element)
    if structural:
        return structural

    return None


def _partial_class_selector(classes: list) -> Optional[str]:
    """Generate a [class*="..."] selector for CSS Modules / hashed classes.

    Targets classes like "Module_sidebar_a3f2b" or "styles__hero--xK9p2"
    by extracting the stable prefix before the hash.
    """
    # Patterns: Word_Word_hash, word__word--hash, Word-hash
    hash_patterns = [
        # CSS Modules: Module_sidebar_a3f2b → "Module_sidebar"
        re.compile(r'^([A-Z]\w+_\w+)_[a-zA-Z0-9]{4,}$'),
        # CSS Modules variant: styles__hero--xK9p2 → "styles__hero"
        re.compile(r'^(\w+__\w+)--[a-zA-Z0-9]{4,}$'),
        # Styled-components / Emotion: sc-abc123 → skip (too generic)
        # Next.js CSS Modules: Component_name__hash → "Component_name"
        re.compile(r'^([A-Z][a-zA-Z]+_[a-z]\w+)__[a-zA-Z0-9]{4,}$'),
    ]

    for cls in classes:
        for pattern in hash_patterns:
            m = pattern.match(cls)
            if m:
                stable_prefix = m.group(1)
                # Verify the prefix has a module-identifying keyword
                if _class_specificity_score(stable_prefix) > 0 or len(stable_prefix) > 8:
                    return f'[class*="{stable_prefix}"]'

    # Fallback: any class containing a high-value keyword, even if hashed
    high_value = ['article', 'news', 'widget', 'module', 'sidebar', 'related',
                  'trending', 'popular', 'featured', 'carousel', 'recommend',
                  'story', 'post', 'feed', 'hero', 'slider']
    for cls in classes:
        cls_lower = cls.lower()
        for kw in high_value:
            if kw in cls_lower and len(cls) > len(kw) + 3:
                # Use the keyword as a contains match
                return f'[class*="{kw}"]'

    return None


def _structural_selector(element: Tag) -> Optional[str]:
    """Generate a structural CSS selector using position and ancestry.

    Builds selectors like:
      main > section:nth-of-type(2)
      .content > div:nth-of-type(3) > ul
      article > section:first-child
    """
    # Build a path walking up from element to a stable anchor
    path_parts = []
    current = element
    depth = 0

    while current and current.name and current.name != '[document]' and depth < 5:
        tag = current.name

        # If we hit an element with a stable anchor (id, class, data-attr), stop
        anchor = _stable_anchor(current)
        if anchor and depth > 0:
            # We found a stable ancestor — use it as the root
            path_parts.append(anchor)
            break

        # Calculate nth-of-type position among siblings
        position_part = _nth_of_type_part(current)
        path_parts.append(position_part)

        current = current.parent
        depth += 1

    if len(path_parts) < 2:
        return None

    # Reverse to get root-first order, join with >
    path_parts.reverse()
    return ' > '.join(path_parts)


def _stable_anchor(element: Tag) -> Optional[str]:
    """Return a short selector if this element has a stable identity."""
    # ID — skip auto-generated/numeric IDs
    if element.get('id'):
        eid = element['id']
        if not re.match(r'^(ember|react|ng-|__|js-)\d+', eid) \
           and not re.match(r'^[a-f0-9]{6,}$', eid) \
           and not re.match(r'^m?\d[\d-]+$', eid):
            return f'{element.name}#{eid}'

    # Semantic class
    classes = element.get('class', [])
    semantic = [c for c in classes if not _is_utility_class(c) and _class_specificity_score(c) > 0]
    if semantic:
        ranked = sorted(semantic, key=lambda c: -_class_specificity_score(c))
        return f'.{ranked[0]}'

    # Semantic HTML tags that are usually unique or near-unique
    if element.name in ('main', 'header', 'footer', 'nav', 'aside'):
        return element.name

    return None


def _nth_of_type_part(element: Tag) -> str:
    """Build a tag:nth-of-type(n) or tag:first-child / tag:last-child part."""
    tag = element.name
    parent = element.parent
    if not parent or parent.name == '[document]':
        return tag

    # Count same-tag siblings
    same_tag_siblings = [
        child for child in parent.children
        if isinstance(child, Tag) and child.name == tag
    ]

    if len(same_tag_siblings) <= 1:
        # Only child of this tag type — plain tag is enough
        return tag

    # Find position (1-based)
    position = 0
    for i, sibling in enumerate(same_tag_siblings):
        if sibling is element:
            position = i + 1
            break

    total = len(same_tag_siblings)

    if position == 1:
        return f'{tag}:first-of-type'
    elif position == total:
        return f'{tag}:last-of-type'
    else:
        return f'{tag}:nth-of-type({position})'


def _simple_selector(element: Tag) -> Optional[str]:
    """Generate a simple selector for context."""
    # Stable anchor first (id, semantic class, semantic tag)
    anchor = _stable_anchor(element)
    if anchor:
        return anchor
    # Fallback: any non-generic tag
    if element.name not in ('div', 'span', 'section'):
        return element.name
    return None


def _is_utility_class(cls: str) -> bool:
    """Check if a class is a utility/layout class (not semantically meaningful).

    Exception: classes that contain a high-value keyword are NOT utility even
    if they start with a utility prefix. E.g., `.u-bg-salud` contains 'salud'
    which is domain-specific; `.exclusive-wrapper` contains 'exclusive'.
    """
    utility_prefixes = [
        'col-', 'row-', 'flex-', 'grid-', 'p-', 'px-', 'py-', 'pt-', 'pb-',
        'm-', 'mx-', 'my-', 'mt-', 'mb-', 'w-', 'h-', 'd-', 'bg-',
        'text-', 'font-', 'border-', 'rounded-', 'shadow-', 'opacity-',
        'hidden', 'visible', 'block', 'inline', 'relative', 'absolute',
        'overflow-', 'z-', 'cursor-', 'transition-', 'transform-',
        'animate-', 'duration-', 'ease-', 'delay-',
        'justify-', 'align-', 'items-', 'self-', 'order-', 'gap-',
        'min-', 'max-', 'aspect-', 'object-', 'float-',
        'u-grid-', 'u-flex-', 'u-col-', 'u-border', 'u-nomargin', 'u-margin',
        'u-bg-',
        # Foundation grid classes (24tv.ua, etc.)
        'small-', 'medium-', 'large-', 'xlarge-',
        # Size classes (eldebate.com)
        'size-',
    ]
    utility_exact = {
        'container', 'wrapper', 'inner', 'outer', 'clearfix', 'cf',
        'active', 'disabled', 'show', 'hide', 'open', 'closed',
        'left', 'right', 'center', 'top', 'bottom',
        'ignore-parser', 'stretched-link',
        # Foundation grid
        'cell', 'columns', 'row', 'column',
    }
    cls_lower = cls.lower()

    # If the class contains a semantic keyword, it's NOT utility regardless
    # of prefix. E.g., .u-bg-salud, .exclusive-wrapper, .o-section-opinion
    semantic_rescue = [
        'opinion', 'deporte', 'sport', 'salud', 'health', 'lifestyle',
        'obituar', 'exclusive', 'storify', 'blogger', 'columnist',
        'lomas', 'popular', 'trending', 'breaking', 'highlight',
        'featured', 'recommend', 'related', 'sidebar', 'carousel',
        'slider', 'widget', 'module', 'section', 'article', 'news',
        'board', 'special', 'theme',
    ]
    if any(kw in cls_lower for kw in semantic_rescue):
        return False

    if cls_lower in utility_exact:
        return True
    return any(cls_lower.startswith(p) for p in utility_prefixes)


def _class_specificity_score(cls: str) -> int:
    """Score a class name by how likely it is to identify a specific module."""
    cls_lower = cls.lower()
    score = 0

    # Module-identifying keywords get high scores
    high_value = ['news', 'article', 'post', 'story', 'hero', 'sidebar',
                  'widget', 'module', 'latest', 'popular', 'trending',
                  'related', 'featured', 'carousel', 'slider', 'promo',
                  'recommend', 'footer', 'header', 'content', 'body',
                  'section', 'category', 'tag', 'breadcrumb', 'byline']
    for kw in high_value:
        if kw in cls_lower:
            score += 10

    # BEM-style classes are usually very specific
    if '__' in cls or '--' in cls:
        score += 5

    # Hyphenated names tend to be more descriptive
    if '-' in cls:
        score += 2

    return score


# ---------------------------------------------------------------------------
# Module detection
# ---------------------------------------------------------------------------

def find_link_clusters(soup: BeautifulSoup, page_url: str) -> List[dict]:
    """
    Find clusters of links in the DOM. A cluster is a common ancestor
    element that contains multiple links.
    """
    site_domain = get_site_domain(page_url)
    clusters = []

    # Find all <a> tags with href
    all_links = soup.find_all('a', href=True)

    # Group links by their closest meaningful ancestor
    ancestor_groups = defaultdict(list)

    for link in all_links:
        href = link.get('href', '')
        if should_skip_href(href):
            continue

        # Resolve relative URLs
        full_href = urljoin(page_url, href)

        # Skip social/share links
        if is_social_link(full_href) or is_share_button(link):
            continue

        # Skip links inside third-party widgets (Taboola, Outbrain, etc.)
        if _is_third_party_widget(link):
            continue

        # Find the closest meaningful ancestor
        ancestor = _find_module_ancestor(link)
        if ancestor:
            ancestor_id = id(ancestor)
            ancestor_groups[ancestor_id].append({
                'element': link,
                'href': full_href,
                'text': link.get_text(strip=True)[:100],
                'is_internal': is_internal_link(full_href, site_domain),
                'ancestor': ancestor,
            })

    # Convert groups to clusters
    for ancestor_id, links in ancestor_groups.items():
        if not links:
            continue

        ancestor = links[0]['ancestor']
        internal_count = sum(1 for l in links if l['is_internal'])

        # Skip clusters with zero internal links (pure external/nav)
        if internal_count == 0:
            continue
        if len(links) < 1:
            continue

        selector = generate_selector(ancestor)
        if not selector:
            continue

        clusters.append({
            'ancestor': ancestor,
            'selector': selector,
            'links': links,
            'total_links': len(links),
            'internal_links': internal_count,
            'external_links': len(links) - internal_count,
        })

    # Second pass: detect link-card patterns where <a> tags ARE the article cards
    # (e.g., <a class="news-article news-article--highlighted-news">)
    card_clusters = _detect_link_card_patterns(soup, page_url, site_domain)
    clusters.extend(card_clusters)

    # Third pass: detect body paragraph links and list links separately
    body_clusters = _detect_body_sub_clusters(soup, page_url, site_domain)
    clusters.extend(body_clusters)

    # Fourth pass: detect individual significant elements (CTAs, track links,
    # recommender containers) that may not form clusters but are worth tagging
    individual_clusters = _detect_individual_elements(soup, page_url, site_domain)
    clusters.extend(individual_clusters)

    # Fifth pass: detect recirculation containers by class name patterns
    container_clusters = _detect_recirculation_containers(soup, page_url, site_domain)
    clusters.extend(container_clusters)

    # Sixth pass: detect <article> elements as recirculation cards
    # (e.g., cope.es uses <article class="c-detail c-detail--article">)
    article_clusters = _detect_article_element_cards(soup, page_url, site_domain)
    clusters.extend(article_clusters)

    # Seventh pass: detect topic-specific sub-sections within containers
    # (e.g., .news-category-top.lifestyleNews vs .news-category-top.mensNews)
    topic_clusters = _detect_topic_splitters(soup, page_url, site_domain)
    clusters.extend(topic_clusters)

    return clusters


def _detect_link_card_patterns(soup: BeautifulSoup, page_url: str, site_domain: str) -> List[dict]:
    """
    Detect patterns where <a> tags ARE the article cards (not children of a container).
    E.g., <a class="news-article news-article--highlighted-news" href="...">.

    Generates two types of selectors (never prefixed with 'a.'):
    1. Link-type selectors using the card's own classes:
       .news-article  (base class — matches all card links of this type)
       .news-article.news-article--highlighted-news  (compound — matches specific variant)
    2. Container + link-type selectors when a meaningful parent exists:
       .widget--ratingcero .news-article  (scoped to a specific module)
    """
    results = []

    card_keywords = [
        'news-article', 'article-card', 'post-card', 'story-card',
        'card-item', 'news-card', 'content-card', 'feed-item',
        'news-item', 'story-item', 'article-item',
    ]

    all_card_links = soup.find_all('a', href=True, class_=True)

    # Group links by their full compound class signature (all card-matching classes joined)
    class_groups = defaultdict(list)

    for link in all_card_links:
        if _is_third_party_widget(link):
            continue
        href = link.get('href', '')
        if should_skip_href(href):
            continue
        full_href = urljoin(page_url, href)
        if is_social_link(full_href) or is_share_button(link):
            continue

        classes = link.get('class', [])
        matching_classes = [c for c in classes if any(kw in c.lower() for kw in card_keywords)]
        if not matching_classes:
            continue

        # Build compound class key: all matching classes joined
        # e.g., "news-article.news-article--highlighted-news"
        compound_key = '.'.join(sorted(matching_classes))

        class_groups[compound_key].append({
            'element': link,
            'href': full_href,
            'text': link.get_text(strip=True)[:100],
            'is_internal': is_internal_link(full_href, site_domain),
            'ancestor': link,
        })

    # Convert groups into clusters
    for compound_key, links in class_groups.items():
        if not links:
            continue

        # Build the class-only selector (no 'a.' prefix)
        parts = compound_key.split('.')
        selector = ''.join(f'.{p}' for p in parts)

        sample_el = links[0]['element']
        parent = sample_el.parent if sample_el.parent and sample_el.parent.name != '[document]' else sample_el

        # Check if there's a meaningful parent container we can scope to
        container_sel = _find_scoping_container(sample_el)
        if container_sel:
            scoped_selector = f'{container_sel} {selector}'
            # Add both: scoped (container + link-type) and unscoped (link-type only)
            results.append({
                'ancestor': parent,
                'selector': scoped_selector,
                'links': links,
                'total_links': len(links),
                'internal_links': sum(1 for l in links if l['is_internal']),
                'external_links': sum(1 for l in links if not l['is_internal']),
                '_force_category': 'recirculation',
                '_force_name': _clean_name(compound_key.split('.')[-1]),
            })

        # Always add the unscoped link-type selector
        results.append({
            'ancestor': parent,
            'selector': selector,
            'links': links,
            'total_links': len(links),
            'internal_links': sum(1 for l in links if l['is_internal']),
            'external_links': sum(1 for l in links if not l['is_internal']),
            '_force_category': 'recirculation',
            '_force_name': _clean_name(compound_key.split('.')[-1]),
        })

    return results


def _find_scoping_container(link: Tag) -> Optional[str]:
    """
    Walk up from a link to find a meaningful parent container that could
    scope this link type to a specific module (e.g., .widget--ratingcero).
    Returns a CSS selector for the container, or None.
    """
    current = link.parent
    depth = 0
    while current and current.name != '[document]' and depth < 8:
        classes = current.get('class', [])
        # Look for classes with module-like keywords
        for cls in classes:
            cls_lower = cls.lower()
            scope_keywords = [
                'widget', 'module', 'sidebar', 'ratingcero', 'rating',
                'agenda', 'carousel', 'slider', 'spotlight', 'hero',
                'featured', 'trending', 'popular', 'breaking',
            ]
            if any(kw in cls_lower for kw in scope_keywords):
                return f'.{cls}'
        current = current.parent
        depth += 1
    return None


def _detect_recirculation_containers(soup: BeautifulSoup, page_url: str, site_domain: str) -> List[dict]:
    """
    Detect recirculation containers by class name patterns commonly used
    in CMS-generated sites: related-links, related-news, recommended-news,
    last-news, agenda-caliente, etc.
    """
    results = []
    found_selectors = set()

    # Patterns: class substring to search for
    container_patterns = [
        'related-links', 'related-news', 'recommended-news', 'recommended-articles',
        'related-articles', 'related-posts', 'related-stories',
        'last-news', 'latest-news', 'ultimas-noticias',
        'agenda-caliente', 'breaking-news',
        'most-read', 'most-popular', 'mas-leidas', 'lomas',
        'also-read', 'te-puede-interesar',
        'widget-wrapper',
        'last-news-column-image', 'last-news-column-without-image',
        # Section-specific containers (eldebate, cope, etc.)
        'section-opinion', 'section-obituary', 'section-deporte',
        'section-border', 'section-sport',
        'container-board',
        # Storify / slider / carousel containers
        'storify', 'bloggers-slider', 'exclusive-wrapper',
        'special-theme-wrapper',
        # Listing patterns
        'listing_lomas', 'listing-article', 'listing-news',
    ]

    for pattern in container_patterns:
        elements = soup.find_all(class_=re.compile(re.escape(pattern), re.IGNORECASE))
        for el in elements:
            if _is_third_party_widget(el):
                continue

            # Find links inside this container
            links_in_el = el.find_all('a', href=True)
            if not links_in_el:
                continue

            # Prefer the matched class as selector (more stable than generate_selector)
            # Use all matching classes for compound selectors (e.g., .widget-wrapper.widget-wrapper--r0)
            matched_classes = [cls for cls in el.get('class', []) if pattern.lower() in cls.lower()]
            if matched_classes:
                sel = ''.join(f'.{cls}' for cls in matched_classes)
            else:
                sel = generate_selector(el)
            if not sel or sel in found_selectors:
                continue

            link_data = []
            for link in links_in_el:
                href = link.get('href', '')
                if should_skip_href(href):
                    continue
                full_href = urljoin(page_url, href)
                if is_social_link(full_href) or is_share_button(link):
                    continue
                if _is_third_party_widget(link):
                    continue
                link_data.append({
                    'element': link,
                    'href': full_href,
                    'text': link.get_text(strip=True)[:100],
                    'is_internal': is_internal_link(full_href, site_domain),
                    'ancestor': el,
                })

            if link_data:
                found_selectors.add(sel)
                results.append({
                    'ancestor': el,
                    'selector': sel,
                    'links': link_data,
                    'total_links': len(link_data),
                    'internal_links': sum(1 for l in link_data if l['is_internal']),
                    'external_links': sum(1 for l in link_data if not l['is_internal']),
                    '_force_category': 'recirculation',
                    '_force_name': _clean_name(pattern),
                })

    return results


def _detect_article_element_cards(soup: BeautifulSoup, page_url: str, site_domain: str) -> List[dict]:
    """
    Detect <article> elements used as recirculation cards.

    Many sites (e.g., cope.es, eldebate.com) use <article> tags as card
    containers with links inside. These are distinct from <a>-based card
    patterns detected by _detect_link_card_patterns.

    Groups <article> elements by their class signature and generates
    selectors like:
      article.c-detail.c-detail--article
      article.c-article
      article.c-lomas__article
    """
    results = []
    found_selectors = set()

    all_articles = soup.find_all('article', class_=True)
    if not all_articles:
        return results

    # Group articles by their class signature
    class_groups = defaultdict(list)

    for article in all_articles:
        if _is_third_party_widget(article):
            continue

        # Find links inside this article
        links_in_article = article.find_all('a', href=True)
        if not links_in_article:
            continue

        link_data = []
        for link in links_in_article:
            href = link.get('href', '')
            if should_skip_href(href):
                continue
            full_href = urljoin(page_url, href)
            if is_social_link(full_href) or is_share_button(link):
                continue
            if _is_third_party_widget(link):
                continue
            link_data.append({
                'element': link,
                'href': full_href,
                'text': link.get_text(strip=True)[:100],
                'is_internal': is_internal_link(full_href, site_domain),
                'ancestor': article,
            })

        if not link_data:
            continue

        # Build class signature using only semantic classes (max 3)
        # This prevents selector explosion from utility/modifier combos
        classes = article.get('class', [])
        semantic = [c for c in classes if not _is_utility_class(c)]
        # If no semantic classes, use the first 2 non-utility classes
        if not semantic:
            semantic = classes[:2]
        # Limit to 3 most specific classes
        ranked = sorted(semantic, key=lambda c: (-_class_specificity_score(c), -len(c)))
        sig_classes = ranked[:3]
        class_key = '.'.join(sorted(sig_classes))
        class_groups[class_key].append({
            'article': article,
            'links': link_data,
            'all_classes': classes,
        })

    # Convert groups into clusters — only groups with 2+ articles to avoid noise
    for class_key, articles in class_groups.items():
        if len(articles) < 2:
            continue

        classes = class_key.split('.')
        # Build selector: article.class1.class2
        selector = 'article.' + '.'.join(classes)

        if selector in found_selectors:
            continue
        found_selectors.add(selector)

        # Merge all links from all articles with this class signature
        all_links = []
        for item in articles:
            all_links.extend(item['links'])

        if not all_links:
            continue

        # Derive name from the most specific class
        semantic = [c for c in classes if not _is_utility_class(c)]
        name = _clean_name(semantic[-1]) if semantic else _clean_name(classes[-1])

        results.append({
            'ancestor': articles[0]['article'],
            'selector': selector,
            'links': all_links,
            'total_links': len(all_links),
            'internal_links': sum(1 for l in all_links if l['is_internal']),
            'external_links': sum(1 for l in all_links if not l['is_internal']),
            '_force_category': 'recirculation',
            '_force_name': name,
        })

    return results


def _detect_topic_splitters(soup: BeautifulSoup, page_url: str, site_domain: str) -> List[dict]:
    """
    Detect containers that repeat with a shared base class but differ by a
    topic-specific modifier class. E.g., 24tv.ua has:
      <div class="news-category-top lifestyleNews">
      <div class="news-category-top mensNews">

    These should be tagged separately because they represent different
    editorial sections. Generates compound selectors like:
      .news-category-top.lifestyleNews
      .news-category-top.mensNews
    """
    results = []
    found_selectors = set()

    # Find elements that share a base class with siblings but differ by modifier
    # Strategy: find all elements with 2+ classes where one is shared and another is unique
    all_elements_with_classes = soup.find_all(class_=True)

    # Group by parent + base class
    parent_groups = defaultdict(lambda: defaultdict(list))

    for el in all_elements_with_classes:
        parent = el.parent
        if not parent or parent.name == '[document]':
            continue

        classes = el.get('class', [])
        if len(classes) < 2:
            continue

        # Skip non-recirculation elements
        if _is_non_recirculation_element(el):
            continue
        if _is_third_party_widget(el):
            continue

        # Check if has internal links
        links = el.find_all('a', href=True)
        internal_links = []
        for link in links:
            href = link.get('href', '')
            if should_skip_href(href):
                continue
            full_href = urljoin(page_url, href)
            if is_social_link(full_href) or is_share_button(link):
                continue
            if is_internal_link(full_href, site_domain):
                internal_links.append({
                    'element': link,
                    'href': full_href,
                    'text': link.get_text(strip=True)[:100],
                    'is_internal': True,
                    'ancestor': el,
                })

        if len(internal_links) < 2:
            continue

        # For each class, check if it's shared with siblings
        for base_cls in classes:
            parent_groups[id(parent)][base_cls].append({
                'element': el,
                'all_classes': classes,
                'links': internal_links,
            })

    # Now find base classes that have 2+ siblings with different modifiers
    for parent_id, base_groups in parent_groups.items():
        for base_cls, siblings in base_groups.items():
            if len(siblings) < 2:
                continue

            # Check that siblings have different extra classes (the topic modifiers)
            modifier_sets = []
            for sib in siblings:
                modifiers = [c for c in sib['all_classes'] if c != base_cls]
                modifier_sets.append(tuple(sorted(modifiers)))

            # If all siblings have the same modifiers, this isn't a topic splitter
            if len(set(modifier_sets)) <= 1:
                continue

            # Generate a compound selector for each unique sibling
            for sib in siblings:
                modifiers = [c for c in sib['all_classes'] if c != base_cls and not _is_utility_class(c)]
                if not modifiers:
                    continue

                # Build compound selector: .base.modifier
                selector = f'.{base_cls}.{modifiers[0]}'
                if selector in found_selectors:
                    continue
                found_selectors.add(selector)

                # Derive name from the modifier class
                name = _clean_name(modifiers[0])
                # Try editorial heading first
                editorial = _find_editorial_heading(sib['element'])
                if editorial:
                    name = editorial

                results.append({
                    'ancestor': sib['element'],
                    'selector': selector,
                    'links': sib['links'],
                    'total_links': len(sib['links']),
                    'internal_links': len(sib['links']),
                    'external_links': 0,
                    '_force_category': 'recirculation',
                    '_force_name': name,
                })

    return results


def _detect_body_sub_clusters(soup: BeautifulSoup, page_url: str, site_domain: str) -> List[dict]:
    """
    Detect paragraph links and list links inside article body containers.
    These get separate selectors like '.article-body p' and '.article-body li'.
    """
    body_selectors = [
        'article-body', 'article__body', 'articleBody', 'entry-content',
        'post-content', 'story-body', 'single-news-content', 'article-content',
        'post-body', 'content-body',
    ]

    sub_clusters = []

    for body_cls in body_selectors:
        # Try as class
        body_el = soup.find(class_=re.compile(body_cls, re.IGNORECASE))
        if not body_el:
            # Try as id
            body_el = soup.find(id=re.compile(body_cls, re.IGNORECASE))
        if not body_el:
            continue

        # Get the body selector
        body_selector = generate_selector(body_el)
        if not body_selector:
            continue

        # Find links in <p> tags (paragraph links / inline editorial links)
        p_links = []
        for p in body_el.find_all('p', recursive=True):
            for link in p.find_all('a', href=True):
                href = link.get('href', '')
                if should_skip_href(href):
                    continue
                full_href = urljoin(page_url, href)
                if is_social_link(full_href):
                    continue
                p_links.append({
                    'element': link,
                    'href': full_href,
                    'text': link.get_text(strip=True)[:100],
                    'is_internal': is_internal_link(full_href, site_domain),
                    'ancestor': body_el,
                })

        if p_links:
            sub_clusters.append({
                'ancestor': body_el,
                'selector': f'{body_selector} p',
                'links': p_links,
                'total_links': len(p_links),
                'internal_links': sum(1 for l in p_links if l['is_internal']),
                'external_links': sum(1 for l in p_links if not l['is_internal']),
                '_force_category': 'body_links',
                '_force_name': 'Paragraph Links',
            })

        # Find links in <li> tags (related posts, embedded lists)
        li_links = []
        for li in body_el.find_all('li', recursive=True):
            for link in li.find_all('a', href=True):
                href = link.get('href', '')
                if should_skip_href(href):
                    continue
                full_href = urljoin(page_url, href)
                if is_social_link(full_href):
                    continue
                li_links.append({
                    'element': link,
                    'href': full_href,
                    'text': link.get_text(strip=True)[:100],
                    'is_internal': is_internal_link(full_href, site_domain),
                    'ancestor': body_el,
                })

        if li_links:
            sub_clusters.append({
                'ancestor': body_el,
                'selector': f'{body_selector} li',
                'links': li_links,
                'total_links': len(li_links),
                'internal_links': sum(1 for l in li_links if l['is_internal']),
                'external_links': sum(1 for l in li_links if not l['is_internal']),
                '_force_category': 'body_links',
                '_force_name': 'Related Posts',
            })

    return sub_clusters


def _detect_individual_elements(soup: BeautifulSoup, page_url: str, site_domain: str) -> List[dict]:
    """
    Detect individual elements worth tagging that don't form large clusters:
    - CTA buttons (buy, tickets, subscribe, donate)
    - Track links (also-read, tracklink, outbound-link)
    - Recommender containers (native CMS recommendation modules)
    """
    results = []

    # Patterns: (CSS class/attr pattern, category, name)
    individual_patterns = [
        # CTAs
        {'selector': '[class*="buy"]', 'match': re.compile(r'buy|ticket|purchase', re.I),
         'category': 'cta', 'name': 'Buy CTA', 'attr': 'class'},
        {'selector': '[class*="cta"]', 'match': re.compile(r'cta', re.I),
         'category': 'cta', 'name': 'CTA', 'attr': 'class'},
        {'selector': '[class*="subscribe"]', 'match': re.compile(r'subscribe|signup|sign-up', re.I),
         'category': 'cta', 'name': 'Subscribe CTA', 'attr': 'class'},
        {'selector': '[class*="donate"]', 'match': re.compile(r'donate|donation', re.I),
         'category': 'cta', 'name': 'Donate CTA', 'attr': 'class'},
        # Track links / Also Read
        {'selector': '[class*="tracklink"]', 'match': re.compile(r'tracklink|track-link', re.I),
         'category': 'recirculation', 'name': 'Also Read', 'attr': 'class'},
        {'selector': '[class*="also-read"]', 'match': re.compile(r'also.?read', re.I),
         'category': 'recirculation', 'name': 'Also Read', 'attr': 'class'},
        # Outbound/shortcode links with data attributes
        {'selector': '[data-action]', 'match': re.compile(r'data-action', re.I),
         'category': 'recirculation', 'name': 'Secondary Title Links', 'attr': 'data-action'},
        # Recommender containers
        {'selector': '[class*="recommender"]', 'match': re.compile(r'recommender|recommendation', re.I),
         'category': 'recirculation', 'name': 'Recommender Module', 'attr': 'class'},
    ]

    found_selectors = set()

    for pattern in individual_patterns:
        # Search by class attribute
        if pattern['attr'] == 'class':
            elements = soup.find_all(class_=pattern['match'])
        elif pattern['attr'] == 'data-action':
            elements = soup.find_all(attrs={'data-action': True})
        else:
            elements = []

        for el in elements:
            # Skip third-party widget elements
            if _is_third_party_widget(el):
                continue

            # Generate selector for this element
            sel = generate_selector(el)
            if not sel or sel in found_selectors:
                continue

            # Check if it contains links
            links_in_el = el.find_all('a', href=True)
            if not links_in_el:
                # If the element itself is a link
                if el.name == 'a' and el.get('href'):
                    links_in_el = [el]

            if not links_in_el:
                continue

            link_data = []
            for link in links_in_el:
                href = link.get('href', '')
                if should_skip_href(href):
                    continue
                full_href = urljoin(page_url, href)
                if is_social_link(full_href):
                    continue
                link_data.append({
                    'element': link,
                    'href': full_href,
                    'text': link.get_text(strip=True)[:100],
                    'is_internal': is_internal_link(full_href, site_domain),
                    'ancestor': el,
                })

            if link_data:
                found_selectors.add(sel)
                results.append({
                    'ancestor': el,
                    'selector': sel,
                    'links': link_data,
                    'total_links': len(link_data),
                    'internal_links': sum(1 for l in link_data if l['is_internal']),
                    'external_links': sum(1 for l in link_data if not l['is_internal']),
                    '_force_category': pattern['category'],
                    '_force_name': pattern['name'],
                })

    return results


def _find_module_ancestor(link: Tag) -> Optional[Tag]:
    """
    Walk up the DOM to find the most meaningful ancestor that represents
    a module/section containing this link.
    """
    current = link.parent
    best = None
    depth = 0

    while current and current.name != '[document]' and depth < 10:
        # Skip non-recirculation ancestors (header, footer, nav, weather)
        if _is_non_recirculation_element(current):
            return None

        # Check if this element looks like a module container
        if _is_module_container(current):
            best = current
            break

        # Check if this is a list item or article card
        if current.name in ('li', 'article', 'section', 'aside'):
            # Go one more level up to get the container
            if current.parent and current.parent.name != '[document]':
                parent = current.parent
                if _is_module_container(parent) or parent.name in ('ul', 'ol', 'section', 'aside', 'div'):
                    best = parent
                    break

        current = current.parent
        depth += 1

    # If no clear module ancestor, use the closest section/aside/article parent
    if not best:
        current = link.parent
        depth = 0
        while current and current.name != '[document]' and depth < 8:
            if current.name in ('section', 'aside', 'article', 'main', 'nav'):
                best = current
                break
            # Or a div with meaningful class/id
            if current.name == 'div' and (current.get('id') or _has_semantic_class(current)):
                best = current
                break
            current = current.parent
            depth += 1

    return best


def _is_module_container(element: Tag) -> bool:
    """Check if an element looks like a module container."""
    # Has data attribute identifying it as a module
    for attr in MODULE_DATA_ATTRS:
        if element.get(attr):
            return True

    # Has aria-label
    if element.get('aria-label'):
        return True

    # Has role
    role = element.get('role', '').lower()
    if role in ('complementary', 'contentinfo', 'navigation', 'region'):
        return True

    # Has semantic class
    if _has_semantic_class(element):
        return True

    return False


def _is_non_recirculation_element(element: Tag) -> bool:
    """Check if an element is a non-recirculation container (header, footer, nav, weather, etc.)."""
    tag = element.name
    if tag in ('header', 'footer', 'nav'):
        return True

    classes = ' '.join(element.get('class', [])).lower()
    eid = (element.get('id') or '').lower()
    combined = f'{classes} {eid}'

    non_recirc_keywords = [
        'footer', 'header', 'preheader', 'top-bar', 'top-menu',
        'main-nav', 'mega-menu', 'site-nav', 'nav-container',
        'weather', 'clima', 'forecast', 'cookie', 'gdpr', 'consent',
        'login', 'signup', 'sign-in', 'apps-logo', 'app-download',
        'copyright', 'legal', 'hidden-nav', 'subsite-top',
    ]
    return any(kw in combined for kw in non_recirc_keywords)


def _has_semantic_class(element: Tag) -> bool:
    """Check if element has semantically meaningful classes."""
    classes = element.get('class', [])
    module_keywords = [
        'widget', 'module', 'sidebar', 'related', 'trending', 'popular',
        'latest', 'recent', 'recommended', 'featured', 'hero', 'spotlight',
        'top-news', 'breaking', 'headlines', 'stories', 'articles',
        'post-list', 'card-list', 'news-box', 'content-list',
        'river', 'feed', 'stream', 'carousel', 'slider', 'gallery',
        'promo', 'editor', 'pick', 'must-read', 'dont-miss',
        'breadcrumb', 'byline', 'author', 'tag-list', 'category',
        'navigation', 'nav-', 'menu',
        'recommender', 'recirculation', 'recirc',
        'affiliate', 'sponsored', 'partner', 'ad-',
        'article-body', 'article__body', 'articleBody', 'entry-content',
        'post-content', 'story-body', 'single-news-content',
        'section-link', 'things-to-do',
        # Section-specific patterns (eldebate, cope, 24tv)
        'opinion', 'obituar', 'deporte', 'sport', 'lifestyle',
        'exclusive', 'storify', 'blogger', 'board',
        'listing', 'lomas', 'special-theme',
    ]
    for cls in classes:
        cls_lower = cls.lower()
        for keyword in module_keywords:
            if keyword in cls_lower:
                return True
    return False


# ---------------------------------------------------------------------------
# Module classification & naming
# ---------------------------------------------------------------------------

def classify_cluster(cluster: dict, page_type: str, page_url: str) -> Optional[ModuleCandidate]:
    """Classify a link cluster and assign a name."""
    ancestor = cluster['ancestor']
    selector = cluster['selector']
    links = cluster['links']
    total = cluster['total_links']
    internal = cluster['internal_links']

    # Check for forced classification (from body sub-cluster detection)
    if '_force_category' in cluster:
        category = cluster['_force_category']
        name = cluster['_force_name']
        confidence = 'high'
    else:
        # Determine category and name
        category, name, confidence = _determine_category_and_name(
            ancestor, links, page_type, page_url, selector
        )

    if not category:
        return None

    # Always try editorial headings first — h2/h3 section titles are the best
    # module names (e.g., "Opinión", "Deportes", "Lo más leído", "Leer más")
    editorial = _find_editorial_heading(ancestor)
    if editorial:
        name = editorial

    # Build sample links
    sample = [l['href'] for l in links[:5]]

    # Build description
    desc_parts = []
    if internal > 0:
        desc_parts.append(f"{internal} internal links")
    ext = total - internal
    if ext > 0:
        desc_parts.append(f"{ext} external links")
    description = ', '.join(desc_parts)

    return ModuleCandidate(
        selector=selector,
        name=f'[{page_type}] {name}',
        page_type=page_type,
        link_count=total,
        sample_links=sample,
        confidence=confidence,
        category=category,
        description=description,
        found_in_urls=[page_url],
    )


def _determine_category_and_name(
    ancestor: Tag, links: list, page_type: str, page_url: str, selector: str = ''
) -> Tuple[Optional[str], str, str]:
    """Determine the category and human-readable name for a module."""

    tag = ancestor.name
    classes = ' '.join(ancestor.get('class', [])).lower()
    element_id = (ancestor.get('id') or '').lower()
    aria_label = (ancestor.get('aria-label') or '').lower()
    text_content = ancestor.get_text(strip=True)[:200].lower()

    # Check all identifiers combined
    identifiers = f'{classes} {element_id} {aria_label}'

    # Check data attributes for naming hints
    for attr in MODULE_DATA_ATTRS:
        val = ancestor.get(attr)
        if val:
            identifiers += f' {val.lower()}'

    # --- Classification rules ---

    # Navigation (skip for recirculation)
    if tag == 'nav' or 'navigation' in identifiers or 'nav-main' in identifiers:
        if 'topic' in identifiers or 'sub' in identifiers:
            return 'navigation', _humanize_name(identifiers, 'Topic Navigation'), 'high'
        return None, '', ''  # skip main navigation

    # Header elements — always navigation, never recirculation
    if any(k in identifiers for k in ['header', 'preheader', 'top-bar', 'top-menu',
                                       'subsite-top', 'main-nav', 'mega-menu']):
        return None, '', ''

    # Footer elements — never recirculation
    if any(k in identifiers for k in ['footer', 'copyright', 'legal', 'site-map',
                                       'apps-logo', 'app-download', 'app-badge']):
        return None, '', ''

    # Weather, climate, utility widgets — not recirculation
    if any(k in identifiers for k in ['weather', 'clima', 'forecast', 'clock',
                                       'currency', 'stock-ticker']):
        return None, '', ''

    # Cookie/GDPR/login bars
    if any(k in identifiers for k in ['cookie', 'gdpr', 'consent', 'login',
                                       'signup', 'sign-in', 'register']):
        return None, '', ''

    # Body/paragraph links (always important)
    body_patterns = ['article-body', 'article__body', 'articlebody', 'entry-content',
                     'post-content', 'story-body', 'single-news-content', 'modulebody']
    if any(p in identifiers for p in body_patterns):
        # Check if this is specifically paragraph links
        if ancestor.name == 'p' or (ancestor.find('p') and 'p' in selector.split()[-1:]):
            return 'body_links', 'Paragraph Links', 'high'
        if 'recommender' in identifiers:
            return 'recirculation', 'Recommender Module', 'high'
        return 'body_links', 'Body Links', 'high'

    # Breadcrumbs
    if 'breadcrumb' in identifiers:
        return 'navigation', 'Breadcrumbs', 'high'

    # Byline / author
    if 'byline' in identifiers or 'author' in identifiers:
        return 'navigation', 'Byline', 'medium'

    # Hero / centerpiece
    if any(k in identifiers for k in ['hero', 'centerpiece', 'opening']):
        return 'recirculation', _humanize_name(identifiers, 'Hero'), 'high'

    # Featured / spotlight
    if any(k in identifiers for k in ['featured', 'spotlight', 'featured_story']):
        return 'recirculation', _humanize_name(identifiers, 'Featured Stories'), 'high'

    # Editors pick
    if any(k in identifiers for k in ['editor', 'pick', 'four_pack']):
        return 'recirculation', _humanize_name(identifiers, "Editor's Pick"), 'high'

    # Top news / breaking
    if any(k in identifiers for k in ['top-news', 'breaking', 'headline']):
        return 'recirculation', _humanize_name(identifiers, 'Top News'), 'high'

    # Latest / recent
    if any(k in identifiers for k in ['latest', 'recent', 'newest']):
        name = 'Latest News'
        if 'sidebar' in identifiers:
            name = 'Latest News Sidebar'
        return 'recirculation', name, 'high'

    # Most popular / trending
    if any(k in identifiers for k in ['popular', 'trending', 'most-read', 'mostpopular']):
        return 'recirculation', _humanize_name(identifiers, 'Most Popular'), 'high'

    # Related / also read
    if any(k in identifiers for k in ['related', 'also-read', 'tracklink', 'more-stories']):
        return 'recirculation', _humanize_name(identifiers, 'Also Read'), 'high'

    # Recommended
    if any(k in identifiers for k in ['recommend', 'for-you', 'more-for-you', 'suggested']):
        return 'recirculation', _humanize_name(identifiers, 'Recommended'), 'high'

    # Sections / categories
    if any(k in identifiers for k in ['section', 'category', 'topic', 'tag']):
        if 'link' in identifiers or 'nav' in identifiers:
            return 'recirculation', _humanize_name(identifiers, 'Section Links'), 'medium'
        return 'recirculation', _humanize_name(identifiers, 'Sections'), 'medium'

    # Sidebar
    if any(k in identifiers for k in ['sidebar', 'aside', 'rail']):
        return 'recirculation', _humanize_name(identifiers, 'Sidebar'), 'medium'

    # River / feed / stream
    if any(k in identifiers for k in ['river', 'feed', 'stream']):
        return 'recirculation', _humanize_name(identifiers, 'River'), 'high'

    # News box / generic module
    if any(k in identifiers for k in ['news-box', 'newsbox', 'news_box']):
        return 'recirculation', _humanize_name(identifiers, 'News Box'), 'medium'

    # Promo / widget
    if any(k in identifiers for k in ['promo', 'widget']):
        return 'recirculation', _humanize_name(identifiers, 'Promo Widget'), 'medium'

    # Footer — should have been caught above, but just in case
    if any(k in identifiers for k in ['footer']):
        return None, '', ''

    # Carousel / slider
    if any(k in identifiers for k in ['carousel', 'slider', 'swiper']):
        return 'recirculation', _humanize_name(identifiers, 'Carousel'), 'medium'

    # Affiliate / sponsored / partner
    if any(k in identifiers for k in ['affiliate', 'sponsored', 'partner', 'advert']):
        return 'affiliate', _humanize_name(identifiers, 'Sponsored Content'), 'high'

    # CTA / buy / tickets / subscribe
    if any(k in identifiers for k in ['cta', 'buy', 'ticket', 'subscribe', 'donate']):
        return 'cta', _humanize_name(identifiers, 'CTA'), 'high'

    # Alert bar / notification
    if any(k in identifiers for k in ['alert', 'notification', 'banner', 'bar']):
        return 'recirculation', _humanize_name(identifiers, 'News Alert Bar'), 'medium'

    # Thumbnail list / four up / package
    if any(k in identifiers for k in ['thumbnail', 'four_up', 'package']):
        return 'recirculation', _humanize_name(identifiers, 'Thumbnail List'), 'medium'

    # Things to do / specific content types
    if 'things-to-do' in identifiers or 'ttd' in identifiers:
        return 'recirculation', 'TTD Links', 'high'

    # Generic fallback — only if has enough internal links
    internal_count = sum(1 for l in links if l['is_internal'])
    if internal_count >= 3:
        # Try to derive name from data attrs or id
        name = _derive_name_from_attrs(ancestor)
        if name:
            return 'recirculation', name, 'medium'
        return 'recirculation', f'Link Module ({internal_count} links)', 'low'

    return None, '', ''


def _humanize_name(identifiers: str, default: str) -> str:
    """Try to derive a more specific name from identifiers."""
    # Check for specific data attribute values
    for attr in MODULE_DATA_ATTRS:
        # Look for patterns like dynamic_centerpiece, dynamic_river etc.
        match = re.search(r'dynamic_(\w+)', identifiers)
        if match:
            raw = match.group(1)
            return _clean_name(raw)

    return default


def _derive_name_from_attrs(element: Tag) -> Optional[str]:
    """Try to derive a human-readable name from element attributes."""
    # Check aria-label first (most editorial)
    aria = element.get('aria-label')
    if aria:
        return aria

    # Check data attributes (skip numeric/hash values)
    for attr_name, attr_val in element.attrs.items():
        if attr_name.startswith('data-') and isinstance(attr_val, str):
            if len(attr_val) > 2 and not attr_val.isdigit() \
               and not re.match(r'^[a-f0-9-]{6,}$', attr_val) \
               and not re.match(r'^m?\d[\d-]+$', attr_val):
                return _clean_name(attr_val)

    # Check id (skip auto-generated/numeric)
    eid = element.get('id')
    if eid and not re.match(r'^(ember|react|ng-)\d+', eid) \
           and not re.match(r'^m?\d[\d-]+$', eid):
        return _clean_name(eid)

    # Look for a heading inside or just before the element (editorial name)
    heading = _find_editorial_heading(element)
    if heading:
        return heading

    return None


def _find_editorial_heading(element: Tag) -> Optional[str]:
    """Find a section heading (h2, h3, h4) inside or just before an element.

    This gives us editorial names like "Lo más leído", "Opinión", "Deportes"
    instead of CSS-derived names.

    Prefers short, section-style headings (< 40 chars) over article headlines.
    """
    # Look for data-section-name, data-title, title attribute first (most reliable)
    for attr in ['data-section-name', 'data-title', 'data-label', 'title']:
        val = element.get(attr)
        if val and 3 <= len(val) <= 40:
            return val

    # Collect all headings and pick the most section-like one
    candidates = []

    # Headings inside the element
    for heading_tag in ['h2', 'h3', 'h4']:
        for heading in element.find_all(heading_tag, recursive=True):
            text = heading.get_text(strip=True)
            if text and 3 <= len(text) <= 60:
                candidates.append(text)

    # Heading in the previous sibling
    prev = element.find_previous_sibling()
    if prev:
        if prev.name in ('h2', 'h3', 'h4'):
            text = prev.get_text(strip=True)
            if text and 3 <= len(text) <= 60:
                candidates.append(text)

    if not candidates:
        return None

    # Prefer short headings (section titles) over long ones (article headlines)
    # Section titles are typically < 30 chars: "Lo más leído", "Opinión", "Deportes"
    # Article headlines are typically > 30 chars
    short = [c for c in candidates if len(c) <= 30]
    if short:
        return short[0]

    # If all headings are long (article headlines), don't use them as names
    # They change with content and make bad module names
    return None


def _clean_name(raw: str) -> str:
    """Convert a raw identifier into a human-readable module name."""
    # Remove Marfeel-injected prefixes like [Home], [Article], HP -, Article -
    raw = re.sub(r'^\[(Home|Article)\]\s*', '', raw)
    raw = re.sub(r'^(HP|Home|Article)\s*[-–]\s*', '', raw)
    # Remove common prefixes
    raw = re.sub(r'^(dynamic_|module_|widget_|block_)', '', raw)
    # For BEM-style classes, extract the most descriptive part
    # e.g., "news-article--highlighted-news" → "Highlighted News"
    if '--' in raw:
        # Take the modifier part (after --)
        parts = raw.split('--')
        modifier = parts[-1]  # last modifier
        # But keep base if modifier is too short
        if len(modifier) > 2:
            raw = modifier
        else:
            # Use the base part if modifier is empty/tiny
            raw = parts[0]
    # Remove BEM element separator and clean up
    raw = re.sub(r'__', ' ', raw)
    # Remove base class prefixes like "news-article-" from the beginning
    raw = re.sub(r'^(news|article|post|story|content|widget|n)[_-]', '', raw, flags=re.IGNORECASE)
    # Remove repeated word prefixes (e.g., "article article" from n-article__news-article)
    raw = re.sub(r'^(news|article)\s+\1', r'\1', raw, flags=re.IGNORECASE)
    # Split on underscores, hyphens, camelCase
    parts = re.sub(r'([a-z])([A-Z])', r'\1 \2', raw)
    parts = re.sub(r'[_\-]+', ' ', parts)
    result = parts.strip().title()
    # If result is just "Article" or "News", make it more descriptive
    if result.lower() in ('article', 'news', 'articles', 'news article'):
        result = 'All Links'
    return result


# ---------------------------------------------------------------------------
# Cross-page comparison
# ---------------------------------------------------------------------------

def compare_across_pages(all_modules: dict) -> dict:
    """
    Compare modules found across article pages to identify stable vs
    page-specific selectors.
    """
    article_urls = [url for url, data in all_modules.items() if data['page_type'] == 'Article']

    if len(article_urls) <= 1:
        return {}

    # Find selectors that appear in multiple articles
    selector_counts = Counter()
    selector_modules = {}

    for url in article_urls:
        for module in all_modules[url]['modules']:
            selector_counts[module.selector] += 1
            selector_modules[module.selector] = module

    comparison = {
        'shared': [],  # appear in all articles
        'partial': [],  # appear in some articles
        'unique': [],  # appear in only one
    }

    for selector, count in selector_counts.items():
        module = selector_modules[selector]
        if count == len(article_urls):
            comparison['shared'].append(module)
        elif count > 1:
            comparison['partial'].append(module)
        else:
            comparison['unique'].append(module)

    return comparison


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------

def format_output(all_modules: dict, comparison: dict) -> str:
    """Format the results as a markdown report."""
    lines = []
    lines.append('# Recirculation Tagging Report')
    lines.append('')

    # Summary
    total_modules = sum(len(data['modules']) for data in all_modules.values())
    lines.append(f'**Pages analyzed:** {len(all_modules)}')
    lines.append(f'**Total modules detected:** {total_modules}')
    lines.append('')

    # Per-page results
    for url, data in all_modules.items():
        page_type = data['page_type']
        modules = data['modules']

        lines.append(f'---')
        lines.append(f'## {page_type}: {url}')
        lines.append(f'')

        if not modules:
            lines.append('*No recirculation modules detected.*')
            lines.append('')
            continue

        # Group by category
        by_category = defaultdict(list)
        for m in modules:
            by_category[m.category].append(m)

        # Recirculation modules first
        category_order = ['recirculation', 'body_links', 'cta', 'affiliate', 'navigation']
        category_labels = {
            'recirculation': 'Recirculation Modules',
            'body_links': 'Body / Editorial Links',
            'cta': 'CTAs',
            'affiliate': 'Affiliate / Sponsored',
            'navigation': 'Navigation Elements',
        }

        for cat in category_order:
            if cat not in by_category:
                continue

            lines.append(f'### {category_labels.get(cat, cat)}')
            lines.append('')
            lines.append('| CSS Selector | Module Name | Links | Matched | Confidence |')
            lines.append('|---|---|---|---|---|')

            for m in by_category[cat]:
                matched = f'{m.matched_elements} el' if m.matched_elements else 'n/a'
                lines.append(f'| `{m.selector}` | {m.name} | {m.link_count} | {matched} | {m.confidence} |')

            lines.append('')

            # Show sample links for context
            for m in by_category[cat]:
                if m.sample_links:
                    lines.append(f'<details><summary>{m.name} — sample links</summary>')
                    lines.append('')
                    for link in m.sample_links[:3]:
                        lines.append(f'- {link}')
                    lines.append('')
                    lines.append('</details>')
                    lines.append('')

        # Missed areas (from coverage analysis)
        missed = data.get('missed_areas', [])
        if missed:
            lines.append('### Possibly Missed Modules')
            lines.append('')
            lines.append('*Areas with 3+ internal article links not covered by any selector above. Verify manually.*')
            lines.append('')
            lines.append('| Suggested Selector | Links | Sample Texts |')
            lines.append('|---|---|---|')
            for area in missed:
                texts = '; '.join(t for t in area.get('sampleTexts', []) if t)[:120]
                lines.append(f'| `{area["selector"]}` | {area["linkCount"]} | {texts} |')
            lines.append('')

    # Cross-page comparison
    if comparison:
        lines.append('---')
        lines.append('## Cross-Article Comparison')
        lines.append('')

        if comparison.get('shared'):
            lines.append('### Shared across all articles (safe for global tagging)')
            lines.append('')
            lines.append('| CSS Selector | Module Name |')
            lines.append('|---|---|')
            for m in comparison['shared']:
                lines.append(f'| `{m.selector}` | {m.name} |')
            lines.append('')

        if comparison.get('unique'):
            lines.append('### Unique to specific articles (verify before tagging)')
            lines.append('')
            lines.append('| CSS Selector | Module Name |')
            lines.append('|---|---|')
            for m in comparison['unique']:
                lines.append(f'| `{m.selector}` | {m.name} |')
            lines.append('')

    # Copy-paste ready section — three proposal tiers
    lines.append('---')
    lines.append('## Ready to Copy — Experience Manager')
    lines.append('')

    for page_type_label in ['Home', 'Article']:
        # Collect all modules for this page type
        page_modules = []
        for url, data in all_modules.items():
            if data['page_type'] == page_type_label:
                page_modules.extend(data['modules'])

        tiers = _build_selector_tiers(page_modules)

        if not tiers:
            lines.append(f'### {page_type_label}')
            lines.append('')
            lines.append('*No recirculation modules detected.*')
            lines.append('')
            continue

        simple, intermediate, detailed = tiers

        # Only show tiers that differ from each other (compare by selector set)
        def _tier_selectors(tier):
            return set(sel for sel, _ in tier)

        tiers_to_show = [('Simple', simple)]
        if _tier_selectors(intermediate) != _tier_selectors(simple):
            tiers_to_show.append(('Intermediate', intermediate))
        if _tier_selectors(detailed) != _tier_selectors(intermediate):
            tiers_to_show.append(('Detailed', detailed))

        # If all three are the same, show just one table without tier label
        if len(tiers_to_show) == 1:
            lines.append(f'### {page_type_label}')
            lines.append('')
            _render_selector_table(lines, simple, page_type_label)
        else:
            for tier_name, tier_data in tiers_to_show:
                lines.append(f'### {page_type_label} — {tier_name} ({len(tier_data)} selectors)')
                lines.append('')
                _render_selector_table(lines, tier_data, page_type_label)

    return '\n'.join(lines)


def _render_selector_table(lines: list, selectors: List[Tuple[str, str]], page_type: str):
    """Render a selector table with the [Home]/[Article] prefix."""
    lines.append('| CSS selector | Module name |')
    lines.append('|---|---|')
    for sel, name in selectors:
        lines.append(f'| `{sel}` | [{page_type}] {name} |')
    lines.append('')


def _build_selector_tiers(
    modules: List[ModuleCandidate],
) -> Optional[Tuple[List[Tuple[str, str]], List[Tuple[str, str]], List[Tuple[str, str]]]]:
    """
    Build three tiers of selector proposals:

    - Simple: maximum grouping. Only base selectors and standalone containers.
      Fewest selectors, full coverage.
    - Intermediate: base selectors + distinct module containers, but no BEM
      variants of the same link type. Differentiates modules, not card types.
    - Detailed: everything — base + all BEM variants for maximum traffic
      differentiation.

    Returns (simple, intermediate, detailed) or None if no modules found.
    """
    # --- Common filtering ---
    noise_keywords = [
        'footer', 'byline', 'apps-logo', 'cookie', 'logo-wrapper', 'clima',
        'nav__page', 'main-nav', 'today-topic', 'news-topic', 'news-headline',
        'col2-title', 'header', 'preheader', 'weather', 'forecast',
        'app-download', 'copyright', 'legal', 'login', 'signup',
        'top-menu', 'subsite-top', 'mega-menu', 'hidden-nav',
    ]
    non_article_categories = {'navigation', 'cta', 'affiliate'}

    candidates = []
    for m in modules:
        if m.category in non_article_categories:
            continue
        combined = f'{m.selector.lower()} {m.name.lower()}'
        if any(kw in combined for kw in noise_keywords):
            continue
        article_links = [l for l in m.sample_links if _looks_like_article_url(l)]
        if not article_links:
            continue
        candidates.append(m)

    if not candidates:
        return None

    # --- Collect all selectors ---
    selector_info = {}  # selector -> (total_links, name)
    for m in candidates:
        sel = m.selector
        if sel not in selector_info or m.link_count > selector_info[sel][0]:
            selector_info[sel] = (m.link_count, m.name)

    # Add base selectors for BEM families
    _add_base_selectors(selector_info)

    # --- Clean: remove junk selectors (scoped, empty modifiers, BEM children) ---
    all_selectors = list(selector_info.keys())
    junk = set()

    for sel in all_selectors:
        # Scoped selectors: .widget .news-article--x → redundant if .news-article exists
        parts = sel.strip().split()
        if len(parts) > 1:
            desc_classes = re.findall(r'\.([a-zA-Z][\w-]*)', parts[-1])
            for dc in desc_classes:
                base = dc.split('--')[0] if '--' in dc else dc
                if f'.{base}' in selector_info or f'.{dc}' in selector_info:
                    junk.add(sel)
                    break

        # Empty BEM modifiers: .widget-wrapper--
        if re.search(r'--(?:\.|$|\s)', sel):
            junk.add(sel)
            continue

        # BEM children when parent exists: .related-news__wrapper → .related-news
        sel_classes = re.findall(r'\.([a-zA-Z][\w-]*)', sel)
        for cls in sel_classes:
            if '__' in cls:
                parent_base = cls.split('__')[0]
                parent_sel = f'.{parent_base}'
                if parent_sel in selector_info and parent_sel != sel:
                    junk.add(sel)
                    break

    clean_selectors = [s for s in all_selectors if s not in junk]

    # --- Classify each selector ---
    # A "base" is a selector with no BEM modifier (no --)
    # A "container" is a base that doesn't belong to a BEM family (standalone module)
    # A "variant" is a BEM-modified selector (.news-article.news-article--highlighted)

    # Find which bases have BEM families
    bem_families = defaultdict(list)  # base_class -> [variant selectors]
    for sel in clean_selectors:
        sel_classes = re.findall(r'\.([a-zA-Z][\w-]*)', sel)
        for cls in sel_classes:
            if '--' in cls:
                base = cls.split('--')[0]
                bem_families[base].append(sel)

    bases_with_family = set(bem_families.keys())

    bases = []       # base selectors that have BEM variants (catch-all)
    containers = []  # standalone selectors (no BEM family, independent modules)
    variants = []    # BEM-modified selectors (specific card types)

    for sel in clean_selectors:
        sel_classes = re.findall(r'\.([a-zA-Z][\w-]*)', sel)
        has_modifier = any('--' in c for c in sel_classes)

        if has_modifier:
            variants.append(sel)
        else:
            # Check if this base has a BEM family
            is_family_base = any(c in bases_with_family for c in sel_classes)
            if is_family_base:
                bases.append(sel)
            else:
                containers.append(sel)

    # --- Sort helper ---
    def sort_by_links(sels):
        return sorted(sels, key=lambda s: -selector_info[s][0])

    # --- Build the three tiers ---
    def make_pairs(sels):
        result = []
        seen_names = Counter()
        for sel in sels:
            _, name = selector_info[sel]
            name = re.sub(r'^\[(Home|Article)\]\s*', '', name)
            # Deduplicate names
            seen_names[name] += 1
            if seen_names[name] > 1:
                name = f'{name} #{seen_names[name]}'
            result.append((sel, name))
        return result

    # Simple: only bases (catch-all) + containers (standalone modules)
    simple_sels = sort_by_links(bases + containers)
    simple = make_pairs(simple_sels)

    # Intermediate: Simple + variants from small BEM families (2-3 variants).
    # Small families likely represent distinct modules (e.g., .widget-wrapper--r0
    # vs .widget-wrapper-- are different sections). Large families (4+) are
    # card-type variations (e.g., .news-article--simple, --highlighted, --medium...)
    # that only matter for detailed traffic differentiation.
    small_family_variants = []
    for base, family_sels in bem_families.items():
        # Deduplicate family selectors
        unique_family = list(set(family_sels))
        if len(unique_family) <= 3:
            small_family_variants.extend(unique_family)
    intermediate_sels = sort_by_links(bases + containers + small_family_variants)
    intermediate = make_pairs(intermediate_sels)

    # Detailed: everything — bases + containers + all variants
    detailed_sels = sort_by_links(bases + containers) + sort_by_links(variants)
    detailed = make_pairs(detailed_sels)

    return simple, intermediate, detailed


def _add_base_selectors(selector_info: dict) -> None:
    """
    If multiple BEM-modifier selectors share the same base class, add the
    base class as a single catch-all and let deduplication remove the variants.
    E.g., .news-article--simple, .news-article--highlighted → adds .news-article
    """
    # Group selectors by their BEM base
    base_groups = defaultdict(list)
    for sel in list(selector_info.keys()):
        # Extract classes from the selector
        classes = re.findall(r'\.([a-zA-Z][\w-]*)', sel)
        for cls in classes:
            if '--' in cls:
                base = cls.split('--')[0]
                base_groups[base].append(sel)

    # For bases with 2+ variants, add the base selector
    for base, variants in base_groups.items():
        if len(variants) >= 2:
            base_sel = f'.{base}'
            if base_sel not in selector_info:
                total_links = sum(selector_info[v][0] for v in variants)
                selector_info[base_sel] = (total_links, _clean_name(base))


def _selector_is_covered_by(specific: str, broad: str) -> bool:
    """
    Check if `specific` is a more specific version of `broad`, meaning
    every element matched by `specific` would also be matched by `broad`.

    Examples:
        .a.a--x is covered by .a  (compound includes base)
        .widget .a is covered by .a  (scoped includes unscoped)
        .a--x is covered by .a  (BEM modifier is subset of base)
        .a__wrapper is covered by .a  (BEM child is inside parent)
        .a is NOT covered by .a--x  (base is broader than modifier)
    """
    if specific == broad:
        return False

    # Parse both selectors into their class components
    broad_parts = broad.strip().split()
    specific_parts = specific.strip().split()

    # Get the final (target) part of each selector
    broad_target = broad_parts[-1]
    specific_target = specific_parts[-1]

    # Extract individual classes from each target
    broad_classes = set(re.findall(r'\.[a-zA-Z][\w-]*', broad_target))
    specific_classes = set(re.findall(r'\.[a-zA-Z][\w-]*', specific_target))

    if not broad_classes:
        return False

    # Case 1: Compound selector includes all classes of the broad one
    # .a.a--x is covered by .a (because {.a} ⊆ {.a, .a--x})
    if broad_classes.issubset(specific_classes):
        return True

    # Case 2: BEM modifier — .news-article--highlighted-news is covered by .news-article
    # Check if every broad class is a BEM base of some specific class
    for bc in broad_classes:
        bc_name = bc.lstrip('.')
        found = False
        for sc in specific_classes:
            sc_name = sc.lstrip('.')
            # sc is a BEM modifier of bc: "base--modifier"
            if sc_name.startswith(bc_name + '--'):
                found = True
                break
            # sc is a BEM element of bc: "base__element"
            if sc_name.startswith(bc_name + '__'):
                found = True
                break
            # exact match
            if sc_name == bc_name:
                found = True
                break
        if not found:
            return False
    # If we got here, all broad classes matched
    if broad_classes != specific_classes:
        return True

    # Case 3: Scoped version — .widget .a is covered by .a
    if len(specific_parts) > len(broad_parts) and len(broad_parts) == 1:
        if broad_classes.issubset(specific_classes):
            return True

    return False


def _looks_like_article_url(url: str) -> bool:
    """Check if a URL looks like it points to an article (not a section/category page)."""
    parsed = urlparse(url)
    path = parsed.path.rstrip('/')
    if not path or path == '':
        return False
    # Section pages typically have 1 path segment: /politica, /deportes
    segments = [s for s in path.split('/') if s]
    if len(segments) <= 1:
        return False
    # Article URLs usually have longer slugs or numeric IDs
    last_segment = segments[-1]
    if len(last_segment) > 20 or re.search(r'\d{3,}', last_segment):
        return True
    return len(segments) >= 2


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------

def _filter_low_value_modules(modules: List[ModuleCandidate]) -> List[ModuleCandidate]:
    """Remove modules that are unlikely to be useful for recirculation tagging."""
    low_value_patterns = [
        r'login', r'registra', r'sign.?up', r'sign.?in',
        r'impressum', r'privacy', r'cookie', r'gdpr',
        r'about.?us', r'o.?nama', r'contact',
        r'terms', r'legal', r'disclaimer',
        r'^tel:', r'^mailto:', r'play\.google\.com', r'apps\.apple\.com',
        r'apps\.html',
    ]

    def is_low_value(module):
        # Check sample links for login/about/legal patterns
        for link in module.sample_links:
            link_lower = link.lower()
            matches = sum(1 for p in low_value_patterns if re.search(p, link_lower))
            if matches > 0:
                # If most links match low-value patterns, skip this module
                low_count = sum(
                    1 for l in module.sample_links
                    if any(re.search(p, l.lower()) for p in low_value_patterns)
                )
                if low_count >= len(module.sample_links) * 0.5:
                    return True
                break

        # Skip ad network links
        if module.selector and 'banner' in module.selector.lower() and 'ad' in module.selector.lower():
            return True

        # Skip Marfeel recommender selectors
        if module.selector and 'data-mrf' in module.selector:
            return True

        return False

    return [m for m in modules if not is_low_value(m)]


def _deduplicate_names(modules: List[ModuleCandidate]) -> List[ModuleCandidate]:
    """Ensure module names are unique by replacing generic names with selector-derived ones."""
    name_counts = Counter(m.name for m in modules)
    name_seen = Counter()

    for module in modules:
        if name_counts[module.name] > 1:
            name_seen[module.name] += 1
            # Try to derive a FULL replacement name from the selector
            hint = _name_hint_from_selector(module.selector)
            if hint:
                # Extract the prefix [Home]/[Article]
                prefix_match = re.match(r'(\[(?:Home|Article)\])\s*', module.name)
                prefix = prefix_match.group(1) + ' ' if prefix_match else ''
                module.name = f'{prefix}{hint}'
            else:
                module.name = f'{module.name} #{name_seen[module.name]}'

    # Check again for any remaining duplicates after renaming
    final_counts = Counter(m.name for m in modules)
    final_seen = Counter()
    for module in modules:
        if final_counts[module.name] > 1:
            final_seen[module.name] += 1
            if final_seen[module.name] > 1:
                module.name = f'{module.name} #{final_seen[module.name]}'

    return modules


def _name_hint_from_selector(selector: str) -> Optional[str]:
    """Extract a naming hint from a CSS selector."""
    # Extract class names
    classes = re.findall(r'\.([a-zA-Z][\w-]*)', selector)
    if classes:
        # Use the last (most specific) class
        return _clean_name(classes[-1])

    # Extract id
    ids = re.findall(r'#([a-zA-Z][\w-]*)', selector)
    if ids:
        return _clean_name(ids[0])

    return None


# ---------------------------------------------------------------------------
# Live DOM validation
# ---------------------------------------------------------------------------

def validate_selectors_on_page(page, modules: list, page_url: str) -> list:
    """Run querySelectorAll for each selector on the live page.

    Drops selectors that don't match anything or have invalid syntax.
    Updates match counts on surviving modules.
    """
    site_domain = get_site_domain(page_url)
    validated = []

    for module in modules:
        selector = module.selector
        try:
            result = page.evaluate('''(args) => {
                const { sel, siteDomain } = args;
                try {
                    const els = document.querySelectorAll(sel);
                    const links = [];
                    els.forEach(el => {
                        const anchors = el.tagName === 'A'
                            ? [el]
                            : [...el.querySelectorAll('a[href]')];
                        anchors.forEach(a => {
                            if (a.href && !a.href.startsWith('javascript:')) {
                                links.push(a.href);
                            }
                        });
                    });
                    // Count how many links are internal (same domain)
                    const internal = links.filter(l => {
                        try { return new URL(l).hostname.includes(siteDomain); }
                        catch { return false; }
                    });
                    return {
                        count: els.length,
                        linkCount: links.length,
                        internalCount: internal.length,
                        links: links.slice(0, 10),
                        error: null
                    };
                } catch(e) {
                    return { count: 0, linkCount: 0, internalCount: 0,
                             links: [], error: e.message };
                }
            }''', {'sel': selector, 'siteDomain': site_domain})
        except Exception as e:
            result = {'count': 0, 'linkCount': 0, 'internalCount': 0,
                      'links': [], 'error': str(e)}

        if result['error']:
            print(f'    INVALID selector: {selector} ({result["error"]})')
            continue

        if result['count'] == 0:
            print(f'    NO MATCH: {selector}')
            continue

        # Update module with live data
        module.matched_elements = result['count']
        module.matched_links = result['linkCount']
        module.link_count = result['linkCount']
        if result['links']:
            module.sample_links = result['links'][:5]
        validated.append(module)

    return validated


def find_uncovered_link_areas(page, validated_selectors: list, page_url: str) -> list:
    """Find DOM areas with 3+ internal article links not covered by any
    validated selector.  Returns a list of dicts with rough selectors,
    link counts, and sample texts."""
    site_domain = get_site_domain(page_url)

    missed = page.evaluate('''(args) => {
        const { selectors, siteDomain } = args;

        // Collect every <a> already covered by a validated selector
        const covered = new Set();
        for (const sel of selectors) {
            try {
                document.querySelectorAll(sel).forEach(el => {
                    const anchors = el.tagName === 'A'
                        ? [el]
                        : [...el.querySelectorAll('a[href]')];
                    anchors.forEach(a => covered.add(a));
                });
            } catch {}
        }

        // Tags that commonly act as nav — skip them
        const NAV_TAGS = new Set(['NAV', 'HEADER', 'FOOTER']);

        // Walk potential containers looking for uncovered article links
        const candidates = document.querySelectorAll(
            'section, aside, div, ul, ol, article'
        );
        const results = [];
        const seenSelectors = new Set();

        for (const el of candidates) {
            // Skip nav-like elements
            if (NAV_TAGS.has(el.tagName)) continue;
            const role = (el.getAttribute('role') || '').toLowerCase();
            if (role === 'navigation') continue;

            const anchors = [...el.querySelectorAll('a[href]')].filter(a => {
                if (covered.has(a)) return false;
                try {
                    const url = new URL(a.href);
                    if (!url.hostname.includes(siteDomain)) return false;
                    // Heuristic: article URLs have 2+ path segments or long slugs
                    const segs = url.pathname.replace(/\\/$/, '')
                                             .split('/').filter(Boolean);
                    if (segs.length < 2) return false;
                    return true;
                } catch { return false; }
            });

            if (anchors.length < 3) continue;

            // Build a rough selector
            let sel = el.tagName.toLowerCase();
            if (el.id) {
                sel = '#' + el.id;
            } else if (el.className && typeof el.className === 'string') {
                const cls = el.className.trim().split(/\\s+/)
                    .filter(c => c.length > 2 && !/^(col|row|flex|grid|p[xytblr]?|m[xytblr]?|w|h|d|bg|text|font)-/.test(c))[0];
                if (cls) sel = '.' + cls;
            }

            if (seenSelectors.has(sel)) continue;
            seenSelectors.add(sel);

            results.push({
                selector: sel,
                linkCount: anchors.length,
                sampleLinks: anchors.slice(0, 5).map(a => a.href),
                sampleTexts: anchors.slice(0, 3).map(a =>
                    (a.textContent || '').trim().substring(0, 80))
            });
        }

        // Sort by link count descending, keep top 10
        results.sort((a, b) => b.linkCount - a.linkCount);
        return results.slice(0, 10);
    }''', {'selectors': validated_selectors, 'siteDomain': site_domain})

    return missed or []


# ---------------------------------------------------------------------------
# Main analysis pipeline
# ---------------------------------------------------------------------------

def analyze_page(url: str, page_type: str, pw=None, html: str = None, page=None) -> dict:
    """Analyze a single page for recirculation modules."""
    print(f'\nAnalyzing [{page_type}]: {url}')

    if html:
        print('  Using provided HTML...')
        html_desktop = html
    else:
        # Caller should provide html (via fetch_page). Fallback for compat.
        print('  Fetching desktop version...')
        html_desktop, _, _browser = fetch_page(url, DESKTOP_VIEWPORT, USER_AGENT_DESKTOP, pw)
        if _browser:
            _browser.close()

    if not html_desktop:
        print(f'  Error: Could not load {url}', file=sys.stderr)
        return {'page_type': page_type, 'modules': [], 'missed_areas': []}

    soup = BeautifulSoup(html_desktop, 'lxml')

    # Find link clusters
    print('  Detecting link clusters...')
    clusters = find_link_clusters(soup, url)
    print(f'  Found {len(clusters)} raw clusters')

    # Classify each cluster
    modules = []
    seen_selectors = set()

    for cluster in clusters:
        module = classify_cluster(cluster, page_type, url)
        if module and module.selector not in seen_selectors:
            seen_selectors.add(module.selector)
            modules.append(module)

    # Filter low-value modules (login, about, legal, etc.)
    modules = _filter_low_value_modules(modules)

    # Deduplicate names — append selector hint to disambiguate
    modules = _deduplicate_names(modules)

    # Sort: high confidence first, then by link count
    confidence_order = {'high': 0, 'medium': 1, 'low': 2}
    modules.sort(key=lambda m: (confidence_order.get(m.confidence, 3), -m.link_count))

    print(f'  Classified {len(modules)} modules')

    # Validate selectors against the live DOM
    missed_areas = []
    if page:
        print('  Validating selectors on live page...')
        before = len(modules)
        modules = validate_selectors_on_page(page, modules, url)
        dropped = before - len(modules)
        if dropped:
            print(f'  Dropped {dropped} selectors (no match on live page)')
        print(f'  {len(modules)} selectors validated')

        # Coverage analysis — find uncovered link areas
        validated_sels = [m.selector for m in modules]
        missed_areas = find_uncovered_link_areas(page, validated_sels, url)
        if missed_areas:
            print(f'  Found {len(missed_areas)} potentially uncovered areas')
    else:
        print('  Skipping live validation (no browser page)')

    return {
        'page_type': page_type,
        'modules': modules,
        'missed_areas': missed_areas,
    }


def main():
    parser = argparse.ArgumentParser(
        description='Analyze web pages for recirculation tagging.',
        epilog='''
Examples:
  # Automatic mode (fetches pages with headless browser):
  %(prog)s https://example.com/ https://example.com/article-1

  # Local HTML mode (for WAF-blocked sites — save pages with Cmd+S):
  %(prog)s --html home.html article1.html --site example.com
        ''',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('urls', nargs='+',
                        help='URLs to analyze (auto mode) or HTML files (with --html). '
                             'First = homepage, rest = articles.')
    parser.add_argument('-o', '--output', help='Output file (default: stdout)')
    parser.add_argument('--html', action='store_true',
                        help='Read from local HTML files instead of fetching URLs. '
                             'Save pages in Chrome with Cmd+S → "Webpage, HTML Only".')
    parser.add_argument('--site', help='Site domain (required with --html, e.g. sfgate.com)')
    args = parser.parse_args()

    # --- Local HTML mode ---
    if args.html:
        if not args.site:
            parser.error('--site is required with --html (e.g. --site sfgate.com)')

        site = args.site
        files = args.urls
        base_url = f'https://www.{site}/' if not site.startswith('http') else site

        print(f'Marfeel Recirculation Tagger')
        print(f'Site: {site}')
        print(f'Mode: local HTML ({len(files)} files)')

        all_modules = {}

        for i, filepath in enumerate(files):
            page_type = 'Home' if i == 0 else 'Article'
            url_label = f'{base_url}' if i == 0 else f'{base_url}{filepath}'

            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    html_content = f.read()
            except FileNotFoundError:
                print(f'  Error: File not found: {filepath}', file=sys.stderr)
                continue

            all_modules[url_label] = analyze_page(url_label, page_type, html=html_content)

        comparison = compare_across_pages(all_modules)
        report = format_output(all_modules, comparison)

        if args.output:
            with open(args.output, 'w') as f:
                f.write(report)
            print(f'\nReport saved to: {args.output}')
        else:
            print('\n')
            print(report)
        return

    # --- Automatic mode (Playwright) ---
    urls = args.urls
    homepage_url = urls[0]
    article_urls = urls[1:]

    print(f'Marfeel Recirculation Tagger')
    print(f'Site: {get_site_domain(homepage_url)}')
    print(f'Homepage: {homepage_url}')
    if article_urls:
        print(f'Articles: {len(article_urls)}')

    all_modules = {}

    with sync_playwright() as pw:
        # Analyze homepage
        html, page, browser = fetch_page(homepage_url, DESKTOP_VIEWPORT, USER_AGENT_DESKTOP, pw)
        all_modules[homepage_url] = analyze_page(homepage_url, 'Home', pw, html=html, page=page)
        browser.close()

        # Analyze articles
        for url in article_urls:
            html, page, browser = fetch_page(url, DESKTOP_VIEWPORT, USER_AGENT_DESKTOP, pw)
            all_modules[url] = analyze_page(url, 'Article', pw, html=html, page=page)
            browser.close()

    # Cross-page comparison
    comparison = compare_across_pages(all_modules)

    # Format output
    report = format_output(all_modules, comparison)

    if args.output:
        with open(args.output, 'w') as f:
            f.write(report)
        print(f'\nReport saved to: {args.output}')
    else:
        print('\n')
        print(report)


if __name__ == '__main__':
    main()
