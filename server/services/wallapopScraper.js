// Wallapop scraper scaffold.
// NOTE: You must implement the real scraping logic from a Spain IP / VPN.
// This file mirrors the shape of vintedScraper.runScrape so the rest of the
// pipeline (processPageItems, UI, etc.) works the same way.

/**
 * Expected return shape:
 * {
 *   items: [
 *     {
 *       id: number,
 *       title: string,
 *       price: string,                  // e.g. "10 EUR"
 *       price_incl_protection: string,  // can be same as price
 *       url: string,                    // Wallapop item URL
 *       photo_url: string,
 *       brand: string,
 *       condition: string,
 *       likes: number,
 *       source: 'wallapop',
 *     },
 *     ...
 *   ],
 *   total: number,
 * }
 */

export async function runWallapopScrape(/* options = {} */) {
  // TODO: Implement real Wallapop scraping here.
  // - Use puppeteer or axios/fetch to call Wallapop search from a Spain IP.
  // - Normalize listings into the shape described above.
  // - Make sure `source: 'wallapop'` is set on each item.
  //
  // For now we return an empty result so the rest of the system works.
  return { items: [], total: 0 };
}

