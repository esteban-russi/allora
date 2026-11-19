/** Client billing abstraction and fallback interfaces.
 * Provides subscription plan discovery, purchases, and restore operations.
 */

export type PlanId = 'monthly' | 'annual';

export interface PlanOffer {
  id: PlanId;
  priceText: string; // localised, from the store, e.g. "£8.99"
  periodText: string; // "per month" | "per year"
  trialText: string | null; // e.g. "7 days free", null when no trial is offered
}

export type PurchaseResult =
  | { status: 'purchased' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export interface Billing {
  isAvailable(): boolean;
  getOffers(userId: string): Promise<PlanOffer[]>;
  purchase(userId: string, plan: PlanId): Promise<PurchaseResult>;
  restore(userId: string): Promise<boolean>;
  manageUrl(userId: string): Promise<string | null>;
}

/** Fallback billing implementation reporting unavailable state. */
export const unavailableBilling: Billing = {
  isAvailable: () => false,
  getOffers: async () => [],
  purchase: async () => ({
    status: 'failed',
    message: 'Billing is not available'
  }),
  restore: async () => false,
  manageUrl: async () => null
};

let currentBilling: Billing = unavailableBilling;

/**
 * Configure the active billing implementation.
 *
 * Args:
 *   b: Billing interface implementation.
 */
export function setBilling(b: Billing): void {
  currentBilling = b;
}

/**
 * Retrieve the active billing implementation.
 *
 * Returns:
 *   The currently configured Billing instance.
 */
export function getBilling(): Billing {
  return currentBilling;
}
