import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import { config } from './config.js';
import { connectDb } from './db.js';
import { subscribe as subscribeNotifications } from './notifications.js';
import itemsRouter from './routes/items.js';
import scrapeRouter from './routes/scrape.js';
import ebayRouter from './routes/ebay.js';
import { runHourlyScrape } from './jobs/hourlyScrape.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await connectDb();

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/items', itemsRouter);
app.use('/api/scrape', scrapeRouter);
app.use('/api/ebay', ebayRouter);

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/notifications', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  subscribeNotifications(res);
});

runHourlyScrape();

// Production: serve built frontend and SPA fallback
if (process.env.NODE_ENV === 'production') {
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${config.port} (and on your network)`);
  console.log('Hourly scrape enabled (every 1 hour)');
  if (process.env.NODE_ENV === 'production') {
    console.log('Serving frontend from server/public');
  }
});
