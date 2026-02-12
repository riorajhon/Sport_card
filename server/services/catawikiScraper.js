// Catawiki scraper wrapper for the working Python script scrape_catawiki.py.
// We run the Python scraper, which writes catawiki_sport_cards.csv, then
// import that CSV into the Node/MERN pipeline.

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const ROOT = path.resolve(process.cwd());
const CSV_PATH = path.join(ROOT, 'catawiki_sport_cards.csv');

function runPythonScraper() {
  return new Promise((resolve, reject) => {
    console.log('[Catawiki] Running Python scraper: scrape_catawiki.py');
    const proc = spawn('python', ['scrape_catawiki.py'], {
      cwd: ROOT,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`scrape_catawiki.py exited with code ${code}`));
      }
    });
  });
}

// Minimal CSV parser compatible with Python's csv.writer.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // ignore
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (cols[idx] || '').trim();
    });
    return obj;
  });
}

export async function runCatawikiScrape(_options = {}) {
  // 1. Run the Python scraper, which writes catawiki_sport_cards.csv
  await runPythonScraper();

  // 2. Read and parse the CSV
  let csvText;
  try {
    csvText = await fs.readFile(CSV_PATH, 'utf-8');
  } catch (err) {
    console.error('[Catawiki] Could not read CSV:', err.message);
    return { items: [], total: 0 };
  }

  const rows = parseCsv(csvText);

  // 3. Normalize into our item shape
  const items = rows.map((row, index) => {
    const url = row.url || '';
    let id = index + 1;
    const m = url.match(/\/es\/l\/(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) id = n;
    }

    return {
      id,
      title: row.title || `Catawiki lot ${id}`,
      price: row.price_or_current_bid || '',
      price_incl_protection: row.price_or_current_bid || '',
      url,
      photo_url: '',
      brand: '',
      condition: '',
      likes: 0,
      source: 'catawiki',
    };
  });

  console.log(`[Catawiki] Imported ${items.length} items from CSV`);
  return { items, total: items.length };
}

