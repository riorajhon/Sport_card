import puppeteer from 'puppeteer';
import { config } from '../config.js';
import { Item } from '../models/Item.js';

const SAVE_TO_DB = false;

const { domain, search, requestTimeout } = config.vinted;
const baseUrl = `https://www.vinted.${domain}`;
const apiBase = `${baseUrl}/api/v2/catalog/items`;

const TRADING_CARDS_CATALOG_ID = 4874;

function titleHasYear(title) {
  if (!title || typeof title !== 'string') return false;
  return /\b(19[7-9]\d|20[0-2]\d|2030)\b/.test(title);
}

function formatUploaded(ts) {
  if (ts == null) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function normalizeItem(raw) {
  const photos = raw.photos || [];
  const mainPhoto = photos[0] || raw.photo || {};
  const price = raw.price;
  let priceStr = '';
  let priceInclProtection = '';

  if (price && typeof price === 'object') {
    const amount = price.amount ?? price.numeric_amount;
    const code = price.currency_code || price.currency || '';
    priceStr = amount != null && code ? `${amount} ${code}`.trim() : '';
  } else if (price != null) {
    priceStr = String(price);
  }

  const conversion = raw.conversion || {};
  const totalPrice =
    raw.total_item_price ??
    raw.price_with_buyer_protection ??
    raw.real_price_with_shipping ??
    conversion.buyer_price ??
    conversion.total_buyer_price;
  const totalCurrency = conversion.buyer_currency || (raw.price && raw.price.currency_code);
  if (totalPrice != null && totalCurrency) {
    const amount = typeof totalPrice === 'object' ? totalPrice.amount ?? totalPrice.value : totalPrice;
    if (amount != null) priceInclProtection = `${amount} ${totalCurrency}`.trim();
  }

  let url = raw.url || '';
  if (url && !url.startsWith('http')) url = `https://www.vinted.${domain}${url}`;
  const photoUrl = mainPhoto.url || mainPhoto.full_size_url || '';
  const brand = raw.brand_title || (raw.brand && raw.brand.title) || '';

  return {
    id: raw.id,
    title: raw.title || '',
    price: priceStr,
    price_incl_protection: priceInclProtection || priceStr,
    url,
    photo_url: photoUrl,
    brand,
    condition: raw.status || '',
    likes: raw.favourite_count ?? 0,
    view_count: raw.view_count ?? 0,
    uploaded: formatUploaded(raw.created_at_ts ?? raw.created_at),
    uploaded_ts: raw.created_at_ts ?? raw.created_at,
  };
}

async function fetchCatalogPage(page, pageNum, searchText, useCatalogFilter = true) {
  const q = (searchText != null && searchText !== '') ? searchText : search;
  const params = new URLSearchParams({
    search_text: q,
    page: String(pageNum),
    per_page: '48',
    order: 'newest_first',
  });
  if (useCatalogFilter) {
    params.append('catalog_ids[]', String(TRADING_CARDS_CATALOG_ID));
  }
  const url = `${apiBase}?${params.toString()}`;
  const origin = baseUrl;
  const data = await page.evaluate(async (args) => {
    const { apiUrl, origin: o } = args;
    const res = await fetch(apiUrl, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: o + '/',
        Origin: o,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      let errMsg = `API ${res.status}`;
      try {
        const json = JSON.parse(text);
        if (json.error || json.message) errMsg += `: ${json.error || json.message}`;
      } catch (_) {
        if (text && text.length < 200) errMsg += `: ${text}`;
      }
      throw new Error(errMsg);
    }
    return res.json();
  }, { apiUrl: url, origin });
  return data;
}

function applyLikesFilter(items, minLikes, maxLikes) {
  let out = items;
  if (minLikes != null && typeof minLikes === 'number' && !Number.isNaN(minLikes)) {
    out = out.filter((item) => (item.likes ?? 0) >= minLikes);
  }
  if (maxLikes != null && typeof maxLikes === 'number' && !Number.isNaN(maxLikes)) {
    out = out.filter((item) => (item.likes ?? 0) <= maxLikes);
  }
  return out;
}

/**
 * Run one search query with pagination. Shared by runScrape.
 */
async function runSearchLoop(page, options) {
  const { query, maxPagesForThisSearch, delayMs, minLikes, maxLikes, onPage, sentIds, byId, useCatalogFilterRef, stepRef, totalSteps } = options;
  let currentPage = 1;
  let useCatalogFilter = useCatalogFilterRef.current;

  while (true) {
    let data;
    try {
      data = await fetchCatalogPage(page, currentPage, query, useCatalogFilter);
    } catch (err) {
      const is400 = useCatalogFilter && (err.message.includes('400') || err.message.includes('API 400'));
      const is403 = useCatalogFilter && (err.message.includes('403') || err.message.includes('API 403'));
      if (is400 || is403) {
        useCatalogFilter = false;
        useCatalogFilterRef.current = false;
        console.warn(`[Vinted] API ${is403 ? '403' : '400'} – continuing without catalog_ids`);
        data = await fetchCatalogPage(page, currentPage, query, false);
      } else {
        throw err;
      }
    }
    const items = data.items || [];
    const withYear = items.filter((raw) => titleHasYear(raw.title));
    if (items.length === 0 && currentPage === 1) {
      console.warn(`[Vinted] "${query}" page 1 returned 0 items (VPS/datacenter IP may be blocked or geo-restricted)`);
    }
    for (const raw of items) {
      if (!titleHasYear(raw.title)) continue;
      const item = normalizeItem(raw);
      byId.set(item.id, item);
    }
    const allFromPage = Array.from(byId.values());
    const filtered = applyLikesFilter(allFromPage, minLikes, maxLikes);
    const toSend = onPage ? filtered.filter((i) => !sentIds.has(i.id)) : [];
    toSend.forEach((i) => sentIds.add(i.id));
    stepRef.current += 1;
    if (onPage) {
      await onPage(toSend, { step: stepRef.current, totalSteps, totalFound: filtered.length });
    }
    if (maxPagesForThisSearch && currentPage >= maxPagesForThisSearch) break;
    if (items.length === 0) break;
    currentPage += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
}

/**
 * Run Vinted scrape. Single search or multiple search terms; paginates.
 * Calls onPage(newItems, progress) after every page.
 */
export async function runScrape(options = {}) {
  const { maxPages = 2, delayMs = 1500, minLikes, maxLikes, searchText, searchTerms, onPage } = options;
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--no-first-run',
    ],
  });

  const sentIds = new Set();
  const byId = new Map();
  const useCatalogFilterRef = { current: true };
  const stepRef = { current: 0 };

  const terms = (searchTerms && searchTerms.length > 0)
    ? searchTerms
    : [(searchText != null && searchText !== '') ? searchText : search];
  const maxPagesPerTerm = Math.max(1, Math.ceil((maxPages || 50) / terms.length));
  const totalSteps = terms.length * maxPagesPerTerm;

  try {
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(requestTimeout);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });
    await page.setViewport({ width: 1280, height: 800 }); // look more like a real browser

    const gotoStart = Date.now();
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
    console.log(`[Vinted] Loaded ${baseUrl} in ${Date.now() - gotoStart}ms`);
    // Short delay so cookies/session can settle (helps avoid 403 on first API call)
    await new Promise((r) => setTimeout(r, 2000));

    for (const query of terms) {
      await runSearchLoop(page, {
        query,
        maxPagesForThisSearch: maxPagesPerTerm,
        delayMs,
        minLikes,
        maxLikes,
        onPage,
        sentIds,
        byId,
        useCatalogFilterRef,
        stepRef,
        totalSteps,
      });
    }

    const allItems = Array.from(byId.values());
    const filtered = applyLikesFilter(allItems, minLikes, maxLikes);

    if (SAVE_TO_DB) {
      for (const item of filtered) {
        await Item.findOneAndUpdate(
          { id: item.id },
          { $set: item },
          { upsert: true }
        );
      }
    }

    console.log(`[Vinted] Scrape finished: ${filtered.length} items (${byId.size} unique with year, min likes applied)`);
    return { items: filtered, total: filtered.length };
  } finally {
    await browser.close();
  }
}

/** Search terms used when expanding the scrape pool (exported for job). */
export const SCRAPE_SEARCH_TERMS = [
  'sport card',
  'basketball card',
  'football card',
  'soccer card',
  'baseball card',
  'hockey card',
];
