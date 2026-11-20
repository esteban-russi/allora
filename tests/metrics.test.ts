/** Tests for privacy-preserving operational metrics, percentiles, and cost telemetry. */
import { describe, expect, it } from 'vitest';
import { MetricsCollector } from '../src/platform/server/metrics';

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
    metrics.recordReconnectOutcome('restarted');

    const summary = metrics.getSummary();
    expect(summary.reconnect.attempts).toBe(4);
    expect(summary.reconnect.resumedSuccessfully).toBe(2);
    expect(summary.reconnect.fallbackToTurnBased).toBe(1);
    expect(summary.reconnect.restartedFresh).toBe(1);
    expect(summary.reconnect.resumptionRatePct).toBe(50);
  });

  it('reports no resumption rate before any reconnect', () => {
    expect(new MetricsCollector().getSummary().reconnect.resumptionRatePct).toBeNull();
  });

  it('counts a Live call as a lesson only when an exchange was completed', () => {
    const metrics = new MetricsCollector();
    metrics.recordLiveCallEnded(0, 30); // hung up before the tutor answered
    metrics.recordLiveCallEnded(3, 120);
    metrics.recordLiveCallEnded(5, 240);

    const { liveLessons } = metrics.getSummary();
    expect(liveLessons.completed).toBe(2);
    expect(liveLessons.avgAudioSec).toBe(180);
    expect(liveLessons.avgEstimatedCostUsd).toBeGreaterThan(0);
  });

  it('prices chat turns separately from Live lessons', () => {
    const metrics = new MetricsCollector();
    metrics.recordChatTurn(1000, 1000);

    const summary = metrics.getSummary();
    expect(summary.chatTurns.count).toBe(1);
    expect(summary.chatTurns.avgEstimatedCostUsd).toBeCloseTo(0.00075, 6);
    expect(summary.liveLessons.completed).toBe(0);
  });

  it('tracks App Check verification outcomes', () => {
    const metrics = new MetricsCollector();
    metrics.recordAppCheck('ok');
    metrics.recordAppCheck('ok');
    metrics.recordAppCheck('failed');
    metrics.recordAppCheck('missing');

    expect(metrics.getSummary().appCheck).toEqual({ ok: 2, failed: 1, missing: 1 });
  });
});
