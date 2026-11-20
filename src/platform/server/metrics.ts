/** Privacy-preserving operational metrics for Live voice calls and chat lessons. */

export interface ReconnectStats {
  attempts: number;
  resumedSuccessfully: number;
  restartedFresh: number;
  fallbackToTurnBased: number;
}

export type ReconnectOutcome = 'resumed' | 'restarted' | 'turn_based_fallback';

export interface AppCheckStats {
  ok: number;
  failed: number;
  missing: number;
}

export type AppCheckOutcome = 'ok' | 'failed' | 'missing';

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
  reconnect: ReconnectStats & {
    /** Share of reconnects that resumed the upstream session; null before any reconnect. */
    resumptionRatePct: number | null;
  };
  /** Live calls that finished with at least one completed exchange. */
  liveLessons: {
    completed: number;
    avgAudioSec: number;
    avgEstimatedCostUsd: number;
  };
  /** Turn-based /api/chat requests, priced from Gemini's reported token usage. */
  chatTurns: {
    count: number;
    avgEstimatedCostUsd: number;
  };
  /** Firebase App Check verification outcomes. */
  appCheck: AppCheckStats;
}

// Rough list-price estimates for a cost trend line, not billing figures; update them
// when pricing changes. Live audio is priced per minute streamed in either direction.
const LIVE_AUDIO_USD_PER_MINUTE_ESTIMATE = 0.003;
const CHAT_INPUT_USD_PER_1K_TOKENS_ESTIMATE = 0.00015;
const CHAT_OUTPUT_USD_PER_1K_TOKENS_ESTIMATE = 0.0006;
const MAX_SAMPLES = 1000;

/** Keep only the most recent MAX_SAMPLES values. */
function pushBounded(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

const average = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

// Per-turn costs are fractions of a cent, so keep micro-dollar precision
const roundUsd = (usd: number): number => Math.round(usd * 1_000_000) / 1_000_000;

/** Privacy-preserving operational metrics collector. */
export class MetricsCollector {
  private ttfaSamples: number[] = [];
  private bargeInSamples: number[] = [];
  private reconnectStats: ReconnectStats = {
    attempts: 0,
    resumedSuccessfully: 0,
    restartedFresh: 0,
    fallbackToTurnBased: 0
  };
  private liveLessonAudioSec: number[] = [];
  private chatTurnCostsUsd: number[] = [];
  private appCheckStats: AppCheckStats = {
    ok: 0,
    failed: 0,
    missing: 0
  };

  /**
   * Record Time to First Audio (TTFA) latency.
   *
   * Args:
   *   latencyMs: Elapsed milliseconds from end of user speech to first audio frame.
   */
  recordTtfa(latencyMs: number): void {
    if (Number.isFinite(latencyMs) && latencyMs > 0 && latencyMs < 30_000) {
      pushBounded(this.ttfaSamples, Math.round(latencyMs));
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
      pushBounded(this.bargeInSamples, Math.round(stopMs));
    }
  }

  /**
   * Record how a reconnect that carried a resumption handle ended.
   *
   * Args:
   *   outcome: Resumed the upstream session, restarted it fresh, or fell back to turn-based.
   */
  recordReconnectOutcome(outcome: ReconnectOutcome): void {
    this.reconnectStats.attempts++;
    if (outcome === 'resumed') this.reconnectStats.resumedSuccessfully++;
    else if (outcome === 'restarted') this.reconnectStats.restartedFresh++;
    else this.reconnectStats.fallbackToTurnBased++;
  }

  /**
   * Record a finished Live call as a lesson if the learner and tutor completed an exchange.
   *
   * Args:
   *   completedExchanges: Number of `turn_complete` events in the call.
   *   audioSec: Audio streamed in both directions, in seconds.
   */
  recordLiveCallEnded(completedExchanges: number, audioSec: number): void {
    if (completedExchanges < 1 || !Number.isFinite(audioSec) || audioSec < 0) return;
    pushBounded(this.liveLessonAudioSec, audioSec);
  }

  /**
   * Record one turn-based chat reply priced from Gemini's token usage.
   *
   * Args:
   *   inputTokens: Prompt tokens reported by Gemini.
   *   outputTokens: Response tokens reported by Gemini.
   */
  recordChatTurn(inputTokens: number, outputTokens: number): void {
    const cost =
      (inputTokens / 1000) * CHAT_INPUT_USD_PER_1K_TOKENS_ESTIMATE +
      (outputTokens / 1000) * CHAT_OUTPUT_USD_PER_1K_TOKENS_ESTIMATE;
    if (Number.isFinite(cost) && cost >= 0) pushBounded(this.chatTurnCostsUsd, cost);
  }

  /**
   * Record the outcome of an App Check verification attempt.
   *
   * Args:
   *   outcome: Whether the token verified ('ok'), failed ('failed'), or was absent ('missing').
   */
  recordAppCheck(outcome: AppCheckOutcome): void {
    this.appCheckStats[outcome]++;
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
    const resumptionRatePct =
      this.reconnectStats.attempts > 0
        ? Math.round((this.reconnectStats.resumedSuccessfully / this.reconnectStats.attempts) * 100)
        : null;
    const avgAudioSec = average(this.liveLessonAudioSec);

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
      liveLessons: {
        completed: this.liveLessonAudioSec.length,
        avgAudioSec: Math.round(avgAudioSec),
        avgEstimatedCostUsd: roundUsd((avgAudioSec / 60) * LIVE_AUDIO_USD_PER_MINUTE_ESTIMATE)
      },
      chatTurns: {
        count: this.chatTurnCostsUsd.length,
        avgEstimatedCostUsd: roundUsd(average(this.chatTurnCostsUsd))
      },
      appCheck: { ...this.appCheckStats }
    };
  }
}

export const defaultMetrics = new MetricsCollector();
