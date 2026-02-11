import { searchCurrentListings } from './ebayService.js';
import { Item } from '../models/Item.js';
import { broadcast } from '../notifications.js';

function buildEbayLink(title) {
  if (!title || typeof title !== 'string') return null;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(title.slice(0, 80))}`;
}

/** Fetch eBay, save to DB, broadcast notification. Returns list of saved items. */
export async function processPageItems(newItems) {
  const saved = [];
  for (const item of newItems) {
    try {
      const ebay = await searchCurrentListings((item.title || '').slice(0, 200), 5);
      if (ebay?.listings?.length > 0) {
        const ebayLink = buildEbayLink(item.title);
        const doc = {
          id: item.id,
          title: item.title || '',
          price: item.price || '',
          price_incl_protection: item.price_incl_protection || item.price || '',
          url: item.url || '',
          photo_url: item.photo_url || '',
          brand: item.brand || '',
          condition: item.condition || '',
          likes: item.likes ?? 0,
          ebay_from: ebay.minPrice ?? null,
          ebay_to: ebay.maxPrice ?? null,
          ebay_count: ebay.total ?? null,
          ebay_link: ebayLink,
        };
        const existing = await Item.findOne({ id: item.id }).lean();
        const updated = await Item.findOneAndUpdate(
          { id: item.id },
          { $set: doc },
          { upsert: true, new: true }
        ).lean();
        const action = existing ? 'updated' : 'added';
        broadcast({
          type: 'notification',
          action,
          item: {
            id: item.id,
            title: item.title || '',
            photo_url: item.photo_url || '',
          },
        });
        saved.push({
          ...item,
          ebayData: { minPrice: ebay.minPrice, maxPrice: ebay.maxPrice, total: ebay.total },
          ebay_link: ebayLink,
          updatedAt: updated?.updatedAt ? new Date(updated.updatedAt).toISOString() : null,
        });
      }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 350));
  }
  return saved;
}
