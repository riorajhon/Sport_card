import { runWallapopScrape } from '../services/wallapopScraper.js';
import { processPageItems } from '../services/scrapeProcessor.js';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let running = false;

async function runOnce() {
  if (running) {
    console.log('[Hourly wallapop] Skipped (previous run still in progress)');
    return;
  }
  running = true;
  try {
    console.log('[Hourly wallapop] Starting...');
    const { items } = await runWallapopScrape();
    if (items && items.length > 0) {
      // Ensure items are tagged as Wallapop source
      const normalized = items.map((i) => ({ ...i, source: i.source || 'wallapop' }));
      await processPageItems(normalized);
    }
    console.log('[Hourly wallapop] Done.');
  } catch (err) {
    console.error('[Hourly wallapop] Error:', err.message);
    if (err.stack) console.error(err.stack);
  } finally {
    running = false;
  }
}

export function runHourlyWallapop() {
  setInterval(runOnce, INTERVAL_MS);
  // First run shortly after server start (do not block startup)
  setTimeout(runOnce, 30 * 1000);
}

