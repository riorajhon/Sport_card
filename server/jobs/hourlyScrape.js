import { runScrape, SCRAPE_SEARCH_TERMS } from '../services/vintedScraper.js';
import { processPageItems } from '../services/scrapeProcessor.js';
import { setLastScrapeEndedAt } from '../lastScrape.js';

const MIN_LIKES = 10;
// Vinted: total pages budget across all search terms
const MAX_PAGES = 120;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes sleep between full cycles
// Multiple search terms: total steps = terms × pages per term
const TOTAL_SCRAPE_STEPS = SCRAPE_SEARCH_TERMS.length * Math.ceil(MAX_PAGES / SCRAPE_SEARCH_TERMS.length);

let running = false;

async function runCycle() {
  if (running) {
    console.log('[Hourly cycle] Skipped (previous cycle still in progress)');
    return;
  }
  running = true;
  console.log('[Hourly cycle] Starting Vinted scrape...');

  try {
    // Only Vinted now – Catawiki scraper is handled separately (Python only)
    try {
      console.log('[Hourly cycle] Vinted scrape starting...');
      await runScrape({
        maxPages: MAX_PAGES,
        delayMs: 1500,
        minLikes: MIN_LIKES,
        maxLikes: undefined,
        searchTerms: SCRAPE_SEARCH_TERMS,
        onPage: async (newItems) => {
          if (newItems && newItems.length > 0) {
            await processPageItems(newItems);
          }
        },
      });
      console.log('[Hourly cycle] Vinted scrape done.');
    } catch (err) {
      console.error('[Hourly cycle] Vinted error:', err.message);
      if (err.stack) console.error(err.stack);
    } finally {
      setLastScrapeEndedAt();
    }

    console.log('[Hourly cycle] Full cycle finished. Sleeping 30 minutes...');
  } finally {
    running = false;
    setTimeout(runCycle, INTERVAL_MS);
  }
}

export function runHourlyScrape() {
  // Start first cycle immediately (next tick); subsequent cycles are self-scheduled
  setTimeout(runCycle, 0);
}
