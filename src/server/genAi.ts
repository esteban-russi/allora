/** Gemini clients, model configuration and the Vertex-first, AI Studio-fallback call wrapper. */
import { GoogleGenAI } from '@google/genai';
import type { LiveBridgeOptions } from './liveBridge';
import { isAiStudioFallbackPermitted } from './privacyAndPolicy';
import { VertexCooldown, isPersistentVertexError, summarizeError } from './vertexCooldown';

export const GCP_PROJECT = process.env.GCP_PROJECT;
export const GCP_REGION = process.env.GCP_REGION || 'europe-west2';

// Local ADC credentials carry their own quota project (often another gcloud
// project), and Google bills calls there even when a projectId is passed.
// Pin it to GCP_PROJECT unless the environment already chooses one.
if (GCP_PROJECT && !process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = GCP_PROJECT;
}

export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
export const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
/** Native-audio model for real-time voice calls over the Live API. */
export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

/** Whether Gemini is reachable through Vertex AI (GCP_PROJECT + ADC) or an AI Studio key. */
export function hasGenAiCredentials(): boolean {
  return Boolean(process.env.GCP_PROJECT || process.env.GEMINI_API_KEY);
}

function createGenAiClient(preferVertex: boolean): GoogleGenAI {
  const options: Record<string, any> = {
    httpOptions: {
      headers: {
        'User-Agent': 'allora-gcp',
      },
    },
  };

  if (preferVertex && GCP_PROJECT) {
    options.vertexai = true;
    options.project = GCP_PROJECT;
    if (GCP_REGION && GCP_REGION !== 'global') {
      options.location = GCP_REGION;
    }
  } else if (process.env.GEMINI_API_KEY) {
    options.apiKey = process.env.GEMINI_API_KEY;
  }

  return new GoogleGenAI(options);
}

/** Vertex AI when GCP_PROJECT is configured, otherwise the AI Studio API key. */
export const primaryAi = createGenAiClient(Boolean(GCP_PROJECT));
/** AI Studio client, only when Vertex AI is primary and a GEMINI_API_KEY is also set. */
export const fallbackAi = GCP_PROJECT && process.env.GEMINI_API_KEY ? createGenAiClient(false) : null;

/**
 * Vertex AI models that just failed with a configuration error (IAM, region,
 * model name) are skipped for a while instead of costing a round trip per request.
 */
export const vertexCooldown = new VertexCooldown();

/**
 * Call `generateContent` on Vertex AI, falling back to AI Studio when privacy policy allows.
 *
 * Args:
 *   requestConfig: The `generateContent` request (model, contents, config).
 *   isLearnerData: Whether the request carries learner data, which may be kept on Vertex only.
 *
 * Returns:
 *   The Gemini response.
 *
 * Raises:
 *   Error: The Vertex AI error when no fallback is allowed, or the fallback's own error.
 */
export async function generateContentWithFallback(requestConfig: any, isLearnerData = true) {
  const model = String(requestConfig.model);
  const allowAiStudio = isAiStudioFallbackPermitted(isLearnerData);

  if (allowAiStudio && fallbackAi && vertexCooldown.isCoolingDown(model)) {
    return await fallbackAi.models.generateContent(requestConfig);
  }

  try {
    return await primaryAi.models.generateContent(requestConfig);
  } catch (primaryErr: any) {
    if (!fallbackAi || !allowAiStudio) {
      if (!allowAiStudio && fallbackAi) {
        console.warn(
          `[Data Privacy] Vertex AI request failed for ${model}. AI Studio failover skipped to enforce learner privacy (vertex_only): ${summarizeError(primaryErr)}`
        );
      }
      throw primaryErr;
    }

    if (isPersistentVertexError(primaryErr)) {
      vertexCooldown.trip(model);
      console.warn(
        `[GCP Fallback] Vertex AI ${primaryErr.status} for ${model}; using AI Studio for the next ` +
          `${vertexCooldown.cooldownMinutes} min: ${summarizeError(primaryErr)}`
      );
    } else {
      console.warn(`[GCP Fallback] Vertex AI request failed, retrying with AI Studio: ${summarizeError(primaryErr)}`);
    }
    return await fallbackAi.models.generateContent(requestConfig);
  }
}

/**
 * Safely parse a JSON string from an LLM response, stripping optional markdown
 * code fences (```json ... ```) and returning a fallback value if parsing fails.
 */
export function parseModelJsonResponse<T>(rawText: string | undefined | null, fallback: T): T {
  if (!rawText) return fallback;
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

/**
 * Choose the Gemini clients a Live call may use and when Vertex AI is skipped.
 *
 * AI Studio joins the rotation only when privacy policy allows learner data there.
 * The Vertex cooldown is used only when there is another client to skip to;
 * otherwise one Vertex failure would leave no client at all for the whole cooldown.
 *
 * Args:
 *   primaryAi: Vertex AI (or API-key) client.
 *   fallbackAi: AI Studio client, or null when not configured.
 *   fallbackPermitted: Whether policy allows learner audio on AI Studio.
 *   cooldown: Shared Vertex cooldown tracker.
 *   model: Live model name the cooldown is keyed by.
 *
 * Returns:
 *   The `clients`, `skipClient` and `onClientFailed` bridge options.
 */
export function buildLiveClientOptions(
  primaryAi: GoogleGenAI,
  fallbackAi: GoogleGenAI | null,
  fallbackPermitted: boolean,
  cooldown: VertexCooldown,
  model: string
): Pick<LiveBridgeOptions, 'clients' | 'skipClient' | 'onClientFailed'> {
  const liveFallbackAi = fallbackPermitted ? fallbackAi : null;
  const canSkipVertex = (ai: GoogleGenAI) => ai === primaryAi && liveFallbackAi !== null;
  return {
    clients: liveFallbackAi ? [primaryAi, liveFallbackAi] : [primaryAi],
    skipClient: (ai) => canSkipVertex(ai) && cooldown.isCoolingDown(model),
    onClientFailed: (ai) => {
      if (canSkipVertex(ai)) cooldown.trip(model);
    }
  };
}
