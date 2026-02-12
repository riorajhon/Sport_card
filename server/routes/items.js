import { Router } from 'express';
import { Item } from '../models/Item.js';
import { getLastScrapeEndedAt } from '../lastScrape.js';
import { config } from '../config.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const docs = await Item.find().sort({ updatedAt: -1 }).lean();
    const items = docs.map((doc) => {
      const item = {
        id: doc.id,
        title: doc.title,
        price: doc.price,
        price_incl_protection: doc.price_incl_protection || doc.price,
        url: doc.url,
        photo_url: doc.photo_url,
        brand: doc.brand,
        condition: doc.condition,
        likes: doc.likes,
        source: doc.source || 'vinted',
        updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
      };
      if (doc.ebay_from != null || doc.ebay_to != null || doc.ebay_count != null) {
        item.ebayData = {
          minPrice: doc.ebay_from,
          maxPrice: doc.ebay_to,
          total: doc.ebay_count,
        };
        item.ebay_link = doc.ebay_link || null;
      }
      return item;
    });
    res.json({
      items,
      total: items.length,
      lastScrapeEndedAt: getLastScrapeEndedAt(),
      vintedDomain: config.vinted.domain,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const result = await Item.findOneAndDelete({ id });
    if (!result) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
