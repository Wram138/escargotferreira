import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; RondaTVNatal/1.0; +https://github.com/escargotferreira)',
  Accept: 'application/json, application/rss+xml, application/xml, text/xml, text/html;q=0.9'
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false
});

/**
 * Strips tracking parameters and normalizes URLs for reliable deduplication.
 */
export function canonicalizeUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(String(rawUrl).trim());
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid'
    ];
    for (const p of trackingParams) u.searchParams.delete(p);
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return String(rawUrl).trim();
  }
}

/**
 * Extracts clean plain text from an HTML snippet, removing scripts, embeds, and noisy suffixes.
 */
export function stripHtmlToText(html = '', maxLen = 400) {
  if (!html) return '';
  const $ = cheerio.load(`<body>${html}</body>`);
  $('script, style, iframe, figure, figcaption').remove();
  let text = $('body').text().replace(/\s+/g, ' ').trim();
  text = text.replace(/\[\.\.\.\]|\[…\]/g, '…').replace(/\s+Leia mais.*$/i, '').trim();
  if (maxLen && text.length > maxLen) {
    text = text.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
  }
  return text;
}

function extractFirstImageFromHtml(html = '') {
  if (!html) return null;
  const $ = cheerio.load(html);
  const src = $('img').first().attr('src') || $('img').first().attr('data-src');
  if (!src || src.startsWith('data:')) return null;
  return src;
}

