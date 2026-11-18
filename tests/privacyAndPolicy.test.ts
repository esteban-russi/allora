/** Tests for data governance, Vertex default policy, and AI Studio data terms audit. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getPrivacyPolicyConfig,
  isAiStudioFallbackPermitted
} from '../src/server/privacyAndPolicy';

describe('Data Privacy and AI Studio Terms Policy', () => {
  const originalGcpProject = process.env.GCP_PROJECT;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalAllowFallback = process.env.ALLOW_AI_STUDIO_FALLBACK;

  beforeEach(() => {
    process.env.GCP_PROJECT = 'test-gcp-project';
    process.env.GEMINI_API_KEY = 'test-ai-studio-key';
    delete process.env.ALLOW_AI_STUDIO_FALLBACK;
  });

  afterEach(() => {
    if (originalGcpProject) process.env.GCP_PROJECT = originalGcpProject;
    else delete process.env.GCP_PROJECT;

    if (originalGeminiKey) process.env.GEMINI_API_KEY = originalGeminiKey;
    else delete process.env.GEMINI_API_KEY;

    if (originalAllowFallback) process.env.ALLOW_AI_STUDIO_FALLBACK = originalAllowFallback;
    else delete process.env.ALLOW_AI_STUDIO_FALLBACK;
  });

  it('defaults to vertex_only mode and disallows AI Studio fallback for learner data', () => {
    const config = getPrivacyPolicyConfig();
    expect(config.mode).toBe('vertex_only');
    expect(config.allowAiStudioFallback).toBe(false);

    expect(isAiStudioFallbackPermitted(true)).toBe(false);
  });

  it('permits AI Studio fallback only when ALLOW_AI_STUDIO_FALLBACK is explicitly enabled', () => {
    process.env.ALLOW_AI_STUDIO_FALLBACK = 'true';

    const config = getPrivacyPolicyConfig();
    expect(config.mode).toBe('allow_ai_studio_fallback');
    expect(config.allowAiStudioFallback).toBe(true);

    expect(isAiStudioFallbackPermitted(true)).toBe(true);
  });

  it('disallows fallback when no AI Studio API key is present', () => {
    process.env.ALLOW_AI_STUDIO_FALLBACK = 'true';
    delete process.env.GEMINI_API_KEY;

    expect(isAiStudioFallbackPermitted(true)).toBe(false);
  });
});
