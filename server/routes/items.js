import { Router } from 'express';
import { Item } from '../models/Item.js';
import { getLastScrapeEndedAt } from '../lastScrape.js';
import { config } from '../config.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limitRaw = parseInt(req.query.limit || '30', 10);
    const limit = Number.isNaN(limitRaw) ? 30 : Math.min(Math.max(limitRaw, 1), 100);
    const skip = (page - 1) * limit;

    const source = (req.query.source || 'all').toString();
    const sortKey = (req.query.sort || 'updatedAt').toString();
    const sortDir = (req.query.dir || 'desc').toString() === 'asc' ? 1 : -1;

    const query = {};
    if (source === 'vinted') {
      query.source = 'vinted';
    } else if (source === 'catawiki') {
      query.source = 'catawiki';
    }

    let sortField = 'updatedAt';
    if (sortKey === 'likes') {
      sortField = 'likes';
    } else if (sortKey === 'updatedAt') {
      sortField = 'updatedAt';
    }
    const sort = { [sortField]: sortDir };

    // Run counts in parallel for efficiency
    const [total, vintedCount, catawikiCount, ebayAgg] = await Promise.all([
      Item.countDocuments(query),
      // Treat items with no explicit source as Vinted for backwards compatibility
      Item.countDocuments({ $or: [{ source: 'vinted' }, { source: { $exists: false } }] }),
      Item.countDocuments({ source: 'catawiki' }),
      Item.aggregate([
        { $match: { ebay_count: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$ebay_count' } } },
      ]),
    ]);

    // Page of items, sorted based on sort parameters
    const docs = await Item.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

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

    // Top 6 cards by likes (for the header section).
    // We don't require likes > 0 so the UI can still
    // show up to 6 cards even when only a few have likes.
    const topLikedDocs = await Item.find({})
      .sort({ likes: -1, updatedAt: -1 })
      .limit(6)
      .lean();
    const topLiked = topLikedDocs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      url: doc.url,
      photo_url: doc.photo_url,
      likes: doc.likes,
      source: doc.source || 'vinted',
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    }));

    const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
    const ebayTotalCount =
      Array.isArray(ebayAgg) && ebayAgg.length > 0 && typeof ebayAgg[0].total === 'number'
        ? ebayAgg[0].total
        : 0;

    res.json({
      items,
      total,
      page,
      limit,
      totalPages,
      vintedCount,
      catawikiCount,
      ebayTotalCount,
      topLiked,
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