function parseDateIso(dateStr, isGmt = false) {
  if (!dateStr) return new Date().toISOString();
  let raw = String(dateStr).trim();
  if (isGmt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) {
    raw += 'Z';
  } else if (!isGmt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) {
    // WordPress Brazil portals use America/Sao_Paulo (-03:00) for local `date`
    raw += '-03:00';
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function asArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function extractXmlText(val) {
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    if (val['#text'] != null) return String(val['#text']);
    if (val['@_href']) return String(val['@_href']);
  }
  return '';
}

/**
 * Parses WordPress REST API posts JSON into normalized article objects.
 */
export function parseWpJsonPosts(posts, source) {
  if (!Array.isArray(posts)) return [];
  const items = [];
  for (const post of posts) {
    const link = post?.link;
    if (!link) continue;

    const title = stripHtmlToText(post?.title?.rendered || '', 220);
    if (!title) continue;

    const excerptHtml = post?.excerpt?.rendered || '';
    const contentHtml = post?.content?.rendered || '';
    const summary = stripHtmlToText(excerptHtml || contentHtml, 320);
    const content = stripHtmlToText(contentHtml, 2500);

    let imageUrl = null;
    const mediaArr = post?._embedded?.['wp:featuredmedia'];
    if (Array.isArray(mediaArr) && mediaArr[0]?.source_url) {
      imageUrl = mediaArr[0].source_url;
    }
    if (!imageUrl) {
      imageUrl = extractFirstImageFromHtml(contentHtml);
    }

    const categories = [];
    const termGroups = post?._embedded?.['wp:term'];
    if (Array.isArray(termGroups)) {
      for (const group of termGroups) {
        if (Array.isArray(group)) {
          for (const term of group) {
            if (term?.name) categories.push(term.name);
          }
        }
      }
    }

    const publishedAt = post?.date_gmt
      ? parseDateIso(post.date_gmt, true)
      : parseDateIso(post?.date, false);

    items.push({
      canonicalUrl: canonicalizeUrl(link),
      url: link,
      title,
      summary,
      content,
      imageUrl,
      categories,
      publishedAt,
      sourceId: source.id,
      sourceName: source.name,
      sourceShortName: source.shortName || source.name,
      sourceCategory: source.category || 'portal',
      badgeColor: source.badgeColor || '#475569',
      geoHint: source.geoHint || 'rn'
    });
  }
  return items;
}

/**
 * Parses RSS 2.0 or Atom XML text into normalized article objects.
 */
export function parseFeedXml(xmlText, source) {
  const parsed = xmlParser.parse(xmlText);
  const channelItems = parsed?.rss?.channel?.item;
  const atomEntries = parsed?.feed?.entry;
  const rawItems = asArray(channelItems || atomEntries);

  const items = [];
  for (const raw of rawItems) {
    const title = stripHtmlToText(extractXmlText(raw.title), 220);

    let link = '';
    if (typeof raw.link === 'string') {
      link = raw.link;
    } else if (Array.isArray(raw.link)) {
      const alt = raw.link.find((l) => l['@_rel'] === 'alternate') || raw.link[0];
      link = alt?.['@_href'] || extractXmlText(alt);
    } else if (raw.link && typeof raw.link === 'object') {
      link = raw.link['@_href'] || extractXmlText(raw.link);
    }
    if (!link && raw.guid) {
      const g = extractXmlText(raw.guid);
      if (g.startsWith('http')) link = g;
    }
    if (!title || !link) continue;

    const descHtml = extractXmlText(raw.description) || extractXmlText(raw.summary);
    const subtitle = extractXmlText(raw['atom:subtitle']) || extractXmlText(raw.subtitle);
    const encodedHtml = extractXmlText(raw['content:encoded']) || extractXmlText(raw.content);

    const summaryRaw = subtitle || stripHtmlToText(descHtml, 320) || stripHtmlToText(encodedHtml, 320);
    const summary = stripHtmlToText(summaryRaw, 320);
    const content = stripHtmlToText(encodedHtml || descHtml, 2500);

    let imageUrl = null;
    const mediaContent = asArray(raw['media:content']).find((m) => m?.['@_url']);
    const mediaThumb = asArray(raw['media:thumbnail']).find((m) => m?.['@_url']);
    const enclosure = asArray(raw.enclosure).find(
      (e) => e?.['@_url'] && (!e['@_type'] || String(e['@_type']).startsWith('image'))
    );
    const imgDestaque = extractXmlText(raw['imagem-destaque']);

    imageUrl =
      mediaContent?.['@_url'] ||
      mediaThumb?.['@_url'] ||
      enclosure?.['@_url'] ||
      (imgDestaque.startsWith('http') ? imgDestaque : null) ||
      extractFirstImageFromHtml(descHtml) ||
      extractFirstImageFromHtml(encodedHtml);

    const categories = asArray(raw.category)
      .map((c) => extractXmlText(c).trim())
      .filter(Boolean);

    const rawDate = extractXmlText(raw.pubDate) || extractXmlText(raw.published) || extractXmlText(raw.updated) || extractXmlText(raw['dc:date']);
    const publishedAt = parseDateIso(rawDate, false);

    items.push({
      canonicalUrl: canonicalizeUrl(link),
      url: link.trim(),
      title,
      summary,
      content,
      imageUrl,
      categories,
      publishedAt,
      sourceId: source.id,
      sourceName: source.name,
      sourceShortName: source.shortName || source.name,
      sourceCategory: source.category || 'blog',
      badgeColor: source.badgeColor || '#475569',
      geoHint: source.geoHint || 'rn'
    });
  }
  return items;
}

/**
 * Fallback HTML scraper for blogs/portals without working RSS or WP-JSON endpoints.
 */
export function parseHtmlArticles(html, baseUrl, source) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];

  const candidates = $('article, .post, .noticia, .entry, main h2 a, main h3 a, h2 a, h3 a').toArray();
  for (const el of candidates) {
    const $el = $(el);
    const $link = $el.is('a') ? $el : $el.find('h1 a, h2 a, h3 a, a[href]').first();
    const href = $link.attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

    let absUrl;
    try {
      absUrl = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const canon = canonicalizeUrl(absUrl);
    if (seen.has(canon)) continue;

    const title = ($link.text() || $el.find('h1, h2, h3').first().text() || '').replace(/\s+/g, ' ').trim();
    if (title.length < 22 || title.length > 220) continue;

    seen.add(canon);
    const summary = $el.find('p').first().text().replace(/\s+/g, ' ').trim().slice(0, 280);
    const imgSrc = $el.find('img').first().attr('src') || $el.find('img').first().attr('data-src') || null;
    let imageUrl = null;
    if (imgSrc && !imgSrc.startsWith('data:')) {
      try {
        imageUrl = new URL(imgSrc, baseUrl).toString();
      } catch {
        imageUrl = null;
      }
    }

    items.push({
      canonicalUrl: canon,
      url: absUrl,
      title,
      summary,
      content: summary,
      imageUrl,
      categories: [],
      publishedAt: new Date().toISOString(),
      sourceId: source.id,
      sourceName: source.name,
      sourceShortName: source.shortName || source.name,
      sourceCategory: source.category || 'blog',
      badgeColor: source.badgeColor || '#475569',
      geoHint: source.geoHint || 'rn'
    });

    if (items.length >= 20) break;
  }

  return items;
}

