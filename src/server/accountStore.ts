/** Account records, subscription metadata, and storage contracts. */

export type Tier = 'guest' | 'free' | 'premium';

export interface Subscription {
  status: 'active' | 'grace' | 'expired';
  productId: string; // e.g. "parliamo_pro_annual"
  store: 'play_store' | 'web';
  periodType: 'trial' | 'normal';
  expiresAt: string; // ISO time
  willRenew: boolean;
  updatedAt: string; // ISO time
}

export interface Account {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  subscription: Subscription | null; // null until plan 05 writes it
  createdAt: string; // ISO time
  lastSeenAt: string; // ISO time
}
