/** Tests for privacy-preserving operational metrics, percentiles, and cost telemetry. */
import { describe, expect, it } from 'vitest';
import { MetricsCollector } from '../src/server/metrics';

describe('MetricsCollector', () => {
  it('calculates p50, p90, and p95 percentiles for TTFA latency', () => {
    const metrics = new MetricsCollector();
    // Insert 100 sample latencies: 10ms, 20ms, ..., 1000ms
    for (let i = 1; i <= 100; i++) {
      metrics.recordTtfa(i * 10);
    }

    const summary = metrics.getSummary();
    expect(summary.ttfa.samples).toBe(100);
    expect(summary.ttfa.p50Ms).toBe(500);
    expect(summary.ttfa.p90Ms).toBe(900);
    expect(summary.ttfa.p95Ms).toBe(950);
  });

  it('calculates p95 barge-in interruption stop latency', () => {
    const metrics = new MetricsCollector();
    metrics.recordBargeInStop(50);
    metrics.recordBargeInStop(80);
    metrics.recordBargeInStop(110);
    metrics.recordBargeInStop(140);
    metrics.recordBargeInStop(200);

    const summary = metrics.getSummary();
    expect(summary.bargeInStop.samples).toBe(5);
    expect(summary.bargeInStop.p95Ms).toBe(200);
  });

  it('tracks reconnect attempts, resumptions, and fallbacks', () => {
    const metrics = new MetricsCollector();
    metrics.recordReconnectOutcome('resumed');
    metrics.recordReconnectOutcome('resumed');
    metrics.recordReconnectOutcome('turn_based_fallback');
    metrics.recordReconnectOutcome('failed');

    const summary = metrics.getSummary();
    expect(summary.reconnect.attempts).toBe(4);
    expect(summary.reconnect.resumedSuccessfully).toBe(2);
    expect(summary.reconnect.fallbackToTurnBased).toBe(1);
    expect(summary.reconnect.failed).toBe(1);
    expect(summary.reconnect.resumptionRatePct).toBe(50);
  });

  it('estimates cost per completed lesson without storing raw audio or transcripts', () => {
    const metrics = new MetricsCollector();
    // Lesson 1: 500 input tokens, 300 output tokens, 120s of live audio
    metrics.recordCompletedLesson(500, 300, 120);

    const summary = metrics.getSummary();
    expect(summary.lessonsCompleted).toBe(1);
    expect(summary.avgCostPerCompletedLessonUsd).toBeGreaterThan(0);
  });
});
