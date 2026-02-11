import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
}
