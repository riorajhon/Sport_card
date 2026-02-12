/**
 * eBay Browse API – current listings only.
 * Use EBAY_MARKETPLACE_ID (e.g. EBAY_ES) for European buying; results and links match that marketplace.
 */

import { config } from '../config.js';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';

const MARKETPLACE_DOMAIN = {
  EBAY_US: 'ebay.com',
  EBAY_GB: 'ebay.co.uk',
  EBAY_DE: 'ebay.de',
  EBAY_ES: 'ebay.es',
  EBAY_FR: 'ebay.fr',
  EBAY_IT: 'ebay.it',
  EBAY_NL: 'ebay.nl',
  EBAY_PL: 'ebay.pl',
};

let cachedToken = null;
let tokenExpiry = 0;

function getEbayDomain() {
  return MARKETPLACE_DOMAIN[config.ebay.marketplaceId] || 'ebay.com';
}

function getEbayConfig() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

/**
 * Get OAuth2 application access token (client credentials).
 */
export async function getAccessToken() {
  const cfg = getEbayConfig();
  if (!cfg) throw new Error('EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set');

  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const basic = Buffer.from(`${cfg.id}:${cfg.secret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: SCOPE,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  const ttl = (data.expires_in || 7200) * 1000;
  tokenExpiry = Date.now() + ttl - 60000;
  return cachedToken;
}

/**
 * Search eBay current (active) listings by query.
 * Returns a shape that can later include soldListings / soldMinPrice when we add sold-data API.
 */
export async function searchCurrentListings(query, limit = 5) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { listings: [], total: 0, minPrice: null, maxPrice: null, currency: null };
  }

  const token = await getAccessToken();
  const params = new URLSearchParams({
    q: query.trim().slice(0, 350),
    limit: String(Math.min(Math.max(1, limit), 50)),
  });

  const marketplaceId = config.ebay.marketplaceId || 'EBAY_ES';
  const res = await fetch(`${BROWSE_SEARCH_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay search failed: ${res.status} ${text}`);
  }

  function formatPrice(value, currency) {
    if (value == null) return null;
    const c = (currency || 'USD').toUpperCase();
    if (c === 'USD') return `$${value}`;
    if (c === 'EUR') return `€${value}`;
    return `${value} ${c}`;
  }

  const data = await res.json();
  const itemSummaries = data.itemSummaries || [];
  const listings = itemSummaries.map((item) => {
    const price = item.price;
    const value = price?.value ?? null;
    const currency = price?.currency ?? 'USD';
    return {
      itemId: item.itemId,
      title: item.title || '',
      price: value != null ? formatPrice(value, currency) : null,
      priceValue: value,
      currency,
      url: item.itemWebUrl || `https://www.${getEbayDomain()}/itm/${item.itemId}`,
      condition: item.condition || item.conditionId,
    };
  });

  const prices = listings.map((l) => l.priceValue).filter((n) => n != null);
  const minPriceVal = prices.length ? Math.min(...prices) : null;
  const maxPriceVal = prices.length ? Math.max(...prices) : null;
  const currency = listings.length && listings[0].currency ? listings[0].currency : null;

  return {
    listings,
    total: data.total ?? listings.length,
    minPrice: minPriceVal != null ? formatPrice(minPriceVal, currency || 'USD') : null,
    maxPrice: maxPriceVal != null ? formatPrice(maxPriceVal, currency || 'USD') : null,
    currency,
    // Reserved for future sold-data API:
    // soldListings: [],
    // soldMinPrice: null,
    // soldMaxPrice: null,
  };
}
