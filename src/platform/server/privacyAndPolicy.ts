/** Data privacy policies, Vertex AI enterprise governance, and AI Studio data terms. */

export type DataPrivacyMode = 'vertex_only' | 'allow_ai_studio_fallback';

export interface PrivacyPolicyConfig {
  mode: DataPrivacyMode;
  allowAiStudioFallback: boolean;
  hasGcpProject: boolean;
  hasGeminiKey: boolean;
}

/**
 * Assess data governance compliance for learner data.
 *
 * Vertex AI guarantees that customer prompts and learner voice audio are NOT
 * used to train Google models, upholding GDPR, COPPA, and enterprise privacy.
 * Google AI Studio terms may permit Google to log and review prompts for product
 * improvement. For language learners, Vertex AI is the required default.
 *
 * Returns:
 *   Current privacy configuration and whether AI Studio failover is permitted.
 */
export function getPrivacyPolicyConfig(): PrivacyPolicyConfig {
  const hasGcpProject = Boolean(process.env.GCP_PROJECT);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY);
  const allowAiStudioFallback = process.env.ALLOW_AI_STUDIO_FALLBACK === 'true';
  const mode: DataPrivacyMode = allowAiStudioFallback ? 'allow_ai_studio_fallback' : 'vertex_only';

  return {
    mode,
    allowAiStudioFallback,
    hasGcpProject,
    hasGeminiKey
  };
}

/**
 * Log startup audit notices if AI Studio fallback is active.
 */
export function logPrivacyAuditNotice(): void {
  const config = getPrivacyPolicyConfig();

  if (config.hasGcpProject && config.allowAiStudioFallback) {
    console.warn(
      '[DATA PRIVACY AUDIT WARNING] ALLOW_AI_STUDIO_FALLBACK is enabled. ' +
        'If Vertex AI requests fail, learner conversational data will fail over to Google AI Studio. ' +
        'Review AI Studio data terms before processing sensitive learner data in production.'
    );
  } else if (config.hasGcpProject) {
    console.log(
      '[Data Privacy] Production default active: Vertex AI enterprise governance (vertex_only). ' +
        'AI Studio failover disabled to protect learner data.'
    );
  }
}

/**
 * Check whether a fallback request to AI Studio is compliant with current policy.
 *
 * Args:
 *   isLearnerData: Whether the payload contains learner voice/text.
 *
 * Returns:
 *   True if fallback is permitted by current data governance policy.
 */
export function isAiStudioFallbackPermitted(isLearnerData: boolean = true): boolean {
  const config = getPrivacyPolicyConfig();
  if (!config.hasGeminiKey) return false;
  if (!isLearnerData) return true;
  return config.allowAiStudioFallback;
}
