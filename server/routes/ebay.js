import { Router } from 'express';
import { searchCurrentListings } from '../services/ebayService.js';

const router = Router();

/**
 * GET /api/ebay-search?q=...
 * Query param q = search string (e.g. Vinted card title).
 * Returns current eBay listings; response shape allows adding soldListings later.
 */
router.get('/search', async (req, res) => {
  const q = req.query.q;
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Missing query param q' });
  }

  try {
    const result = await searchCurrentListings(q, limit);
    res.json(result);
  } catch (err) {
    console.error('eBay search error:', err);
    res.status(500).json({ error: err.message || 'eBay search failed' });
  }
});

export default router;
