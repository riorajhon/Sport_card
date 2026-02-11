import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    title: { type: String, default: '' },
    price: { type: String, default: '' },
    price_incl_protection: { type: String, default: '' },
    url: { type: String, default: '' },
    photo_url: { type: String, default: '' },
    brand: { type: String, default: '' },
    condition: { type: String, default: '' },
    likes: { type: Number, default: 0 },
    // eBay summary only (no full listings)
    ebay_from: { type: String, default: null },
    ebay_to: { type: String, default: null },
    ebay_count: { type: Number, default: null },
    ebay_link: { type: String, default: null },
  },
  { timestamps: true }
);

export const Item = mongoose.model('Item', itemSchema);
