import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck, Sparkles } from 'lucide-react';
import type { Me } from '../utils/me';
import { getBilling, type PlanId, type PlanOffer } from '../utils/billing';
import { PLAN_LIMITS } from '../server/plans';
import { BRAND } from '../data/brand';

export interface PlansScreenProps {
  me: Me;
  onDone: () => void;
  onNeedSignIn: () => void;
  refreshAccount?: () => Promise<Me | null>;
}

/** Full-screen paywall and subscription plan selection. */
export const PlansScreen: React.FC<PlansScreenProps> = ({
  me,
  onDone,
  onNeedSignIn,
  refreshAccount
}) => {
  const [offers, setOffers] = useState<PlanOffer[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('annual');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isPurchasing, setIsPurchasing] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    getBilling()
      .getOffers(me.userId)
      .then((items) => {
        if (!active) return;
        setOffers(items);
        if (items.some((o) => o.id === 'annual')) {
          setSelectedPlan('annual');
        } else if (items.length > 0) {
          setSelectedPlan(items[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.warn('[Billing] Failed to load offers:', err);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [me.userId]);

  const selectedOffer = offers.find((o) => o.id === selectedPlan) ?? offers[0];

  const handlePurchase = async () => {
    if (me.isAnonymous) {
      onNeedSignIn();
      return;
    }
    if (!selectedOffer) return;

    setIsPurchasing(true);
    setPurchaseError(null);
    try {
      const res = await getBilling().purchase(me.userId, selectedOffer.id);
      if (res.status === 'purchased') {
        if (refreshAccount) {
          for (let i = 0; i < 5; i++) {
            const fresh = await refreshAccount();
            if (fresh?.tier === 'premium') break;
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        setIsSuccess(true);
      } else if (res.status === 'failed') {
        setPurchaseError(res.message);
      }
    } catch (err: unknown) {
      setPurchaseError((err as Error)?.message || 'Purchase could not be completed');
    } finally {
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (me.isAnonymous) {
      onNeedSignIn();
      return;
    }
    setIsRestoring(true);
    setPurchaseError(null);
    try {
      const restored = await getBilling().restore(me.userId);
      if (restored) {
        if (refreshAccount) await refreshAccount();
        onDone();
      } else {
        setPurchaseError('No active subscriptions found to restore.');
      }
    } catch {
      setPurchaseError('Could not restore purchases.');
    } finally {
      setIsRestoring(false);
    }
  };

  const primaryBtnText = selectedOffer?.trialText
    ? 'Start free trial'
    : 'Subscribe';

  const callMins = Math.round(me.limits.voiceSeconds / 60);
  const premiumCallMins = Math.round(PLAN_LIMITS.premium.voiceSeconds / 60);

  if (isSuccess) {
    return (
      <div className="min-h-dvh w-full flex items-center justify-center p-4 sm:p-6 bg-canvas text-ink animate-in fade-in duration-200">
        <div className="w-full max-w-lg bg-surface border border-line rounded-[28px] p-6 sm:p-8 shadow-2xl text-center space-y-6">
          <div className="w-12 h-12 rounded-full bg-mint/20 text-mint flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 text-cobalt" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-ink">
              Welcome to Premium
            </h1>
            <p className="text-sm text-ink-muted">
              Your subscription is active. Enjoy unlimited daily conversation practice with personalized Italian tutors.
            </p>
          </div>
          <div className="pt-4">
            <button
              type="button"
              onClick={onDone}
              className="w-full h-12 flex items-center justify-center rounded-2xl bg-cobalt hover:bg-cobalt-strong text-canvas font-semibold text-base transition-colors shadow-soft"
            >
              Start practising
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-4 sm:p-6 bg-canvas text-ink animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-surface border border-line rounded-[28px] p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cobalt-tint text-cobalt text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Accelerate your fluency</span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl font-semibold text-ink">
            {BRAND.premiumName}
          </h1>
          <p className="text-sm text-ink-muted">
            Unlimited daily conversation practice with personalized Italian tutors.
          </p>
        </div>

        {/* Feature comparison */}
        <div className="p-4 rounded-2xl bg-canvas border border-line space-y-2.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-cobalt-tint text-cobalt flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <span>
              <strong className="font-semibold text-ink font-mono-data">
                {me.limits.chatMessages}
              </strong>{' '}
              →{' '}
              <strong className="font-semibold text-cobalt">
                Unlimited
              </strong>{' '}
              chat messages daily
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-5 h-5 rounded-full bg-cobalt-tint text-cobalt flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
            <span>
              <strong className="font-semibold text-ink font-mono-data">
                {callMins}
              </strong>{' '}
              →{' '}
              <strong className="font-semibold text-cobalt">
                {premiumCallMins}
              </strong>{' '}
              call minutes daily
            </span>
          </div>
        </div>

        {/* Loading / Error / Plans */}
        {isLoading ? (
          <div className="py-8 text-center text-sm text-ink-muted" role="status">
            Loading plans…
          </div>
        ) : offers.length === 0 ? (
          <div className="py-4 text-center space-y-3">
            <p className="text-sm text-ink-muted">
              Plans are currently being prepared. Check back shortly!
            </p>
            <button
              type="button"
              onClick={onDone}
              className="h-11 px-5 rounded-xl border border-line text-sm font-semibold text-ink hover:bg-surface-tint"
            >
              Continue with the free plan
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Plan selection radio group */}
            <div
              role="radiogroup"
              aria-label="Subscription plans"
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              {offers.map((offer) => {
                const isSelected = selectedPlan === offer.id;
                return (
                  <button
                    key={offer.id}
                    type="button"
                    role="radio"
                    disabled={isPurchasing || isRestoring}
                    aria-checked={isSelected}
                    onClick={() => setSelectedPlan(offer.id)}
                    className={`relative p-4 rounded-2xl border text-left transition-all ${
                      isSelected
                        ? 'border-cobalt bg-cobalt-tint/30 shadow-soft ring-2 ring-cobalt/20'
                        : 'border-line hover:border-ink/20 bg-surface'
                    }`}
                  >
                    {offer.trialText && (
                      <span className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full bg-mint text-ink text-[11px] font-semibold shadow-xs">
                        {offer.trialText}
                      </span>
                    )}
                    <p className="text-xs uppercase tracking-wider font-semibold text-ink-muted">
                      {offer.id === 'annual' ? 'Annual Plan' : 'Monthly Plan'}
                    </p>
                    <p className="mt-1 font-serif text-xl font-bold text-ink">
                      {offer.priceText}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {offer.periodText}
                    </p>
                  </button>
                );
              })}
            </div>

            {purchaseError && (
              <p
                role="alert"
                className="text-xs text-red-700 bg-red-50 p-3 rounded-xl border border-red-200"
              >
                {purchaseError}
              </p>
            )}

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                disabled={isPurchasing || isRestoring}
                onClick={handlePurchase}
                className="w-full h-12 flex items-center justify-center rounded-2xl bg-cobalt hover:bg-cobalt-strong text-canvas font-semibold text-base transition-colors shadow-soft disabled:opacity-50"
              >
                {isPurchasing ? 'Opening secure checkout…' : primaryBtnText}
              </button>

              <div className="flex items-center justify-between text-xs text-ink-muted px-1">
                <button
                  type="button"
                  disabled={isPurchasing || isRestoring}
                  onClick={onDone}
                  className="hover:text-ink transition-colors underline"
                >
                  Continue with the free plan
                </button>
                <button
                  type="button"
                  disabled={isPurchasing || isRestoring}
                  onClick={handleRestore}
                  className="hover:text-ink transition-colors underline"
                >
                  {isRestoring ? 'Restoring…' : 'Restore purchases'}
                </button>
              </div>

              <div className="pt-2 text-center space-y-1">
                <p className="text-[11px] text-ink-faint flex items-center justify-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Renews automatically. Cancel any time.</span>
                </p>
                <p className="text-[11px] text-ink-faint space-x-2">
                  <a href="/terms" className="underline hover:text-ink">Terms of Service</a>
                  <span>·</span>
                  <a href="/privacy" className="underline hover:text-ink">Privacy Policy</a>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
