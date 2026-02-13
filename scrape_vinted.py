import os
import sys
import time
import re
import base64
from datetime import datetime, timezone
from urllib.parse import urlencode, urljoin, quote

import requests
from bs4 import BeautifulSoup
from pymongo import MongoClient
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
import shutil


def _load_env_from_dotenv() -> None:
  """
  Load environment variables from the same .env files that the Node
  server uses, so this Python script shares configuration (Mongo URI,
  eBay keys, Vinted domain/search, etc.).
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
          if key and key not in os.environ:
            os.environ[key] = value
    except Exception as e:
      print(f"Warning: could not load env file {path}: {e}")
    break


_load_env_from_dotenv()


# --- Shared config (Mongo + Vinted + eBay) -----------------------------------

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/vinted")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "vinted")
MONGO_COLLECTION = os.getenv("MONGO_COLLECTION", "items")

VINTED_DOMAIN = (os.getenv("VINTED_DOMAIN", "es") or "es").lower()
VINTED_SEARCH = os.getenv("VINTED_SEARCH", "sport card")
VINTED_MIN_LIKES = int(os.getenv("VINTED_MIN_LIKES", "10"))
VINTED_MAX_PAGES = int(os.getenv("VINTED_MAX_PAGES", "50"))

BASE_URL = f"https://www.vinted.{VINTED_DOMAIN}"
CATALOG_URL = f"{BASE_URL}/catalog"

EBAY_CLIENT_ID = os.getenv("EBAY_CLIENT_ID")
EBAY_CLIENT_SECRET = os.getenv("EBAY_CLIENT_SECRET")
EBAY_MARKETPLACE_ID = os.getenv("EBAY_MARKETPLACE_ID", "EBAY_ES").upper()
EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
EBAY_BROWSE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search"
EBAY_SCOPE = "https://api.ebay.com/oauth/api_scope"

_ebay_token = None
_ebay_token_expiry = 0.0


def title_has_year(title: str) -> bool:
  if not title or not isinstance(title, str):
    return False
  # Same pattern as Node vintedScraper.js: 1970–2030
  return bool(re.search(r"\b(19[7-9]\d|20[0-2]\d|2030)\b", title))


def create_driver() -> webdriver.Chrome:
  """
  Create a real Chrome browser using Selenium.
  On Linux servers we run headless with extra flags (no-sandbox, etc.).
  """
  chrome_options = Options()

  if sys.platform.startswith("linux"):
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--window-size=1280,800")
    # Prefer system Chrome if available
    for path in ("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"):
      if shutil.which(path):
        chrome_options.binary_location = path
        break
  else:
    # On desktop you can comment out headless to see the browser
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


def get_ebay_access_token() -> str:
  global _ebay_token, _ebay_token_expiry
  if not EBAY_CLIENT_ID or not EBAY_CLIENT_SECRET:
    raise RuntimeError("EBAY_CLIENT_ID and EBAY_CLIENT_SECRET must be set")

  now = time.time()
  if _ebay_token and now < _ebay_token_expiry:
    return _ebay_token

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


def format_ebay_price(value, currency: str | None) -> str | None:
  if value is None:
    return None
  c = (currency or "USD").upper()
  if c == "USD":
    return f"${value}"
  if c == "EUR":
    return f"€{value}"
  return f"{value} {c}"


def search_ebay_current_listings(query: str, limit: int = 5) -> dict:
  if not query or not query.strip():
    return {
      "listings": [],
      "total": 0,
      "minPrice": None,
      "maxPrice": None,
      "currency": None,
    }

  time.sleep(1)  # throttle to avoid eBay "too many requests"
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
    raise RuntimeError(f"eBay search failed: {resp.status_code} {resp.text[:200]}")

  data = resp.json()
  item_summaries = data.get("itemSummaries", []) or []
  listings = []
  prices = []
  currency = None

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
    listings.append(
      {
        "itemId": item.get("itemId"),
        "title": item.get("title") or "",
        "price": format_ebay_price(val_f, cur),
        "priceValue": val_f,
        "currency": cur,
        "url": item.get("itemWebUrl"),
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
  q = quote(title[:80])
  return f"https://www.ebay.com/sch/i.html?_nkw={q}"


def fetch_vinted_page_html(driver: webdriver.Chrome, page_num: int) -> BeautifulSoup:
  """
  Load the public catalog HTML page like:
  https://www.vinted.es/catalog?search_text=sport%20card&page=2
  and return a BeautifulSoup object for parsing.
  """
  params = {
    "search_text": VINTED_SEARCH,
    "page": str(page_num),
  }
  url = f"{CATALOG_URL}?{urlencode(params, doseq=True)}"
  print(f"[VintedPy] Loading catalog page: {url}")
  driver.get(url)
  # Give the page some time to render dynamic content
  time.sleep(3)
  html = driver.page_source
  return BeautifulSoup(html, "html.parser")


def parse_vinted_cards(soup: BeautifulSoup) -> list[dict]:
  """
  Parse Vinted catalog cards from the rendered HTML.

  We target the structure (simplified):

    <div class="new-item-box__container" data-testid="product-item-id-1234">
      <div class="new-item-box__image-container">
        <img ... data-testid="product-item-id-1234--image--img" src="..."/>
        <a class="new-item-box__overlay" href="...items/1234-..." title="Title, marca: Brand, estado: Condition, 12,50 €, 13,83 € Protección ...">
        <button ...>
          <span data-testid="favourite-count-text">10</span>
        </button>
      </div>
      <div class="new-item-box__summary">
        <p data-testid="product-item-id-1234--description-title">Brand</p>
        <p data-testid="product-item-id-1234--description-subtitle">Condition</p>
        <p data-testid="product-item-id-1234--price-text">12,50 €</p>
        ...
      </div>
    </div>
  """
  items: list[dict] = []

  for container in soup.select("div.new-item-box__container"):
    data_id = container.get("data-testid") or ""
    m_id = re.search(r"product-item-id-(\d+)", data_id)
    item_id = int(m_id.group(1)) if m_id else None

    overlay = container.select_one("a.new-item-box__overlay")
    if not overlay:
      continue

    href = overlay.get("href") or ""
    url = href if href.startswith("http") else urljoin(BASE_URL, href)

    raw_title = overlay.get("title") or ""

    # Logical title: part before ", marca:" if present
    if ", marca:" in raw_title:
      title = raw_title.split(", marca:", 1)[0].strip()
    else:
      title = raw_title.strip()

    # Brand and condition from description
    brand_el = container.select_one("p[data-testid$='--description-title']")
    brand = brand_el.get_text(strip=True) if brand_el else ""

    cond_el = container.select_one("p[data-testid$='--description-subtitle']")
    condition = cond_el.get_text(strip=True) if cond_el else ""

    # Base price and price incl. protection
    price_el = container.select_one("p[data-testid$='--price-text']")
    price_text = price_el.get_text(strip=True) if price_el else ""

    # Also parse from the overlay title: two price amounts, first = base, second = incl.
    matches = re.findall(r"\d+[.,]\d{2}\s*€", raw_title)
    price_incl_text = ""
    if matches:
      # Use first as base price if price_text empty, last as price incl.
      if not price_text:
        price_text = matches[0].strip()
      price_incl_text = matches[-1].strip()

    # Likes from favourite-count-text span
    likes = 0
    likes_el = container.select_one("span[data-testid='favourite-count-text']")
    if likes_el:
      txt = likes_el.get_text(strip=True)
      if txt.isdigit():
        likes = int(txt)

    # Photo URL
    img_el = container.select_one("img[data-testid$='--image--img']")
    photo_url = img_el.get("src") if img_el and img_el.get("src") else ""

    items.append(
      {
        "id": item_id,
        "title": title or raw_title,
        "full_title": raw_title,
        "price_text": price_text,
        "price_incl_text": price_incl_text or price_text,
        "url": url,
        "photo_url": photo_url,
        "brand": brand,
        "condition": condition,
        "likes": likes,
      }
    )

  return items


def normalize_item(raw: dict) -> dict:
  photos = raw.get("photos") or []
  main_photo = (photos[0] or {}) if photos else (raw.get("photo") or {})

  price = raw.get("price")
  price_str = ""
  if isinstance(price, dict):
    amount = price.get("amount") or price.get("numeric_amount")
    code = price.get("currency_code") or price.get("currency") or ""
    if amount is not None and code:
      price_str = f"{amount} {code}".strip()
  elif price is not None:
    price_str = str(price)

  conversion = raw.get("conversion") or {}
  total_price = (
    raw.get("total_item_price")
    or raw.get("price_with_buyer_protection")
    or raw.get("real_price_with_shipping")
    or conversion.get("buyer_price")
    or conversion.get("total_buyer_price")
  )
  total_currency = conversion.get("buyer_currency") or (price and price.get("currency_code"))
  price_incl = ""
  if total_price is not None and total_currency:
    if isinstance(total_price, dict):
      amount = total_price.get("amount") or total_price.get("value")
    else:
      amount = total_price
    if amount is not None:
      price_incl = f"{amount} {total_currency}".strip()

  url = raw.get("url") or ""
  if url and not url.startswith("http"):
    url = f"{BASE_URL}{url}"
  photo_url = (
    main_photo.get("url")
    or main_photo.get("full_size_url")
    or ""
  )

  if not title_has_year(raw.get("title", "")):
    return {}

  return {
    "id": raw.get("id"),
    "title": raw.get("title") or "",
    "price": price_str,
    "price_incl_protection": price_incl or price_str,
    "url": url,
    "photo_url": photo_url,
    "brand": (raw.get("brand_title") or (raw.get("brand") or {}).get("title") or ""),
    "condition": raw.get("status") or "",
    "likes": raw.get("favourite_count") or 0,
    "source": "vinted",
  }


def scrape_once():
  client = MongoClient(MONGODB_URI)
  db = client[MONGO_DB_NAME]
  col = db[MONGO_COLLECTION]

  driver = create_driver()
  upserted = 0
  try:
    # Open home once so cookies/session are initialized
    driver.get(BASE_URL)
    time.sleep(3)

    for page_num in range(1, VINTED_MAX_PAGES + 1):
      print(f"[VintedPy] Page {page_num}/{VINTED_MAX_PAGES}")
      try:
        soup = fetch_vinted_page_html(driver, page_num)
      except Exception as e:
        print(f"[VintedPy] error on page {page_num}: {e}")
        break

      items = parse_vinted_cards(soup)
      if not items:
        print("[VintedPy] No more items, stopping.")
        break

      liked = [raw for raw in items if (raw.get("likes") or 0) >= VINTED_MIN_LIKES]
      print(f"  {len(items)} raw, {len(liked)} with likes >= {VINTED_MIN_LIKES}")
      if not liked:
        break

      saved_this_page = 0

      for raw in liked:
        title = (raw.get("title") or "").strip()
        likes = raw.get("likes", 0)
        print(f"    [LIKED] '{title}' – likes={likes}")

        if not title_has_year(title):
          print("      -> skipped: title has no valid year")
          continue

        # Derive an ID (prefer parsed id, fallback to URL)
        item_id = raw.get("id")
        if not item_id:
          m = re.search(r"/items/(\d+)", raw.get("url") or "")
          if m:
            item_id = int(m.group(1))
          else:
            print("      -> skipped: could not derive numeric ID from URL")
            continue

        # Fetch eBay data; skip if no matches
        try:
          ebay = search_ebay_current_listings(title[:200], limit=5)
        except Exception as e:
          print(f"      -> eBay error for '{title}': {e}")
          continue
        if not ebay.get("listings"):
          print("      -> skipped: no eBay listings found")
          continue

        now = datetime.now(timezone.utc)
        doc = {
          "id": item_id,
          "title": title,
          "price": raw.get("price_text", ""),
          "price_incl_protection": raw.get("price_incl_text") or raw.get("price_text", ""),
          "url": raw.get("url", ""),
          "photo_url": raw.get("photo_url", ""),
          "brand": raw.get("brand", ""),
          "condition": raw.get("condition", ""),
          "likes": int(likes or 0),
          "source": "vinted",
          "ebay_from": ebay.get("minPrice"),
          "ebay_to": ebay.get("maxPrice"),
          "ebay_count": ebay.get("total"),
          "ebay_link": build_ebay_link(title),
          "updatedAt": now,
        }

        col.update_one(
          {"id": item_id},
          {"$set": doc, "$setOnInsert": {"createdAt": now}},
          upsert=True,
        )
        saved_this_page += 1
        upserted += 1

      print(f"  -> saved {saved_this_page} items on this page with eBay matches")

      # small polite delay between pages
      time.sleep(2 + 1 * (page_num % 3))
  finally:
    try:
      driver.quit()
    except Exception:
      pass

  print(f"[VintedPy] Upserted {upserted} Vinted items into MongoDB")


def run_forever():
  while True:
    start = datetime.now(timezone.utc)
    print(f"[VintedPy bot] Starting scrape at {start.isoformat()}")
    try:
      scrape_once()
    except Exception as exc:
      print(f"[VintedPy bot] Error during scrape: {exc}")
    end = datetime.now(timezone.utc)
    print(f"[VintedPy bot] Finished scrape at {end.isoformat()}")
    print("[VintedPy bot] Sleeping for 60 minutes (3600 seconds)...")
    time.sleep(60 * 60)


if __name__ == "__main__":
  run_forever()

