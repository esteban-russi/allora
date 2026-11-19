/** RevenueCat Web Billing client implementation.
 * Provides web checkout using RevenueCat Web Billing SDK with connected Stripe processing.
 */
import type { Billing, PlanId, PlanOffer, PurchaseResult } from './billing';
import { postJson } from './apiClient';

export interface WebBillingDeps {
  loadSdk?: () => Promise<any>;
  email?: () => string | null;
}

/**
 * Format free trial period into human readable string, e.g. "7 days free".
 */
function formatTrialText(phase: any): string | null {
  if (!phase) return null;
  const period = phase.period;
  if (!period || typeof period !== 'object') return null;
  const number = period.number;
  const unit = period.unit;
  if (!number || !unit) return null;
  const unitStr = number === 1 ? unit : `${unit}s`;
  return `${number} ${unitStr} free`;
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
  let purchasesInstance: any = null;
  let configuredUserId: string | null = null;

  async function getSdk(userId: string): Promise<any> {
    const sdkModule = deps?.loadSdk ? await deps.loadSdk() : await import('@revenuecat/purchases-js');
    const PurchasesClass = sdkModule.Purchases || sdkModule.default?.Purchases || sdkModule;

    if (!purchasesInstance) {
      if (typeof PurchasesClass.isConfigured === 'function' && PurchasesClass.isConfigured()) {
        purchasesInstance = PurchasesClass.getSharedInstance();
      } else {
        purchasesInstance = PurchasesClass.configure({ apiKey, appUserId: userId });
        configuredUserId = userId;
        return purchasesInstance;
      }
    }

    if (configuredUserId !== userId) {
      if (typeof purchasesInstance.changeUser === 'function') {
        await purchasesInstance.changeUser(userId);
      } else if (typeof PurchasesClass.configure === 'function') {
        purchasesInstance = PurchasesClass.configure({ apiKey, appUserId: userId });
      }
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
        const offerings = await purchases.getOfferings();
        const currentOffering = offerings?.current;
        if (!currentOffering || !Array.isArray(currentOffering.packages)) {
          return [];
        }

        const packages = currentOffering.packages;
        const offers: PlanOffer[] = [];

        const planConfigs: { id: PlanId; pkgId: string; periodText: string }[] = [
          { id: 'monthly', pkgId: '$rc_monthly', periodText: 'per month' },
          { id: 'annual', pkgId: '$rc_annual', periodText: 'per year' }
        ];

        for (const config of planConfigs) {
          const pkg = packages.find((p: any) => p.identifier === config.pkgId);
          if (!pkg) continue;

          const product = pkg.product || pkg.webBillingProduct || pkg.rcBillingProduct;
          if (!product) continue;

          const price = product.currentPrice || product.price;
          const priceText = price?.formattedPrice || price?.formatted || '';
          if (!priceText) continue;

          const trialPhase =
            product.freeTrialPhase ||
            product.defaultSubscriptionOption?.trial ||
            product.trial ||
            null;
          const trialText = formatTrialText(trialPhase);

          offers.push({
            id: config.id,
            priceText,
            periodText: config.periodText,
            trialText
          });
        }

        return offers;
      } catch (err) {
        console.warn('[BillingWeb] Error fetching offerings:', err);
        return [];
      }
    },

    async purchase(userId: string, plan: PlanId): Promise<PurchaseResult> {
      try {
        const purchases = await getSdk(userId);
        const offerings = await purchases.getOfferings();
        const currentOffering = offerings?.current;
        const targetPkgId = plan === 'monthly' ? '$rc_monthly' : '$rc_annual';
        const rcPackage = currentOffering?.packages?.find((p: any) => p.identifier === targetPkgId);

        if (!rcPackage) {
          return { status: 'failed', message: 'Selected plan is not available.' };
        }

        const customerEmail = deps?.email ? deps.email() : null;
        await purchases.purchase({
          rcPackage,
          ...(customerEmail ? { customerEmail } : {})
        });

        await postJson('/api/billing/sync', {});
        return { status: 'purchased' };
      } catch (err: any) {
        const isCancelled =
          err?.errorCode === 1 ||
          err?.errorCode === 'UserCancelledError' ||
          err?.name === 'UserCancelledError' ||
          (typeof err?.message === 'string' && err.message.toLowerCase().includes('cancel'));

        if (isCancelled) {
          return { status: 'cancelled' };
        }

        return {
          status: 'failed',
          message: 'Payment could not be completed. You have not been charged.'
        };
      }
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