async function fetchText(url, timeoutMs = 10000) {
  const res = await fetch(url, {
    headers: DEFAULT_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao acessar ${url}`);
  }
  const contentType = res.headers.get('content-type') || '';
  const body = await res.text();
  return { body, contentType, finalUrl: res.url };
}

/**
 * Fetches and parses a single configured news source, using fallback URL when needed.
 */
export async function fetchSource(source) {
  const started = Date.now();
  const attempt = async (targetUrl, typeHint) => {
    const { body, contentType, finalUrl } = await fetchText(targetUrl);
    const trimmed = body.trim();
    if (typeHint === 'wp-json' || contentType.includes('application/json') || trimmed.startsWith('[')) {
      const json = JSON.parse(trimmed);
      return parseWpJsonPosts(json, source);
    }
    if (typeHint === 'rss' || contentType.includes('xml') || trimmed.startsWith('<?xml') || trimmed.includes('<rss') || trimmed.includes('<feed')) {
      return parseFeedXml(body, source);
    }
    return parseHtmlArticles(body, finalUrl || targetUrl, source);
  };

  try {
    const items = await attempt(source.url, source.type);
    return {
      sourceId: source.id,
      sourceName: source.name,
      ok: true,
      itemCount: items.length,
      durationMs: Date.now() - started,
      error: null,
      items
    };
  } catch (primaryErr) {
    if (source.fallbackUrl) {
      try {
        const fallbackType = source.fallbackUrl.includes('wp-json') ? 'wp-json' : 'rss';
        const items = await attempt(source.fallbackUrl, fallbackType);
        return {
          sourceId: source.id,
          sourceName: source.name,
          ok: true,
          itemCount: items.length,
          durationMs: Date.now() - started,
          error: null,
          usedFallback: true,
          items
        };
      } catch (fbErr) {
        return {
          sourceId: source.id,
          sourceName: source.name,
          ok: false,
          itemCount: 0,
          durationMs: Date.now() - started,
          error: `${primaryErr.message} | Fallback: ${fbErr.message}`,
          items: []
        };
      }
    }
    return {
      sourceId: source.id,
      sourceName: source.name,
      ok: false,
      itemCount: 0,
      durationMs: Date.now() - started,
      error: primaryErr.message,
      items: []
    };
  }
}

/**
 * Auto-discovers RSS, WP-JSON, or HTML scraping endpoint for a user-supplied portal/blog URL.
 */
export async function probeSourceUrl(rawUrl) {
  let normalizedUrl = String(rawUrl || '').trim();
  if (!normalizedUrl) throw new Error('Informe a URL do portal ou blog.');
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const parsedUrl = new URL(normalizedUrl);
  const origin = parsedUrl.origin;

  const tryDirect = async (url, labelType) => {
    const { body, contentType, finalUrl } = await fetchText(url, 8000);
    const trimmed = body.trim();
    if (contentType.includes('application/json') || trimmed.startsWith('[')) {
      const json = JSON.parse(trimmed);
      const items = parseWpJsonPosts(json, { id: 'probe', name: 'Teste' });
      if (items.length > 0) return { type: 'wp-json', url, previewCount: items.length, sampleTitle: items[0].title };
    }
    if (contentType.includes('xml') || trimmed.startsWith('<?xml') || trimmed.includes('<rss') || trimmed.includes('<feed')) {
      const items = parseFeedXml(body, { id: 'probe', name: 'Teste' });
      if (items.length > 0) return { type: 'rss', url, previewCount: items.length, sampleTitle: items[0].title };
    }
    if (labelType === 'html') {
      return { type: 'html-body', body, finalUrl };
    }
    return null;
  };

  // 1. Check if URL itself is already a feed or WP-JSON endpoint
  try {
    const direct = await tryDirect(normalizedUrl, 'html');
    if (direct && direct.type !== 'html-body') return direct;

    // 2. Inspect HTML <link rel="alternate"> tags for RSS/Atom
    if (direct?.type === 'html-body') {
      const $ = cheerio.load(direct.body);
      const pageTitle = $('title').text().trim();
      const rssHref =
        $('link[rel="alternate"][type="application/rss+xml"]').attr('href') ||
        $('link[rel="alternate"][type="application/atom+xml"]').attr('href');

      if (rssHref) {
        const resolvedRss = new URL(rssHref, direct.finalUrl || normalizedUrl).toString();
        try {
          const rssRes = await tryDirect(resolvedRss, 'rss');
          if (rssRes) return { ...rssRes, suggestedName: pageTitle };
        } catch {
          // continue to candidate endpoints
        }
      }

      // 3. Try common WordPress endpoints
      const candidates = [
        `${origin}/wp-json/wp/v2/posts?per_page=20&_embed=wp:featuredmedia`,
        `${origin}/feed/`,
        `${origin}/rss.xml`
      ];
      for (const candidate of candidates) {
        try {
          const found = await tryDirect(candidate, 'auto');
          if (found && found.type !== 'html-body') {
            return { ...found, suggestedName: pageTitle };
          }
        } catch {
          // ignore
        }
      }

      // 4. Fallback to HTML scraping if articles exist on page
      const htmlItems = parseHtmlArticles(direct.body, direct.finalUrl || normalizedUrl, { id: 'probe', name: 'Teste' });
      if (htmlItems.length > 0) {
        return {
          type: 'html',
          url: normalizedUrl,
          previewCount: htmlItems.length,
          sampleTitle: htmlItems[0].title,
          suggestedName: pageTitle
        };
      }
    }
  } catch (err) {
    throw new Error(`Não foi possível ler ${normalizedUrl}: ${err.message}`);
  }

  throw new Error('Não encontramos feed RSS, API WordPress ou lista de notícias reconhecível nessa URL.');
}
