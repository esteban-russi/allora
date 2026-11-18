/** Privacy-preserving operational metrics for mobile live voice and lesson telemetry. */

export interface LessonCostEstimate {
  inputTokens: number;
  outputTokens: number;
  audioDurationSec: number;
  estimatedCostUsd: number;
}

export interface ReconnectStats {
  attempts: number;
  resumedSuccessfully: number;
  fallbackToTurnBased: number;
  failed: number;
}

export interface MetricsSummary {
  ttfa: {
    samples: number;
    p50Ms: number;
    p90Ms: number;
    p95Ms: number;
  };
  bargeInStop: {
    samples: number;
    p50Ms: number;
    p90Ms: number;
    p95Ms: number;
  };
  reconnect: {
    attempts: number;
    resumedSuccessfully: number;
    fallbackToTurnBased: number;
    failed: number;
    resumptionRatePct: number;
  };
  lessonsCompleted: number;
  avgCostPerCompletedLessonUsd: number;
}

const AUDIO_COST_PER_MINUTE = 0.003; // ~$0.003 per minute of Gemini Live native audio
const FLASH_INPUT_PER_1K = 0.00015;
const FLASH_OUTPUT_PER_1K = 0.0006;

/** Privacy-preserving operational metrics collector. */
export class MetricsCollector {
  private ttfaSamples: number[] = [];
  private bargeInSamples: number[] = [];
  private reconnectStats: ReconnectStats = {
    attempts: 0,
    resumedSuccessfully: 0,
    fallbackToTurnBased: 0,
    failed: 0
  };
  private completedLessons: LessonCostEstimate[] = [];
  private enableTranscriptLogging: boolean;

  constructor() {
    this.enableTranscriptLogging = process.env.ENABLE_TRANSCRIPT_LOGGING === 'true';
  }

  /**
   * Record Time to First Audio (TTFA) latency.
   *
   * Args:
   *   latencyMs: Elapsed milliseconds from end of user speech to first audio frame.
   */
  recordTtfa(latencyMs: number): void {
    if (Number.isFinite(latencyMs) && latencyMs > 0 && latencyMs < 30_000) {
      this.ttfaSamples.push(Math.round(latencyMs));
      if (this.ttfaSamples.length > 1000) this.ttfaSamples.shift();
    }
  }

  /**
   * Record barge-in interruption playback stop latency.
   *
   * Args:
   *   stopMs: Milliseconds from speech detection to playback cutoff.
   */
  recordBargeInStop(stopMs: number): void {
    if (Number.isFinite(stopMs) && stopMs >= 0 && stopMs < 10_000) {
      this.bargeInSamples.push(Math.round(stopMs));
      if (this.bargeInSamples.length > 1000) this.bargeInSamples.shift();
    }
  }

  /**
   * Record outcome of a client reconnect and upstream resumption attempt.
   *
   * Args:
   *   outcome: 'resumed' | 'turn_based_fallback' | 'failed'.
   */
  recordReconnectOutcome(outcome: 'resumed' | 'turn_based_fallback' | 'failed'): void {
    this.reconnectStats.attempts++;
    if (outcome === 'resumed') this.reconnectStats.resumedSuccessfully++;
    else if (outcome === 'turn_based_fallback') this.reconnectStats.fallbackToTurnBased++;
    else this.reconnectStats.failed++;
  }

  /**
   * Record a completed conversation lesson and estimate its cost.
   *
   * Args:
   *   inputTokens: Estimated text tokens sent.
   *   outputTokens: Estimated text tokens generated.
   *   audioDurationSec: Total audio streamed in seconds.
   */
  recordCompletedLesson(inputTokens: number, outputTokens: number, audioDurationSec: number): void {
    const audioCost = (audioDurationSec / 60) * AUDIO_COST_PER_MINUTE;
    const tokenCost = (inputTokens / 1000) * FLASH_INPUT_PER_1K + (outputTokens / 1000) * FLASH_OUTPUT_PER_1K;
    const estimatedCostUsd = Math.round((audioCost + tokenCost) * 10000) / 10000;

    this.completedLessons.push({
      inputTokens,
      outputTokens,
      audioDurationSec,
      estimatedCostUsd
    });
    if (this.completedLessons.length > 500) this.completedLessons.shift();
  }

  /**
   * Log an operational event without raw audio or verbatim learner transcripts.
   *
   * Args:
   *   event: Metric event name.
   *   metadata: Privacy-safe metadata fields.
   */
  logSafeEvent(event: string, metadata: Record<string, unknown>): void {
    // Strip sensitive fields if accidentally included
    const sanitized: Record<string, unknown> = { ...metadata };
    if (!this.enableTranscriptLogging) {
      delete sanitized.transcript;
      delete sanitized.userMessage;
      delete sanitized.audioBase64;
      delete sanitized.audioContent;
      delete sanitized.rawText;
    }

    console.log(JSON.stringify({ event, ...sanitized, ts: new Date().toISOString() }));
  }

  private calculatePercentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Generate an aggregated summary of operational metrics.
   *
   * Returns:
   *   Summary object containing p50/p90/p95 TTFA, barge-in stop latency, reconnect stats, and cost.
   */
  getSummary(): MetricsSummary {
    const totalCost = this.completedLessons.reduce((acc, l) => acc + l.estimatedCostUsd, 0);
    const avgCost = this.completedLessons.length > 0 ? totalCost / this.completedLessons.length : 0;
    const resumptionRatePct =
      this.reconnectStats.attempts > 0
        ? Math.round((this.reconnectStats.resumedSuccessfully / this.reconnectStats.attempts) * 100)
        : 100;

    return {
      ttfa: {
        samples: this.ttfaSamples.length,
        p50Ms: this.calculatePercentile(this.ttfaSamples, 50),
        p90Ms: this.calculatePercentile(this.ttfaSamples, 90),
        p95Ms: this.calculatePercentile(this.ttfaSamples, 95)
      },
      bargeInStop: {
        samples: this.bargeInSamples.length,
        p50Ms: this.calculatePercentile(this.bargeInSamples, 50),
        p90Ms: this.calculatePercentile(this.bargeInSamples, 90),
        p95Ms: this.calculatePercentile(this.bargeInSamples, 95)
      },
      reconnect: {
        ...this.reconnectStats,
        resumptionRatePct
      },
      lessonsCompleted: this.completedLessons.length,
      avgCostPerCompletedLessonUsd: Math.round(avgCost * 10000) / 10000
    };
  }
}

export const defaultMetrics = new MetricsCollector();
