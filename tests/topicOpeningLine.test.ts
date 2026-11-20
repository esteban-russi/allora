/** Tests for topic opening line single rendering across create and restore flows. */
import { describe, expect, it } from 'vitest';
import { initializeLearnerSession } from '../src/product/server/sessionStore';
import { toChatMessages } from '../src/product/client/learnerSession';
import { createInitialMessages, EMMANUELE } from '../src/product/data/personas';
import { getTopicById } from '../src/product/data/topics';
import type { ClientLearnerSession } from '../src/product/server/sessionStore';

describe('Topic conversation opening line deduplication', () => {
  it('includes the opening line in checkpointTurns on session creation', () => {
    const session = initializeLearnerSession({
      userId: 'test-user',
      personaId: 'emmanuele',
      topic: 'market',
      learnerName: 'Luca',
      learnerLevel: 'A2'
    });

    const marketTopic = getTopicById('market');
    expect(marketTopic).toBeDefined();
    expect(marketTopic?.firstLine).toBeDefined();

    expect(session.checkpointTurns).toHaveLength(1);
    expect(session.checkpointTurns[0].text).toBe(marketTopic!.firstLine!.text);
    expect(session.checkpointTurns[0].translation).toBe(marketTopic!.firstLine!.translation);
  });

  it('renders the opening line exactly once in the create flow when applied to chat', () => {
    // Simulate what happens when a new session is created on the server and returned to the client
    const serverSession = initializeLearnerSession({
      userId: 'test-user',
      personaId: 'emmanuele',
      topic: 'market',
      learnerName: 'Luca',
      learnerLevel: 'A2'
    });

    const clientSession: ClientLearnerSession = {
      sessionId: serverSession.sessionId,
      personaId: serverSession.personaId,
      learnerName: serverSession.learnerName,
      learnerLevel: serverSession.learnerLevel,
      grammarStrictness: serverSession.grammarStrictness,
      topic: serverSession.topic,
      title: serverSession.title,
      progress: serverSession.progress,
      checkpointTurns: serverSession.checkpointTurns,
      createdAt: serverSession.createdAt,
      updatedAt: serverSession.updatedAt,
      expiresAt: serverSession.expiresAt
    };

    // The logic in applySession:
    const checkpointMessages = toChatMessages(clientSession.checkpointTurns, clientSession.personaId);
    const messages = checkpointMessages.length > 0
      ? checkpointMessages
      : createInitialMessages(EMMANUELE, clientSession.learnerName, clientSession.learnerLevel, clientSession.topic);

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('mercato');
  });

  it('renders the opening line exactly once in the restore flow with subsequent turns', () => {
    // Simulate a restored session that already has the opening turn plus learner & tutor turns
    const serverSession = initializeLearnerSession({
      userId: 'test-user',
      personaId: 'emmanuele',
      topic: 'market',
      learnerName: 'Luca',
      learnerLevel: 'A2'
    });

    serverSession.checkpointTurns.push(
      {
        id: 'turn_user_1',
        sender: 'user',
        text: 'Vorrei comprare delle mele.',
        timestamp: new Date().toISOString()
      },
      {
        id: 'turn_persona_1',
        sender: 'persona',
        text: 'Certamente! Quante mele vorresti?',
        translation: 'Of course! How many apples would you like?',
        timestamp: new Date().toISOString()
      }
    );

    const checkpointMessages = toChatMessages(serverSession.checkpointTurns, serverSession.personaId);
    const messages = checkpointMessages.length > 0
      ? checkpointMessages
      : createInitialMessages(EMMANUELE, serverSession.learnerName, serverSession.learnerLevel, serverSession.topic);

    expect(messages).toHaveLength(3);
    // Opening line is first and not duplicated
    expect(messages[0].text).toContain('mercato');
    expect(messages[1].text).toBe('Vorrei comprare delle mele.');
    expect(messages[2].text).toBe('Certamente! Quante mele vorresti?');

    const openingMatches = messages.filter((m) => m.text.includes('mercato'));
    expect(openingMatches).toHaveLength(1);
  });
});
