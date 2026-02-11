import { Router } from 'express';
import { runScrape } from '../services/vintedScraper.js';
import { processPageItems } from '../services/scrapeProcessor.js';
import { setLastScrapeEndedAt } from '../lastScrape.js';
import { getProgress } from '../scrapeProgress.js';

const router = Router();

/** GET /api/scrape/status – current scrape progress for UI */
router.get('/status', (req, res) => {
  res.json(getProgress());
});

const FIXED_MIN_LIKES = 10;
const FIXED_MAX_PAGES = 100;

function buildEbayLink(title) {
  if (!title || typeof title !== 'string') return null;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title.slice(0, 80))}`;
}

router.post('/', async (req, res) => {
  try {
    const maxPages = parseInt(req.body.max_pages || req.query.max_pages || '2', 10);
    const minLikes = req.body.min_likes != null ? parseInt(req.body.min_likes, 10) : undefined;
    const maxLikes = req.body.max_likes != null ? parseInt(req.body.max_likes, 10) : undefined;
    const searchText = typeof req.body.search_text === 'string' ? req.body.search_text.trim() : undefined;
    const result = await runScrape({ maxPages, delayMs: 1500, minLikes, maxLikes, searchText });
    res.json({ success: true, items: result.items, total: result.total });
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** POST /api/scrape/stream – SSE stream (fixed 100 pages, min likes 10). */
router.post('/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  try {
    let totalDisplayed = 0;
    const result = await runScrape({
      maxPages: FIXED_MAX_PAGES,
      delayMs: 1500,
      minLikes: FIXED_MIN_LIKES,
      maxLikes: undefined,
      searchText: undefined,
      onPage: async (newItems, progress) => {
        if (progress) send({ type: 'progress', ...progress });
        if (!newItems || newItems.length === 0) return;
        const saved = await processPageItems(newItems);
        if (saved.length > 0) {
          totalDisplayed += saved.length;
          send({ type: 'items', items: saved });
        }
      },
    });
    send({ type: 'done', total: totalDisplayed });
  } catch (err) {
    console.error('Scrape stream error:', err);
    send({ type: 'error', error: err.message });
  } finally {
    setLastScrapeEndedAt();
    res.end();
  }
});

export default router;
