/** RevenueCat Web Billing client implementation.
 * Provides web checkout using RevenueCat Web Billing SDK with connected Stripe processing.
 */
import type { Offering, Package, PricingPhase, Purchases } from '@revenuecat/purchases-js';
import type { Billing, PlanId, PlanOffer, PurchaseResult } from './billing';
import { getWithAuth, postJson } from './apiClient';

/** The SDK's `Purchases` class (its static side), as exported by `@revenuecat/purchases-js`. */
type PurchasesStatic = typeof import('@revenuecat/purchases-js').Purchases;

export interface WebBillingDeps {
  loadSdk?: () => Promise<{ Purchases: PurchasesStatic }>;
  email?: () => string | null;
}

/** `ErrorCode.UserCancelledError` in the SDK; kept as a number so the SDK stays lazily loaded. */
const USER_CANCELLED_ERROR_CODE = 1;

const PLAN_PACKAGES: { id: PlanId; packageId: string; periodText: string }[] = [
  { id: 'monthly', packageId: '$rc_monthly', periodText: 'per month' },
  { id: 'annual', packageId: '$rc_annual', periodText: 'per year' }
];

/**
 * Format free trial period into human readable string, e.g. "7 days free".
 */
function formatTrialText(phase: PricingPhase | null | undefined): string | null {
  const period = phase?.period;
  if (!period || !period.number || !period.unit) return null;
  const unit = period.number === 1 ? period.unit : `${period.unit}s`;
  return `${period.number} ${unit} free`;
}

/** The package for a plan in an offering, or undefined when the offering does not sell it. */
function findPackage(offering: Offering | null | undefined, packageId: string): Package | undefined {
  return offering?.availablePackages?.find((pkg) => pkg.identifier === packageId);
}

/**
 * Creates a Billing implementation backed by RevenueCat Web Billing.
 *
 * Args:
 *   apiKey: RevenueCat Web Billing public API key.
 *   deps: Optional dependencies for test injection (SDK loader, customer email getter).
 *
 * Returns:
 *   Configured Billing provider.
 */
export function createWebBilling(apiKey: string, deps?: WebBillingDeps): Billing {
  let purchasesInstance: Purchases | null = null;
  let configuredUserId: string | null = null;

  async function getSdk(userId: string): Promise<Purchases> {
    const sdkModule = deps?.loadSdk ? await deps.loadSdk() : await import('@revenuecat/purchases-js');
    const PurchasesClass = sdkModule.Purchases;

    if (!purchasesInstance) {
      if (PurchasesClass.isConfigured()) {
        purchasesInstance = PurchasesClass.getSharedInstance();
      } else {
        purchasesInstance = PurchasesClass.configure({ apiKey, appUserId: userId });
        configuredUserId = userId;
        return purchasesInstance;
      }
    }

    if (configuredUserId !== userId) {
      await purchasesInstance.changeUser(userId);
      configuredUserId = userId;
    }

    return purchasesInstance;
  }

  return {
    isAvailable(): boolean {
      return true;
    },

    async getOffers(userId: string): Promise<PlanOffer[]> {
      try {
        const purchases = await getSdk(userId);
        const offering = (await purchases.getOfferings()).current;
        const offers: PlanOffer[] = [];

        for (const plan of PLAN_PACKAGES) {
          const product = findPackage(offering, plan.packageId)?.product;
          const priceText = product?.price?.formattedPrice;
          if (!product || !priceText) continue;

          offers.push({
            id: plan.id,
            priceText,
            periodText: plan.periodText,
            trialText: formatTrialText(product.freeTrialPhase)
          });
        }

        return offers;
      } catch (err) {
        console.warn('[BillingWeb] Error fetching offerings:', err);
        return [];
      }
    },

    async purchase(userId: string, plan: PlanId): Promise<PurchaseResult> {
      let purchases: Purchases;
      let rcPackage: Package | undefined;
      try {
        purchases = await getSdk(userId);
        const offering = (await purchases.getOfferings()).current;
        rcPackage = findPackage(offering, plan === 'monthly' ? '$rc_monthly' : '$rc_annual');
      } catch (err) {
        console.warn('[BillingWeb] Error loading plans for purchase:', err);
        return { status: 'failed', message: 'Could not load the plans. You have not been charged.' };
      }

      if (!rcPackage) {
        return { status: 'failed', message: 'Selected plan is not available.' };
      }

      try {
        const customerEmail = deps?.email ? deps.email() : null;
        await purchases.purchase({
          rcPackage,
          ...(customerEmail ? { customerEmail } : {})
        });
      } catch (err) {
        if ((err as { errorCode?: unknown } | null)?.errorCode === USER_CANCELLED_ERROR_CODE) {
          return { status: 'cancelled' };
        }
        return {
          status: 'failed',
          message: 'Payment could not be completed. You have not been charged.'
        };
      }

      // The payment went through. A failed sync must not be reported as a failed payment:
      // the caller polls the account, and the RevenueCat webhook updates it as well.
      try {
        const res = await postJson('/api/billing/sync', {});
        if (!res.ok) console.warn(`[BillingWeb] Subscription sync after purchase returned ${res.status}`);
      } catch (err) {
        console.warn('[BillingWeb] Subscription sync after purchase failed:', err);
      }
      return { status: 'purchased' };
    },

    async restore(_userId: string): Promise<boolean> {
      try {
        const res = await postJson('/api/billing/sync', {});
        if (!res.ok) return false;
        const data = await res.json();
        return data?.tier === 'premium';
      } catch (_err) {
        return false;
      }
    },

    async manageUrl(userId: string): Promise<string | null> {
      try {
        const res = await getWithAuth('/api/billing/manage');
        if (res.status === 200) {
          const data = (await res.json()) as { url?: unknown };
          if (typeof data?.url === 'string' && data.url.length > 0) {
            return data.url;
          }
        }
      } catch {
        // Fall back to the SDK managementURL on network or parse errors.
      }

      try {
        const purchases = await getSdk(userId);
        const info = await purchases.getCustomerInfo();
        return info?.managementURL ?? null;
      } catch (err) {
        console.warn('[BillingWeb] Error fetching customer info for managementURL:', err);
        return null;
      }
    }
  };
}
