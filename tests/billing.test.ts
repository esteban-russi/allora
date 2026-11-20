import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBilling,
  setBilling,
  unavailableBilling,
  type Billing,
  type PlanOffer
} from '../src/platform/client/billing';

describe('billing interface', () => {
  beforeEach(() => {
    setBilling(unavailableBilling);
  });

  it('defaults to unavailableBilling', async () => {
    const billing = getBilling();
    expect(billing.isAvailable()).toBe(false);
    expect(await billing.getOffers('u1')).toEqual([]);
    expect(await billing.purchase('u1', 'monthly')).toEqual({
      status: 'failed',
      message: 'Billing is not available'
    });
    expect(await billing.restore('u1')).toBe(false);
    expect(await billing.manageUrl('u1')).toBeNull();
  });

  it('allows setting and retrieving a custom billing implementation', async () => {
    const customOffers: PlanOffer[] = [
      {
        id: 'monthly',
        priceText: '£8.99',
        periodText: 'per month',
        trialText: null
      },
      {
        id: 'annual',
        priceText: '£59.99',
        periodText: 'per year',
        trialText: '7 days free'
      }
    ];

    const customBilling: Billing = {
      isAvailable: () => true,
      getOffers: async () => customOffers,
      purchase: async (_userId, _plan) => ({ status: 'purchased' }),
      restore: async () => true,
      manageUrl: async () => 'https://billing.example.com'
    };

    setBilling(customBilling);
    const active = getBilling();

    expect(active.isAvailable()).toBe(true);
    expect(await active.getOffers('u1')).toEqual(customOffers);
    expect(await active.purchase('u1', 'annual')).toEqual({ status: 'purchased' });
    expect(await active.restore('u1')).toBe(true);
    expect(await active.manageUrl('u1')).toBe('https://billing.example.com');
  });
});
