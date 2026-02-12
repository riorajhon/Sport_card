import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vinted',
  ebay: {
    clientId: process.env.EBAY_CLIENT_ID || '',
    clientSecret: process.env.EBAY_CLIENT_SECRET || '',
    /** e.g. EBAY_ES, EBAY_DE, EBAY_US – used for Browse API and buy links */
    marketplaceId: (process.env.EBAY_MARKETPLACE_ID || 'EBAY_ES').toUpperCase(),
  },
  vinted: {
    /** EU: es, fr, de, it, nl, pl. US/UK: com, uk – use EU for buyable shipping in Europe */
    domain: (process.env.VINTED_DOMAIN || 'es').toLowerCase(),
    search: process.env.VINTED_SEARCH || 'sport card',
    requestTimeout: 30000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
};
