import { runScrape, SCRAPE_SEARCH_TERMS } from '../services/vintedScraper.js';
import { processPageItems } from '../services/scrapeProcessor.js';
import { setLastScrapeEndedAt } from '../lastScrape.js';
import { setProgress, clearProgress, setNextRunInThirtyMin } from '../scrapeProgress.js';

const MIN_LIKES = 10;
const MAX_PAGES = 120;
const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
// Multiple search terms: total steps = terms × pages per term
const TOTAL_SCRAPE_STEPS = SCRAPE_SEARCH_TERMS.length * Math.ceil(MAX_PAGES / SCRAPE_SEARCH_TERMS.length);

let running = false;

async function runOnce() {
  if (running) {
    console.log('[Hourly scrape] Skipped (previous run still in progress)');
    return;
  }
  running = true;
  setNextRunInThirtyMin(); // next run in 30 min
  setProgress({ running: true, currentPage: 0, totalPages: TOTAL_SCRAPE_STEPS });
  try {
    console.log('[Hourly scrape] Starting...');
    await runScrape({
      maxPages: MAX_PAGES,
      delayMs: 1500,
      minLikes: MIN_LIKES,
      maxLikes: undefined,
      searchTerms: SCRAPE_SEARCH_TERMS,
      onPage: async (newItems, progress) => {
        if (progress) {
          setProgress({
            running: true,
            currentPage: progress.step ?? 0,
            totalPages: progress.totalSteps ?? TOTAL_SCRAPE_STEPS,
          });
        }
        if (newItems && newItems.length > 0) {
          await processPageItems(newItems);
        }
      },
    });
    console.log('[Hourly scrape] Done.');
  } catch (err) {
    console.error('[Hourly scrape] Error:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    clearProgress();
    setLastScrapeEndedAt();
    running = false;
  }
}

export function runHourlyScrape() {
  setInterval(runOnce, INTERVAL_MS);
  setTimeout(runOnce, 0); // first run immediately (next tick)
}
