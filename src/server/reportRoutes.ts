/** HTTP route for submitting learner reports on AI tutor replies. */
import { randomUUID } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { summarizeError } from './vertexCooldown';
import { defaultReportStore } from './defaultReportStore';
import {
  REPORT_REASONS,
  REPORT_SOURCES,
  type Report,
  type ReportReason,
  type ReportSource,
  type ReportStore
} from './reportStore';

const MAX_TEXT_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 500;
const MAX_SESSION_ID_LENGTH = 100;

export interface ReportRouterDeps {
  reports?: ReportStore;
  now?: () => number;
}

/**
 * Create Express router for POST /api/report.
 *
 * Args:
 *   deps: Storage and clock dependencies (injectable for testing).
 *
 * Returns:
 *   Configured Express Router.
 */
export function createReportRouter(deps: ReportRouterDeps = {}): Router {
  const router = Router();
  const reports = deps.reports ?? defaultReportStore;
  const now = deps.now ?? Date.now;

  router.post('/', async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

    const rawText = body.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0 || rawText.length > MAX_TEXT_LENGTH) {
      res.status(400).json({ error: `text must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters` });
      return;
    }

    const rawReason = body.reason;
    if (typeof rawReason !== 'string' || !REPORT_REASONS.includes(rawReason as ReportReason)) {
      res.status(400).json({ error: `reason must be one of ${REPORT_REASONS.join(', ')}` });
      return;
    }

    const rawSource = body.source;
    if (typeof rawSource !== 'string' || !REPORT_SOURCES.includes(rawSource as ReportSource)) {
      res.status(400).json({ error: `source must be one of ${REPORT_SOURCES.join(', ')}` });
      return;
    }

    const rawComment = body.comment;
    if (rawComment !== undefined && rawComment !== null && typeof rawComment !== 'string') {
      res.status(400).json({ error: 'comment must be a string' });
      return;
    }
    if (typeof rawComment === 'string' && rawComment.length > MAX_COMMENT_LENGTH) {
      res.status(400).json({ error: `comment must be at most ${MAX_COMMENT_LENGTH} characters` });
      return;
    }

    const rawSessionId = body.sessionId;
    if (rawSessionId !== undefined && rawSessionId !== null && typeof rawSessionId !== 'string') {
      res.status(400).json({ error: 'sessionId must be a string' });
      return;
    }
    if (typeof rawSessionId === 'string' && rawSessionId.length > MAX_SESSION_ID_LENGTH) {
      res.status(400).json({ error: `sessionId must be at most ${MAX_SESSION_ID_LENGTH} characters` });
      return;
    }

    const report: Report = {
      id: `rep_${randomUUID()}`,
      userId: user.userId,
      sessionId: typeof rawSessionId === 'string' && rawSessionId.trim() ? rawSessionId.trim() : null,
      source: rawSource as ReportSource,
      text: rawText.trim(),
      reason: rawReason as ReportReason,
      comment: typeof rawComment === 'string' ? rawComment.trim() : '',
      createdAt: new Date(now()).toISOString()
    };

    try {
      await reports.addReport(report);
      console.warn('[Report] New content report', { reason: report.reason, source: report.source });
      res.json({ status: 'received' });
    } catch (err) {
      console.error('[Report] Failed to save content report:', summarizeError(err));
      res.status(500).json({ error: 'Could not save report' });
    }
  });

  return router;
}
