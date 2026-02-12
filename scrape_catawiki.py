import csv
import time
import os
import re
import sys
import shutil
import base64
from datetime import datetime, timezone
from urllib.parse import urljoin, quote

import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from pymongo import MongoClient


def _load_env_from_dotenv() -> None:
    """
    Load environment variables from the Node server .env file so that
    this Python script uses the same config (Mongo URI, eBay keys, etc.).
    Existing environment variables are NOT overridden.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidate_paths = [
        os.path.join(base_dir, "server", ".env"),
        os.path.join(base_dir, ".env"),
    ]

    for path in candidate_paths:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    key = key.strip()
                    value = value.strip()
                    # Don't override anything already present in the real env
                    if key and key not in os.environ:
                        os.environ[key] = value
        except Exception as e:
            print(f"Warning: could not load env file {path}: {e}")
        # Stop at the first .env we successfully read
        break


_load_env_from_dotenv()


BASE_URL = "https://www.catawiki.com"

# Sports card search URL on the Spanish Catawiki site
CATEGORY_URL = "https://www.catawiki.com/es/s?q=sport%20card"

# MongoDB config – use same DB/collection as MERN Item model
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://admin:StrongPassword123@localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "sport")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "items")

# eBay API config – mirror server/services/ebayService.js
EBAY_CLIENT_ID = os.getenv("EBAY_CLIENT_ID")
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET")
EBAY_MARKETPLACE_ID = os.getenv("EBAY_MARKETPLACE_ID", "EBAY_ES").upper()
EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_BROWSE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope"

_ebay_token = None
_ebay_token_expiry = 0.0

MARKETPLACE_DOMAIN = {
    "EBAY_US": "ebay.com",
    "EBAY_GB": "ebay.co.uk",
    "EBAY_DE": "ebay.de",
    "EBAY_ES": "ebay.es",
    "EBAY_FR": "ebay.fr",
    "EBAY_IT": "ebay.it",
    "EBAY_NL": "ebay.nl",
    "EBAY_PL": "ebay.pl",
}


def create_driver() -> webdriver.Chrome:
    """
    Create a real Chrome browser using Selenium.
    This makes our scraper behave much closer to a real user.
    """
    chrome_options = Options()

    # On headless Linux servers (Ubuntu VPS), Chrome often needs extra flags
    # to start correctly (otherwise you see DevToolsActivePort / crashed errors).
    if sys.platform.startswith("linux"):
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1280,800")

        # Prefer a real Google Chrome binary if available
        for path in ("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"):
            if shutil.which(path):
                chrome_options.binary_location = path
                break
    else:
        # On desktop (Windows/macOS) you can see the window by commenting out
        # the next line if you want to debug visually.
        # chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--start-maximized")

    chrome_options.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0 Safari/537.36"
    )

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=chrome_options,
    )
    return driver


def get_ebay_domain() -> str:
    return MARKETPLACE_DOMAIN.get(EBAY_MARKETPLACE_ID, "ebay.com")


def get_ebay_access_token() -> str:
    """
    Get (and cache) an OAuth2 application access token from eBay,
    same as server/services/ebayService.js::getAccessToken.
    """
    global _ebay_token, _ebay_token_expiry
    if not EBAY_CLIENT_ID or not EBAY_CLIENT_SECRET:
        raise RuntimeError("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set")

    now = time.time()
    if _ebay_token and now < _ebay_token_expiry:
        return _ebay_token

    # HTTP Basic auth for eBay OAuth token endpoint (Base64, not hex)
    basic = f"{EBAY_CLIENT_ID}:{EBAY_CLIENT_SECRET}".encode("utf-8")
    auth_header = "Basic " + base64.b64encode(basic).decode("ascii")

    resp = requests.post(
        EBAY_TOKEN_URL,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": auth_header,
        },
        data={
            "grant_type": "client_credentials",
            "scope": EBAY_SCOPE,
        },
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(f"eBay token failed: {resp.status_code} {resp.text}")

    data = resp.json()
    _ebay_token = data.get("access_token")
    expires_in = data.get("expires_in", 7200)
    _ebay_token_expiry = now + float(expires_in) - 60.0
    return _ebay_token


def format_ebay_price(value: float, currency: str | None) -> str | None:
    if value is None:
        return None
    c = (currency or "USD").upper()
    if c == "USD":
        return f"${value}"
    if c == "EUR":
        return f"€{value}"
    return f"{value} {c}"


def search_ebay_current_listings(query: str, limit: int = 5) -> dict:
    """
    Mirror of server/services/ebayService.js::searchCurrentListings.
    Returns dict with listings, total, minPrice, maxPrice, currency.
    """
    if not query or not query.strip():
        return {
            "listings": [],
            "total": 0,
            "minPrice": None,
            "maxPrice": None,
            "currency": None,
        }

    token = get_ebay_access_token()
    params = {
        "q": query.strip()[:350],
        "limit": str(max(1, min(int(limit), 50))),
    }
    resp = requests.get(
        EBAY_BROWSE_SEARCH_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
        },
        params=params,
        timeout=30,
    )
    if not resp.ok:
        raise RuntimeError(
            f"eBay search failed: {resp.status_code} {resp.text[:200]}"
        )

    data = resp.json()
    item_summaries = data.get("itemSummaries", []) or []
    listings = []
    prices = []
    currency = None
    domain = get_ebay_domain()

    for item in item_summaries:
        price = item.get("price") or {}
        value = price.get("value")
        cur = (price.get("currency") or "USD").upper()
        if value is None:
            continue
        try:
            val_f = float(value)
        except (TypeError, ValueError):
            continue
        prices.append(val_f)
        currency = currency or cur
        url = item.get("itemWebUrl") or f"https://www.{domain}/itm/{item.get('itemId')}"
        listings.append(
            {
                "itemId": item.get("itemId"),
                "title": item.get("title") or "",
                "price": format_ebay_price(val_f, cur),
                "priceValue": val_f,
                "currency": cur,
                "url": url,
                "condition": item.get("condition") or item.get("conditionId"),
            }
        )

    if not prices:
        return {
            "listings": [],
            "total": 0,
            "minPrice": None,
            "maxPrice": None,
            "currency": None,
        }

    min_val = min(prices)
    max_val = max(prices)
    total = data.get("total") or len(listings)
    return {
      "listings": listings,
      "total": total,
      "minPrice": format_ebay_price(min_val, currency),
      "maxPrice": format_ebay_price(max_val, currency),
      "currency": currency,
    }


def build_ebay_link(title: str) -> str | None:
    if not title:
        return None
    # Same pattern as server/services/scrapeProcessor.js (View on eBay search)
    domain = get_ebay_domain()
    query = quote(title[:80])
    return f"https://www.{domain}/sch/i.html?_nkw={query}"


def fetch_page_html(driver: webdriver.Chrome, url: str) -> BeautifulSoup:
    """
    Use Selenium to open the page like a real browser and return a BeautifulSoup object.
    """
    driver.get(url)
    # Wait a bit for dynamic content to load
    time.sleep(3)
    html = driver.page_source
    return BeautifulSoup(html, "html.parser")


def parse_listings(soup: BeautifulSoup):
    """
    Extract sports card listings and the URL of the next page.

    NOTE: Catawiki can change its HTML structure.
    If you get 0 results, open the category page in your browser,
    inspect one card, and adjust the CSS selectors below.
    """
    items = []

    # Each search result lot is an <a> linking to /es/l/....
    # We use the anchor text itself to extract title, price and likes (heart count),
    # and try to grab a thumbnail image URL as photo_url.
    for card in soup.select("a[href*='/es/l/']"):
        href = card.get("href")
        if not href:
            continue

        url = urljoin(BASE_URL, href)

        # Get all non-empty text lines inside the card
        text_lines = [
            line.strip()
            for line in card.get_text("\n", strip=True).split("\n")
            if line.strip()
        ]
        if not text_lines:
            continue

        # First line is the title (e.g. "2022 - Leaf - Multi-Sport ...")
        title = text_lines[0]

        price = ""
        label = ""  # e.g. "Puja actual" or "Puja inicial"

        # Find the first line that looks like a price (contains "€")
        for i, line in enumerate(text_lines):
            if "€" in line:
                price = line
                if i > 0:
                    label = text_lines[i - 1]
                break

        # Try to extract likes (heart count) from the card container
        likes = 0
        container = card.parent
        if container is not None:
            # Look for small numbers that could be the favourite count
            for span in container.select("span"):
                txt = span.get_text(strip=True)
                if txt.isdigit():
                    likes = int(txt)
                    break

        # Try to extract a thumbnail image URL
        photo_url = ""
        # First, check for an <img> inside the anchor itself
        img = card.select_one("img")
        if img is None and container is not None:
            # Fallback: look for an <img> in the parent container
            img = container.select_one("img")
        if img is not None:
            src = img.get("src") or img.get("data-src") or img.get("srcset", "").split(" ")[0]
            if src:
                if src.startswith("http"):
                    photo_url = src
                else:
                    photo_url = urljoin(BASE_URL, src)

        items.append(
            {
                "title": title,
                "price_or_current_bid": price,
                "bids": label,
                "time_left": "",
                "url": url,
                "likes": likes,
                "photo_url": photo_url,
            }
        )

    # Find "next page" link (not used in current workflow but kept for reference)
    next_url = None
    next_link = soup.select_one(
        "a[rel='next'], "
        "a[aria-label='Next'], "
        "a[aria-label='Siguiente']"
    )
    if next_link and next_link.get("href"):
        next_url = urljoin(BASE_URL, next_link["href"])

    return items, next_url


def scrape_category(start_url: str):
    """Scrape up to 50 pages of the category and save results into MongoDB."""
    # Hard cap like Vinted: max 50 pages per run
    max_pages = 50

    # Normalise base URL so we can force ?page=1..50 ourselves
    if "&page=" in start_url:
        base_url = start_url.split("&page=", 1)[0]
    else:
        base_url = start_url

    # Open Mongo once for the whole run
    client = MongoClient(MONGODB_URI)
    db = client[MONGO_DB_NAME]
    col = db[MONGO_COLLECTION]

    upserted = 0

    driver = create_driver()
    try:
        for page_num in range(1, max_pages + 1):
            url = f"{base_url}&page={page_num}"
            print(f"Scraping page {page_num}: {url}")
            soup = fetch_page_html(driver, url)
            items, _next_url = parse_listings(soup)
            print(f"  Found {len(items)} raw items on this page")

            # Filter by min likes 10, like Vinted
            liked_items = [it for it in items if it.get("likes", 0) >= 10]
            print(f"  Kept {len(liked_items)} items with likes >= 10")
            if not liked_items:
                print("  No items with enough likes on this page; stopping early.")
                break

            # For each liked item on THIS page, fetch eBay and save to DB
            for row in liked_items:
                title = row.get("title", "") or ""
                # Like the Vinted scraper, skip items that don't have a year in the title.
                # Look for a 4-digit year starting with 19xx or 20xx.
                if not re.search(r"\b(19[5-9]\d|20[0-4]\d)\b", title):
                    continue

                lot_url = row.get("url", "")
                m = re.search(r"/es/l/(\d+)", lot_url)
                if not m:
                    continue
                lot_id = int(m.group(1))

                # Fetch eBay current listings; skip cards with no eBay matches
                try:
                    ebay = search_ebay_current_listings(row.get("title", "")[:200], limit=5)
                except Exception as e:
                    print(f"    eBay error for '{row.get('title', '')}': {e}")
                    continue
                if not ebay.get("listings"):
                    continue

                now = datetime.now(timezone.utc)
                doc = {
                    "id": lot_id,
                    "title": row.get("title", f"Catawiki lot {lot_id}"),
                    "price": row.get("price_or_current_bid", ""),
                    "price_incl_protection": row.get("price_or_current_bid", ""),
                    "url": lot_url,
                    "photo_url": row.get("photo_url", ""),
                    "brand": "",
                    "condition": "",
                    # likes parsed from page (already filtered by >= 10)
                    "likes": int(row.get("likes", 0) or 0),
                    "source": "catawiki",
                    "ebay_from": ebay.get("minPrice"),
                    "ebay_to": ebay.get("maxPrice"),
                    "ebay_count": ebay.get("total"),
                    "ebay_link": build_ebay_link(row.get("title", "")),
                    "updatedAt": now,
                }

                # Ensure createdAt is set only on first insert; updatedAt always updated
                col.update_one(
                    {"id": lot_id},
                    {
                        "$set": doc,
                        "$setOnInsert": {"createdAt": now},
                    },
                    upsert=True,
                )
                upserted += 1

            time.sleep(2)  # be polite between pages
    finally:
        # Some environments can throw RemoteDisconnected when shutting down
        # the ChromeDriver service. We ignore shutdown errors because the
        # scraping work is already done at this point.
        try:
            driver.quit()
        except Exception:
            pass

    print(f"Upserted {upserted} Catawiki lots into MongoDB (with eBay data)")


def run_forever():
    """
    Real-time bot mode:
    - Scrape the Catawiki category.
    - Then sleep for 1 hour.
    - Repeat indefinitely until the process is stopped.
    """
    while True:
        start = datetime.now(timezone.utc)
        print(f"[Catawiki bot] Starting scrape at {start.isoformat()}")
        try:
            scrape_category(CATEGORY_URL)
        except Exception as exc:
            print(f"[Catawiki bot] Error during scrape: {exc}")
        end = datetime.now(timezone.utc)
        print(f"[Catawiki bot] Finished scrape at {end.isoformat()}")
        print("[Catawiki bot] Sleeping for 30 minutes (1800 seconds)...")
        time.sleep(30 * 60)


if __name__ == "__main__":
    # Run as a real-time bot: update MongoDB once per hour.
    run_forever()

