import { Item } from './models/Item.js';
import { broadcast } from './notifications.js';

let lastSeenUpdatedAt = null;
let intervalId = null;

async function checkForNewItems() {
  try {
    const since =
      lastSeenUpdatedAt ||
      // On first run, start from "now" so we don't spam old records
      new Date();

    const docs = await Item.find({
      updatedAt: { $gt: since },
    })
      .sort({ updatedAt: 1 })
      .lean();

    if (!docs.length) {
      if (!lastSeenUpdatedAt) {
        lastSeenUpdatedAt = since;
      }
      return;
    }

    for (const doc of docs) {
      const updatedAt = doc.updatedAt ? new Date(doc.updatedAt) : since;
      const createdAt = doc.createdAt ? new Date(doc.createdAt) : updatedAt;

      // If createdAt is after the last seen time, treat as "added", otherwise "updated"
      const action =
        !lastSeenUpdatedAt || createdAt > lastSeenUpdatedAt ? 'added' : 'updated';

      lastSeenUpdatedAt = updatedAt;

      broadcast({
        type: 'notification',
        action,
        item: {
          id: doc.id,
          title: doc.title || '',
          photo_url: doc.photo_url || '',
          source: doc.source || 'vinted',
        },
      });
    }
  } catch (err) {
    console.error('[MongoWatcher] Error while checking for new/updated items:', err.message);
  }
}

export function startCatawikiWatcher(pollIntervalMs = 30_000) {
  if (intervalId) return;
  intervalId = setInterval(checkForNewItems, pollIntervalMs);
}

