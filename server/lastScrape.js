/** Last time a scrape run finished (for "Last updated" display). */
let lastScrapeEndedAt = null;

export function setLastScrapeEndedAt() {
  lastScrapeEndedAt = new Date().toISOString();
}

export function getLastScrapeEndedAt() {
  return lastScrapeEndedAt;
}
