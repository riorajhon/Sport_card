# Vinted sport cards – MERN stack

Scrape **sport / trading cards** from Vinted and view them in a **React** dashboard. Backend: **Node.js**, **Express**, **MongoDB**. No Python.

## Stack

- **M**ongoDB – store scraped items
- **E**xpress – API (GET items, POST scrape)
- **R**eact – dashboard (Vite)
- **N**ode.js – server + scraper

## Prerequisites

- **Node.js** 18+
- **MongoDB** (local: [MongoDB Community](https://www.mongodb.com/try/download/community) or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) free tier)

## Setup

**1. Environment**

Copy `.env.example` to `.env` in the project root and set at least:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/vinted
PORT=3001
VINTED_DOMAIN=com
VINTED_SEARCH=sport card
# Optional: eBay Browse API for price comparison (current listings)
EBAY_CLIENT_ID=your_app_id
EBAY_CLIENT_SECRET=your_secret
```

**Security:** Never commit real secrets. If you ever shared your eBay client secret (e.g. in chat), regenerate it in the [eBay Developer Portal](https://developer.ebay.com/my/keys) and update `.env`.

**2. Backend**

```bash
cd server
npm install
```

**3. Frontend**

```bash
cd frontend
npm install
```

## Run

**1. Start MongoDB** (if local):

```bash
# Windows (typical)
mongod

# Or use MongoDB Atlas and set MONGODB_URI in .env
```

**2. Start the API** (from project root):

```bash
cd server
npm start
```

Server runs at **http://127.0.0.1:3001**.

**3. Start the React app** (another terminal):

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**.

**4. Load data**

- Click **Scrape Vinted** in the dashboard to fetch sport cards (2 pages by default) and save them to MongoDB, or
- Call the API directly: `POST http://127.0.0.1:3001/api/scrape` (optional body: `{ "max_pages": 5 }`).

## eBay price comparison

If `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` are set, the table has an **eBay** column. Click **Check eBay** on a row to fetch current eBay listings for that card’s title and see “From $X” (min of up to 5 results). This uses the [eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html) (current listings only). The response shape is ready for a future sold-data API (e.g. sold prices).

## API

| Method | Path               | Description                          |
|--------|--------------------|--------------------------------------|
| GET    | /api/items         | List all items from MongoDB          |
| POST   | /api/scrape        | Run scraper, save to MongoDB         |
| GET    | /api/ebay/search   | eBay current listings (query param `q`) |
| GET    | /api/health        | Health check                         |

## Configuration

| Env              | Description                    | Default      |
|------------------|--------------------------------|--------------|
| `MONGODB_URI`    | MongoDB connection string      | `mongodb://127.0.0.1:27017/vinted` |
| `PORT`           | Express server port           | `3001`       |
| `VINTED_DOMAIN`  | Vinted site: `com`, `fr`, `de`, … | `com`     |
| `VINTED_SEARCH`  | Search query for cards         | `sport card` |

## Project structure

```
vinted/
  .env
  server/           # Express + MongoDB + scraper
    index.js
    config.js
    db.js
    models/Item.js
    routes/items.js
    routes/scrape.js
    services/vintedScraper.js
  frontend/         # React (Vite)
    src/App.jsx
```

## Notes

- The scraper uses Vinted’s public catalog API (same as the website). Use moderate `max_pages` and delays.
- Respect [Vinted’s terms of use](https://www.vinted.com/terms_of_use).
