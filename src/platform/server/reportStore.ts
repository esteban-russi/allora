/** Content report records and storage implementations (in-memory and Cloud Firestore). */
import {
  Firestore,
  type CollectionReference,
  type DocumentData
} from '@google-cloud/firestore';

export type ReportSource = 'chat' | 'call';
export type ReportReason = 'harmful' | 'inaccurate' | 'other';

export const REPORT_SOURCES: readonly ReportSource[] = ['chat', 'call'];
export const REPORT_REASONS: readonly ReportReason[] = ['harmful', 'inaccurate', 'other'];
export const REPORTS_COLLECTION = 'reports';

const BATCH_SIZE = 500;

export interface Report {
  id: string;
  userId: string;
  sessionId: string | null;
  source: ReportSource;
  text: string;
  reason: ReportReason;
  comment: string;
  createdAt: string;
}

export interface ReportStore {
  /** Persist a newly submitted content report. */
  addReport(report: Report): Promise<void>;
  /** Reassign all reports from one user to another and return how many were moved. */
  transferUserReports(fromUserId: string, toUserId: string): Promise<number>;
  /** Delete every content report submitted by a user and return how many were removed. */
  deleteAllUserReports(userId: string): Promise<number>;
}

/**
 * In-memory ReportStore for local development and tests.
 *
 * Reports are cloned on the way in and out so callers cannot mutate stored state.
 */
export class InMemoryReportStore implements ReportStore {
  private reports = new Map<string, Report>();

  /**
   * Store a content report by its ID.
   *
   * Args:
   *   report: Complete report record.
   */
  async addReport(report: Report): Promise<void> {
    this.reports.set(report.id, structuredClone(report));
  }

  /**
   * Reassign all reports from one user to another.
   *
   * Args:
   *   fromUserId: Source user identifier (guest).
   *   toUserId: Destination user identifier (registered account).
   *
   * Returns:
   *   Number of moved reports.
   */
  async transferUserReports(fromUserId: string, toUserId: string): Promise<number> {
    if (fromUserId === toUserId) return 0;
    let moved = 0;
    for (const report of this.reports.values()) {
      if (report.userId === fromUserId) {
        report.userId = toUserId;
        moved++;
      }
    }
    return moved;
  }

  /**
   * Delete all reports belonging to a user.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   Number of deleted reports.
   */
  async deleteAllUserReports(userId: string): Promise<number> {
    let deleted = 0;
    for (const [id, report] of this.reports.entries()) {
      if (report.userId === userId) {
        this.reports.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Return defensive copies of all reports stored for a user (used in tests).
   *
   * Args:
   *   userId: Target user identifier.
   *
   * Returns:
   *   Matching reports.
   */
  getUserReports(userId: string): Report[] {
    const out: Report[] = [];
    for (const report of this.reports.values()) {
      if (report.userId === userId) out.push(structuredClone(report));
    }
    return out;
  }
}

export interface FirestoreReportStoreOptions {
  /** Collection name; defaults to `reports`. */
  collectionName?: string;
}

/**
 * ReportStore backed by Cloud Firestore (`reports` collection, no TTL).
 */
export class FirestoreReportStore implements ReportStore {
  private collection: CollectionReference;

  constructor(
    private db: Firestore,
    options: FirestoreReportStoreOptions = {}
  ) {
    this.collection = db.collection(options.collectionName ?? REPORTS_COLLECTION);
  }

  /**
   * Persist a content report document keyed by its ID.
   *
   * Args:
   *   report: Complete report record.
   */
  async addReport(report: Report): Promise<void> {
    const docData: DocumentData = {
      id: report.id,
      userId: report.userId,
      sessionId: report.sessionId,
      source: report.source,
      text: report.text,
      reason: report.reason,
      comment: report.comment,
      createdAt: report.createdAt
    };
    await this.collection.doc(report.id).set(docData);
  }

  /**
   * Reassign all report documents from one user to another in batches of 500.
   *
   * Args:
   *   fromUserId: Source user identifier (guest).
   *   toUserId: Destination user identifier (registered account).
   *
   * Returns:
   *   Number of moved report documents.
   */
  async transferUserReports(fromUserId: string, toUserId: string): Promise<number> {
    if (fromUserId === toUserId) return 0;
    let moved = 0;
    for (;;) {
      const snapshot = await this.collection
        .where('userId', '==', fromUserId)
        .limit(BATCH_SIZE)
        .get();
      if (snapshot.empty) return moved;
      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => batch.update(doc.ref, { userId: toUserId }));
      await batch.commit();
      moved += snapshot.size;
    }
  }

  /**
   * Delete all report documents belonging to a user in batches of 500.
   *
   * Args:
   *   userId: Authenticated user identifier.
   *
   * Returns:
   *   Number of deleted report documents.
   */
  async deleteAllUserReports(userId: string): Promise<number> {
    let deleted = 0;
    for (;;) {
      const snapshot = await this.collection
        .where('userId', '==', userId)
        .limit(BATCH_SIZE)
        .get();
      if (snapshot.empty) return deleted;
      const batch = this.db.batch();
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
  }
}
