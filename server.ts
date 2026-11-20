import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachLiveBridge } from './src/server/liveBridge';
import { summarizeError } from './src/server/vertexCooldown';
import {
  CHAT_MODEL,
  GCP_PROJECT,
  GCP_REGION,
  LIVE_MODEL,
  TTS_MODEL,
  buildLiveClientOptions,
  fallbackAi,
  hasGenAiCredentials,
  primaryAi,
  vertexCooldown
} from './src/server/genAi';
import { assertAuthConfig, authenticateHttpUser, isAuthEnforced } from './src/server/auth';
import { requireAppCheck } from './src/server/appCheck';
import { defaultSessionStore } from './src/server/defaultSessionStore';
import { attachAccount } from './src/server/accountMiddleware';
import { defaultAccountStore } from './src/server/defaultAccountStore';
import { defaultUsageStore } from './src/server/defaultUsageStore';
import { nextResetAt, usageDay } from './src/server/usageStore';
import { createUserRateLimitMiddleware, defaultUserLimiter } from './src/server/rateLimiter';
import {
  getPrivacyPolicyConfig,
  isAiStudioFallbackPermitted,
  logPrivacyAuditNotice
} from './src/server/privacyAndPolicy';
import { defaultMetrics } from './src/server/metrics';
import { scheduleMaintenance } from './src/server/maintenance';
import type { FirebaseClientConfig } from './src/utils/firebaseAuth';
import { createAccountRouter } from './src/server/accountRoutes';
import { createBillingRouter, createRevenueCatWebhookRouter } from './src/server/billingRoutes';
import { createReportRouter } from './src/server/reportRoutes';
import { createSessionRouter } from './src/server/sessionRoutes';
import { createChatRouter } from './src/server/chatRoutes';
import { createSpeechRouter, speechClientStatus } from './src/server/speechRoutes';
import { BRAND } from './src/data/brand';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  next();
});

// Redirect browser page loads from secondary hosts (e.g. *.run.app) to APP_URL in production.
// API, WebSocket and .well-known requests are never redirected.
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production' || req.method !== 'GET') return next();
  const rawAppUrl = process.env.APP_URL?.trim();
  if (!rawAppUrl) return next();

  let canonical: URL;
  try {
    canonical = new URL(rawAppUrl);
  } catch {
    return next();
  }
  if (canonical.protocol !== 'http:' && canonical.protocol !== 'https:') return next();

  if (
    req.path === '/api' ||
    req.path.startsWith('/api/') ||
    req.path === '/.well-known' ||
    req.path.startsWith('/.well-known/')
  ) {
    return next();
  }

  const requestHost = req.get('host')?.trim().toLowerCase();
  if (!requestHost || requestHost === canonical.host.toLowerCase()) return next();

  return res.redirect(308, `${canonical.origin}${req.originalUrl}`);
});
const PORT = process.env.PORT || 3000;

// Behind a load balancer (e.g. Cloud Run) set TRUST_PROXY_HOPS=1 so req.ip is
// the client's address rather than the proxy's, or every user shares one limit.
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS) || 0;
app.set('trust proxy', TRUST_PROXY_HOPS);

// Outer perimeter rate limiting per IP. Webhooks are left out: RevenueCat can send
// bursts of events from a few IPs, and its secret is checked before any work is done.
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE) || 60;
app.use(['/api/chat', '/api/translate', '/api/tts', '/api/stt', '/api/session', '/api/me', '/api/account', '/api/billing', '/api/report'], rateLimit({
  windowMs: 60_000,
  limit: RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down', fallbackToBrowser: true },
}));

// Only STT uploads base64 audio; every other route gets a small body cap.
// Registered first so the global parser below skips already-parsed bodies.
app.use('/api/stt', express.json({ limit: '25mb' }));
app.use(express.json({ limit: '1mb' }));


// Public liveness check; operational details live on /api/metrics (operators only)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Build the public Firebase web config the client needs for anonymous sign-in.
 *
 * Args:
 *   env: Environment to read FIREBASE_API_KEY, FIREBASE_APP_ID, GCP_PROJECT and the
 *     optional FIREBASE_AUTH_DOMAIN from.
 *
 * Returns:
 *   The config, or null when sign-in is not configured (the client then sends no token).
 */
export function buildFirebaseClientConfig(env: NodeJS.ProcessEnv = process.env): FirebaseClientConfig | null {
  const apiKey = env.FIREBASE_API_KEY?.trim();
  const appId = env.FIREBASE_APP_ID?.trim();
  const projectId = env.GCP_PROJECT?.trim();
  if (!apiKey || !appId || !projectId) return null;
  const authDomain = env.FIREBASE_AUTH_DOMAIN?.trim() || `${projectId}.firebaseapp.com`;
  const appCheckSiteKey = env.FIREBASE_APPCHECK_SITE_KEY?.trim() || null;
  return { apiKey, authDomain, projectId, appId, appCheckSiteKey };
}

// Firebase web config is public by design; serving it at runtime keeps it out of the image build
app.get('/api/auth-config', (_req, res) => {
  const rcKey = process.env.REVENUECAT_WEB_PUBLIC_KEY?.trim() || null;
  res.json({
    firebase: buildFirebaseClientConfig(),
    billing: {
      revenueCatWebKey: rcKey
    }
  });
});

