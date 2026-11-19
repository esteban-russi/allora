/** Tests for RevenueCat Web Billing implementation. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createWebBilling } from '../src/utils/billingWeb';
import * as apiModule from '../src/utils/apiClient';

describe('createWebBilling', () => {
  const sampleOfferings = {
    current: {
      packages: [
        {
          identifier: '$rc_monthly',
          product: {
            identifier: 'monthly_prod',
            price: { formattedPrice: '£8.99' },
            freeTrialPhase: null
          }
        },
        {
          identifier: '$rc_annual',
          product: {
            identifier: 'annual_prod',
            currentPrice: { formattedPrice: '£59.99' },
            defaultSubscriptionOption: {
              trial: {
                period: { number: 7, unit: 'day' }
              }
            }
          }
        },
        {
          identifier: 'other_pkg',
          product: null
        }
      ]
    }
  };

  let mockSdk: any;

  beforeEach(() => {
    mockSdk = {
      configure: vi.fn().mockReturnThis(),
      isConfigured: vi.fn().mockReturnValue(false),
      getSharedInstance: vi.fn().mockReturnThis(),
      changeUser: vi.fn().mockResolvedValue({}),
      getOfferings: vi.fn().mockResolvedValue(sampleOfferings),
      purchase: vi.fn().mockResolvedValue({}),
      getCustomerInfo: vi.fn().mockResolvedValue({
        managementURL: 'https://app.revenuecat.com/manage/test'
      })
    };
    vi.restoreAllMocks();
  });

  function createBilling(email: string | null = 'user@example.com') {
    return createWebBilling('rcb_sb_testkey', {
      loadSdk: async () => ({ Purchases: mockSdk }),
      email: () => email
    });
  }

  it('reports isAvailable as true', () => {
    const billing = createBilling();
    expect(billing.isAvailable()).toBe(true);
  });

  it('maps offerings correctly with and without trials', async () => {
    const billing = createBilling();
    const offers = await billing.getOffers('u1');

    expect(offers).toEqual([
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
    ]);
  });

  it('switches user when user ID changes', async () => {
    const billing = createBilling();
    await billing.getOffers('u1');
    expect(mockSdk.configure).toHaveBeenCalledWith({ apiKey: 'rcb_sb_testkey', appUserId: 'u1' });

    await billing.getOffers('u2');
    expect(mockSdk.changeUser).toHaveBeenCalledWith('u2');
  });

  it('performs purchase, calls billing sync, and returns purchased on success', async () => {
    const postJsonSpy = vi.spyOn(apiModule, 'postJson').mockResolvedValue({
      ok: true,
      json: async () => ({ tier: 'premium' })
    } as any);

    const billing = createBilling('customer@example.com');
    const result = await billing.purchase('u1', 'annual');

    expect(result).toEqual({ status: 'purchased' });
    expect(mockSdk.purchase).toHaveBeenCalledWith({
      rcPackage: sampleOfferings.current.packages[1],
      customerEmail: 'customer@example.com'
    });
    expect(postJsonSpy).toHaveBeenCalledWith('/api/billing/sync', {});
  });

  it('returns cancelled when user cancels purchase', async () => {
    mockSdk.purchase.mockRejectedValue({ errorCode: 1, message: 'User cancelled' });
    const billing = createBilling();

    const result = await billing.purchase('u1', 'monthly');
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('returns failed with safe error message on unexpected purchase error', async () => {
    mockSdk.purchase.mockRejectedValue(new Error('Card declined: insufficient funds'));
    const billing = createBilling();

    const result = await billing.purchase('u1', 'monthly');
    expect(result).toEqual({
      status: 'failed',
      message: 'Payment could not be completed. You have not been charged.'
    });
  });

  it('returns failed when selected plan package is not in offerings', async () => {
    mockSdk.getOfferings.mockResolvedValueOnce({ current: { packages: [] } });
    const billing = createBilling();

    const result = await billing.purchase('u1', 'monthly');
    expect(result).toEqual({
      status: 'failed',
      message: 'Selected plan is not available.'
    });
  });

  it('restores purchases by calling sync and checking premium tier', async () => {
    const postJsonSpy = vi
      .spyOn(apiModule, 'postJson')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tier: 'premium' })
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tier: 'free' })
      } as any);

    const billing = createBilling();

    expect(await billing.restore('u1')).toBe(true);
    expect(await billing.restore('u1')).toBe(false);
    expect(postJsonSpy).toHaveBeenCalledTimes(2);
  });

  it('fetches managementURL from customer info', async () => {
    const billing = createBilling();
    const url = await billing.manageUrl('u1');
    expect(url).toBe('https://app.revenuecat.com/manage/test');
  });

  it('returns null managementURL when getCustomerInfo throws', async () => {
    mockSdk.getCustomerInfo.mockRejectedValue(new Error('Network error'));
    const billing = createBilling();
    const url = await billing.manageUrl('u1');
    expect(url).toBeNull();
  });
});
