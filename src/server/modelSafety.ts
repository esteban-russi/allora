/** Model safety settings, block-reason detection, and fixed Italian decline text. */
import {
  BlockedReason,
  FinishReason,
  HarmBlockThreshold,
  HarmCategory,
  type SafetySetting
} from '@google/genai';

/** Fixed polite Italian decline returned when Gemini blocks a chat reply. */
export const BLOCKED_REPLY_TEXT =
  "Scusa, di questo non posso parlare. Torniamo all'italiano?";

/** Explicit safety thresholds sent on every chat and Live model request. */
export const MODEL_SAFETY_SETTINGS: SafetySetting[] = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
  }
];

const BLOCKED_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY
]);

export interface GeminiResponseLike {
  text?: string;
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string }>;
}

/**
 * Determine whether a Gemini response was blocked or produced no text.
 *
 * Args:
 *   response: Response object returned by `ai.models.generateContent`.
 *
 * Returns:
 *   True when the prompt was blocked, the first candidate stopped with a safety
 *   or block finish reason, or the response carries no non-empty text.
 */
export function isBlockedGeminiResponse(response: GeminiResponseLike): boolean {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason && blockReason !== BlockedReason.BLOCKED_REASON_UNSPECIFIED) {
    return true;
  }

  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && BLOCKED_FINISH_REASONS.has(finishReason)) {
    return true;
  }

  let text: string | undefined;
  try {
    text = response.text;
  } catch {
    return true;
  }
  return typeof text !== 'string' || text.trim().length === 0;
}
