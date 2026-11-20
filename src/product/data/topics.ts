/** Fixed list of conversation topics for Italian tutoring sessions. */

export interface TopicFirstLine {
  text: string;
  translation: string;
}

export interface ConversationTopic {
  id: string;
  label: string;
  description: string;
  promptLine?: string;
  firstLine?: TopicFirstLine;
}

export const CONVERSATION_TOPICS: readonly ConversationTopic[] = [
  {
    id: 'free_chat',
    label: 'Free chat',
    description: 'Open conversation on any topic',
    promptLine: undefined,
    firstLine: undefined
  },
  {
    id: 'market',
    label: 'At the market',
    description: 'Buy fresh food at an Italian local market',
    promptLine: 'Argomento della conversazione: fare la spesa al mercato rionale di frutta e verdura.',
    firstLine: {
      text: 'Ciao! Cosa compriamo oggi al mercato? Frutta fresca o verdura di stagione?',
      translation: 'Hi! What are we buying at the market today? Fresh fruit or seasonal vegetables?'
    }
  },
  {
    id: 'cafe',
    label: 'Ordering at a café',
    description: 'Order coffee, drinks, and pastries at a bar',
    promptLine: 'Argomento della conversazione: ordinare caffè, bevande e cornetti al bar.',
    firstLine: {
      text: 'Buongiorno! Benvenuto al bar. Cosa ti posso portare, un caffè o un cappuccino?',
      translation: 'Good morning! Welcome to the bar. What can I get you, a coffee or a cappuccino?'
    }
  },
  {
    id: 'directions',
    label: 'Asking for directions',
    description: 'Navigate Rome and ask for street directions',
    promptLine: 'Argomento della conversazione: chiedere e dare indicazioni stradali in città.',
    firstLine: {
      text: 'Ciao! Ti sei perso per le strade di Roma? Dove devi andare?',
      translation: 'Hi! Are you lost in the streets of Rome? Where do you need to go?'
    }
  },
  {
    id: 'day',
    label: 'Talking about your day',
    description: 'Share your daily routine and what happened today',
    promptLine: 'Argomento della conversazione: raccontare la propria giornata e le abitudini quotidiane.',
    firstLine: {
      text: "Ciao! Com'è andata la tua giornata oggi? Raccontami un po'!",
      translation: 'Hi! How was your day today? Tell me a bit!'
    }
  },
  {
    id: 'doctor',
    label: "At the doctor's",
    description: 'Explain symptoms and talk about health',
    promptLine: 'Argomento della conversazione: una visita medica o dal dottore descrivendo sintomi e salute.',
    firstLine: {
      text: 'Buongiorno! Mi dica, come si sente oggi? Ha qualche disturbo?',
      translation: 'Good morning! Tell me, how are you feeling today? Any discomfort?'
    }
  }
];

export const VALID_TOPIC_IDS: readonly string[] = CONVERSATION_TOPICS.map((t) => t.id);

/**
 * Check whether a topic identifier is one of the supported conversation topics.
 *
 * Args:
 *   topicId: Untrusted topic id string.
 *
 * Returns:
 *   True when topicId is recognized.
 */
export function isValidTopicId(topicId: unknown): topicId is string {
  return typeof topicId === 'string' && VALID_TOPIC_IDS.includes(topicId);
}

/**
 * Look up a conversation topic definition by ID.
 *
 * Args:
 *   topicId: Topic identifier.
 *
 * Returns:
 *   The matching ConversationTopic or undefined.
 */
export function getTopicById(topicId: string | undefined): ConversationTopic | undefined {
  if (!topicId) return undefined;
  return CONVERSATION_TOPICS.find((t) => t.id === topicId);
}