// Webhook endpoints (not behind user authentication)
app.use('/api/webhooks', createRevenueCatWebhookRouter());

// App Check, authentication, and per-user rate limit middleware stack for billed routes
app.use(
  ['/api/chat', '/api/translate', '/api/tts', '/api/stt', '/api/session', '/api/me', '/api/account', '/api/billing', '/api/report'],
  requireAppCheck(),
  authenticateHttpUser(),
  createUserRateLimitMiddleware(defaultUserLimiter),
  attachAccount(defaultAccountStore)
);

/**
 * Decide whether a user may read operational metrics.
 *
 * Args:
 *   userId: Authenticated user ID.
 *
 * Returns:
 *   True for IDs in METRICS_ADMIN_USER_IDS (comma separated), or anyone when auth is not enforced.
 */
export function canReadMetrics(userId: string): boolean {
  if (!isAuthEnforced()) return true;
  const admins = (process.env.METRICS_ADMIN_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return admins.includes(userId);
}

// Operational metrics, runtime configuration, and privacy mode: operators only, unlike /api/health
app.get('/api/metrics', authenticateHttpUser(), (req, res) => {
  if (!canReadMetrics(req.user!.userId)) {
    return res.status(403).json({ error: 'Metrics are restricted to operators' });
  }
  res.json({
    billing: Boolean(process.env.REVENUECAT_SECRET_KEY),
    models: {
      chat: CHAT_MODEL,
      tts: TTS_MODEL,
      live: LIVE_MODEL,
    },
    gcp: {
      region: GCP_REGION,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      hasGcpProject: Boolean(GCP_PROJECT),
      clients: {
        vertexAi: Boolean(GCP_PROJECT),
        aiStudio: Boolean(process.env.GEMINI_API_KEY),
        ...speechClientStatus(),
      }
    },
    privacy: getPrivacyPolicyConfig(),
    metrics: defaultMetrics.getSummary()
  });
});

// Learner profile and account metadata
app.get('/api/me', async (req, res) => {
  try {
    const { account, tier, limits } = req.account!;
    const nowMs = Date.now();
    const usage = await defaultUsageStore.getUsage(account.userId, usageDay(nowMs));
    const resetsAt = nextResetAt(nowMs);
    res.json({
      userId: account.userId,
      email: account.email,
      isAnonymous: account.isAnonymous,
      tier,
      limits,
      usage,
      resetsAt,
      consent: account.consent,
      subscription: account.subscription && {
        status: account.subscription.status,
        productId: account.subscription.productId,
        store: account.subscription.store,
        periodType: account.subscription.periodType,
        expiresAt: account.subscription.expiresAt,
        willRenew: account.subscription.willRenew,
        managementUrl: account.subscription.managementUrl ?? null
      }
    });
  } catch (err: unknown) {
    console.error('[Account] Error fetching usage for /api/me:', summarizeError(err));
    res.status(500).json({ error: 'Error fetching account details' });
  }
});

// Account lifecycle routes (guest merge and account deletion)
app.use('/api/account', createAccountRouter());

// Billing routes (subscription sync)
app.use('/api/billing', createBillingRouter());

// Content reporting route
app.use('/api/report', createReportRouter());

// Learner session routes (continuity, checkpoints and GDPR deletion)
app.use('/api/session', createSessionRouter());

// Tutor chat: one turn with grammar notes, checkpointed to the learner session
app.use('/api/chat', createChatRouter());






// Translation, text-to-speech and speech-to-text helpers
app.use('/api', createSpeechRouter());

// 404 handler for unknown API routes (registered before the SPA fallback)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

/** Mount production static asset and SPA routes with immutable caching for /assets and no-cache for index.html. */
export function registerStaticRoutes(targetApp: express.Express, distDir: string): void {
  targetApp.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), { maxAge: '1y', immutable: true })
  );
  targetApp.use(
    express.static(distDir, {
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  targetApp.get(['/privacy', '/terms', '/delete-account'], (req, res) => {
    const page = req.path.replace(/^\/+|\/+$/g, '').toLowerCase();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, `${page}.html`));
  });
  targetApp.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Setup Vite middleware in dev or static serving in production
async function startServer() {
  assertAuthConfig();
  logPrivacyAuditNotice();
  scheduleMaintenance(defaultSessionStore, defaultUserLimiter);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    registerStaticRoutes(app, path.join(__dirname, 'dist'));
  }

  const server = app.listen(PORT, () => {
    console.log(`${BRAND.name} server listening on http://localhost:${PORT}`);
    console.log(`[Config] Chat Model: ${CHAT_MODEL} | TTS Model: ${TTS_MODEL} | Live Model: ${LIVE_MODEL}`);
    console.log(`[Config] GCP Project: ${GCP_PROJECT || '(none - using API key)'} | Region: ${GCP_REGION}`);
  });

  attachLiveBridge(server, {
    ...(hasGenAiCredentials()
      ? buildLiveClientOptions(primaryAi, fallbackAi, isAiStudioFallbackPermitted(true), vertexCooldown, LIVE_MODEL)
      : { clients: [] }),
    model: LIVE_MODEL,
    trustProxyHops: TRUST_PROXY_HOPS,
  });
}

// Tests import `app` and drive it with supertest, so don't bind a port or load Vite there
if (!process.env.VITEST) {
  startServer();
}

export { app };
