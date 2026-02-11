/** In-memory scrape progress for UI. */
const THIRTY_MIN_MS = 30 * 60 * 1000;

let state = {
  running: false,
  currentPage: 0,
  totalPages: 0,
  /** Next scrape run time (timestamp). */
  nextScrapeAt: null,
  /** Period in ms (30 min). */
  periodMs: null,
};

export function getProgress() {
  return { ...state };
}

export function setProgress({ running, currentPage, totalPages, nextScrapeAt, periodMs }) {
  if (running != null) state.running = running;
  if (currentPage != null) state.currentPage = currentPage;
  if (totalPages != null) state.totalPages = totalPages;
  if (nextScrapeAt != null) state.nextScrapeAt = nextScrapeAt;
  if (periodMs != null) state.periodMs = periodMs;
}

export function clearProgress() {
  const now = Date.now();
  state = {
    running: false,
    currentPage: 0,
    totalPages: 0,
    nextScrapeAt: now + THIRTY_MIN_MS,
    periodMs: THIRTY_MIN_MS,
  };
}

/** Call when a scrape is about to start (next run in 30 min). */
export function setNextRunInThirtyMin() {
  state.nextScrapeAt = Date.now() + THIRTY_MIN_MS;
  state.periodMs = THIRTY_MIN_MS;
}
