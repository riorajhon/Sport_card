import { runScrape } from '../services/vintedScraper.js';
import { processPageItems } from '../services/scrapeProcessor.js';
import { setLastScrapeEndedAt } from '../lastScrape.js';

const MIN_LIKES = 10;
const MAX_PAGES = 50;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let running = false;

async function runOnce() {
  if (running) {
    console.log('[Hourly scrape] Skipped (previous run still in progress)');
    return;
  }
  running = true;
  try {
    console.log('[Hourly scrape] Starting...');
    await runScrape({
      maxPages: MAX_PAGES,
      delayMs: 1500,
      minLikes: MIN_LIKES,
      maxLikes: undefined,
      searchText: undefined,
      onPage: async (newItems) => {
        if (newItems && newItems.length > 0) {
          await processPageItems(newItems);
        }
      },
    });
    console.log('[Hourly scrape] Done.');
  } catch (err) {
    console.error('[Hourly scrape] Error:', err.message);
  } finally {
    setLastScrapeEndedAt();
    running = false;
  }
}

export function runHourlyScrape() {
  setInterval(runOnce, INTERVAL_MS);
  // Run first time after 2 minutes so server can start without blocking
  setTimeout(runOnce, 2 * 60 * 1000);
}
