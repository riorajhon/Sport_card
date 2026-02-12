import { Item } from './models/Item.js';
import { broadcast } from './notifications.js';

let lastSeenCreatedAt = null;
let intervalId = null;

async function checkForNewCatawikiItems() {
  try {
    const since =
      lastSeenCreatedAt ||
      // On first run, start from "now" so we don't spam old records
      new Date();

    const docs = await Item.find({
      source: 'catawiki',
      createdAt: { $gt: since },
    })
      .sort({ createdAt: 1 })
      .lean();

    if (!docs.length) {
      // If this was the very first run and there were no newer docs,
      // make sure we at least move the pointer forward once.
      if (!lastSeenCreatedAt) {
        lastSeenCreatedAt = since;
      }
      return;
    }

    for (const doc of docs) {
      lastSeenCreatedAt = new Date(doc.createdAt);
      broadcast({
        type: 'notification',
        action: 'added',
        item: {
          id: doc.id,
          title: doc.title || '',
          photo_url: doc.photo_url || '',
        },
      });
    }
  } catch (err) {
    // Log once; do not crash the server if Mongo is temporarily unavailable
    console.error('[CatawikiWatcher] Error while checking for new items:', err.message);
  }
}

export function startCatawikiWatcher(pollIntervalMs = 30_000) {
  if (intervalId) return;
  intervalId = setInterval(checkForNewCatawikiItems, pollIntervalMs);
}

