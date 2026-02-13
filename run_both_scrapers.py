"""
Run both scrapers on one machine: Vinted first, then Catawiki, then sleep 3 hours.
Use this instead of running scrape_vinted.py and scrape_catawiki.py separately.

  python run_both_scrapers.py

Flow each cycle:
  1. Check eBay buy.browse remaining (once).
  2. If remaining <= 0: skip both, do not update last-update times, sleep 3h.
  3. Else:
     - Save vintedLastUpdate (start time), run Vinted scrape.
     - Save catawikiLastUpdate (start time), run Catawiki scrape.
     - Sleep 3 hours.
  4. Repeat.
"""

import time
from datetime import datetime, timezone

# Import after env is loaded by each module (they both load server/.env)
import scrape_vinted
import scrape_catawiki


SLEEP_SECONDS = 3 * 60 * 60  # 3 hours


def run_cycle():
    start = datetime.now(timezone.utc)
    print(f"[Both] Starting cycle at {start.isoformat()}")

    remaining = scrape_vinted.get_ebay_browse_remaining()
    print(f"[Both] eBay buy.browse remaining: {remaining}")

    if remaining <= 0:
        print("[Both] No remaining — skipping run (not updating last update time)")
        return

    # 1) Vinted
    scrape_vinted.save_vinted_last_update(start)
    print("[Both] --- Vinted ---")
    try:
        scrape_vinted.scrape_once()
        print(f"[Both] Vinted finished at {datetime.now(timezone.utc).isoformat()}")
    except Exception as exc:
        print(f"[Both] Vinted error: {exc}")

    # 2) Catawiki (start time for dashboard)
    catawiki_start = datetime.now(timezone.utc)
    scrape_catawiki.save_catawiki_last_update(catawiki_start)
    print("[Both] --- Catawiki ---")
    try:
        scrape_catawiki.scrape_category(scrape_catawiki.CATEGORY_URL)
        print(f"[Both] Catawiki finished at {datetime.now(timezone.utc).isoformat()}")
    except Exception as exc:
        print(f"[Both] Catawiki error: {exc}")


def main():
    print("[Both] Combined scraper: Vinted -> Catawiki -> sleep 3h (one machine)")
    while True:
        run_cycle()
        print(f"[Both] Sleeping for 3 hours ({SLEEP_SECONDS} seconds)...")
        time.sleep(SLEEP_SECONDS)


if __name__ == "__main__":
    main()
