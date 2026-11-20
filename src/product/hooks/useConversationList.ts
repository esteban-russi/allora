/** React hook managing learner conversation list state, optimistic updates, and visibility-driven refetching. */
import { useCallback, useEffect, useState } from 'react';
import type { ClientLearnerSession, SessionSummary } from '../server/sessionStore';
import {
  fetchSessionList,
  deleteSessionById,
  toSessionSummary
} from '../client/learnerSession';

export interface UseConversationListOptions {
  isVisible?: boolean;
  initialSessions?: SessionSummary[];
  fetchList?: () => Promise<SessionSummary[]>;
  deleteSession?: (sessionId: string) => Promise<boolean>;
}

export interface UseConversationListResult {
  sessions: SessionSummary[];
  setSessions: React.Dispatch<React.SetStateAction<SessionSummary[]>>;
  refetch: () => Promise<SessionSummary[]>;
  addOptimisticSession: (summary: SessionSummary) => void;
  removeOptimisticSession: (sessionId: string) => void;
  reconcileCreatedSession: (tempSessionId: string, createdSession: ClientLearnerSession) => void;
  handleDelete: (sessionId: string) => Promise<boolean>;
}

/**
 * Coordinate conversation list data, optimistic add/remove, and automatic refetch on visibility.
 *
 * Args:
 *   options: Visibility flag, initial items, and injectable API methods for testing.
 *
 * Returns:
 *   Sessions list, optimistic mutation helpers, delete handler, and manual refetch.
 */
export function useConversationList(options: UseConversationListOptions = {}): UseConversationListResult {
  const {
    isVisible = false,
    initialSessions = [],
    fetchList = fetchSessionList,
    deleteSession = deleteSessionById
  } = options;

  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);

  const refetch = useCallback(async (): Promise<SessionSummary[]> => {
    try {
      const list = await fetchList();
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, [fetchList]);

  // Refetch whenever the conversation list screen becomes visible
  useEffect(() => {
    if (isVisible) {
      void refetch();
    }
  }, [isVisible, refetch]);

  const addOptimisticSession = useCallback((summary: SessionSummary) => {
    setSessions((prev) => [summary, ...prev.filter((s) => s.sessionId !== summary.sessionId)]);
  }, []);

  const removeOptimisticSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }, []);

  const reconcileCreatedSession = useCallback(
    (tempSessionId: string, createdSession: ClientLearnerSession) => {
      const summary = toSessionSummary(createdSession);
      setSessions((prev) => [
        summary,
        ...prev.filter((s) => s.sessionId !== tempSessionId && s.sessionId !== createdSession.sessionId)
      ]);
    },
    []
  );

  const handleDelete = useCallback(
    async (sessionId: string): Promise<boolean> => {
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      try {
        const ok = await deleteSession(sessionId);
        const updated = await fetchList();
        setSessions(updated);
        return ok;
      } catch (err) {
        const updated = await fetchList();
        setSessions(updated);
        throw err;
      }
    },
    [deleteSession, fetchList]
  );

  return {
    sessions,
    setSessions,
    refetch,
    addOptimisticSession,
    removeOptimisticSession,
    reconcileCreatedSession,
    handleDelete
  };
}
