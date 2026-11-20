/** Tests for conversation topics and prompt line context inclusion. */
import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_TOPICS,
  getTopicById,
  isValidTopicId,
  VALID_TOPIC_IDS
} from '../src/product/data/topics';
import {
  buildSystemInstruction,
  buildVoiceCallInstruction
} from '../src/product/data/personaPrompts';

describe('conversation topics', () => {
  it('defines the required fixed topics including free chat', () => {
    expect(CONVERSATION_TOPICS.length).toBeGreaterThanOrEqual(6);
    expect(VALID_TOPIC_IDS).toContain('free_chat');
    expect(VALID_TOPIC_IDS).toContain('market');
    expect(VALID_TOPIC_IDS).toContain('cafe');
    expect(VALID_TOPIC_IDS).toContain('directions');
    expect(VALID_TOPIC_IDS).toContain('day');
    expect(VALID_TOPIC_IDS).toContain('doctor');
  });

  it('validates known and rejects unknown topic IDs', () => {
    expect(isValidTopicId('market')).toBe(true);
    expect(isValidTopicId('free_chat')).toBe(true);
    expect(isValidTopicId('unknown-topic')).toBe(false);
    expect(isValidTopicId('')).toBe(false);
    expect(isValidTopicId(null)).toBe(false);
  });

  it('returns topic metadata and first lines for non-free topics', () => {
    const market = getTopicById('market');
    expect(market).toBeDefined();
    expect(market?.label).toBe('At the market');
    expect(market?.promptLine).toContain('mercato');
    expect(market?.firstLine?.text).toBeDefined();
    expect(market?.firstLine?.translation).toBeDefined();

    const free = getTopicById('free_chat');
    expect(free?.label).toBe('Free chat');
    expect(free?.promptLine).toBeUndefined();
    expect(free?.firstLine).toBeUndefined();
  });

  it('embeds topic instruction in buildSystemInstruction when topic is set', () => {
    const withoutTopic = buildSystemInstruction({ personaId: 'emmanuele', level: 'A2' });
    const withMarket = buildSystemInstruction({
      personaId: 'emmanuele',
      level: 'A2',
      topic: 'market'
    });
    const withFree = buildSystemInstruction({
      personaId: 'emmanuele',
      level: 'A2',
      topic: 'free_chat'
    });

    expect(withoutTopic).not.toContain('mercato');
    expect(withMarket).toContain('mercato rionale');
    expect(withFree).not.toContain('mercato');
  });

  it('embeds topic instruction in buildVoiceCallInstruction when topic is set', () => {
    const withCafe = buildVoiceCallInstruction({
      personaId: 'emmanuele',
      level: 'A2',
      topic: 'cafe'
    });
    expect(withCafe).toContain('ordinare caffè');
  });
});
