import { CefrLevel, ChatMessage, GrammarNote, Persona, SavedPhrase } from '../types';
import { isPremiumPersona, PERSONA_PROMPTS, PERSONA_VOICES } from './personaPrompts';
import { getTutorGreeting } from './personaGreetings';
import emmanueleIdle from '../../assets/emmanuele/neutral.webp';
import emmanueleSpeaking from '../../assets/emmanuele/talking.webp';

export const EMMANUELE: Persona = {
  id: 'emmanuele',
  name: 'Emmanuele',
  fullName: 'Emmanuele il Romano',
  age: 42,
  city: 'Roma',
  region: 'Lazio',
  role: 'Retired Legionary',
  dailyContext: 'life in Rome',
  avatar: {
    idle: emmanueleIdle,
    speaking: emmanueleSpeaking
  },
  cefrLevel: 'A2',
  levelLabel: 'A2-B1 · Everyday conversation',
  dialectSpecialty: 'Clear standard Italian with a Roman twist',
  bio: 'A retired legionary who traded his shield for a bench near the Forum. He loves chatting about daily life in Rome, food, work and the city\'s stories, and corrects you with a soldier\'s patience.',
  topics: ['Daily life in Rome', 'Work & routines', 'Food & markets', 'Roman history'],
  nativeSaying: 'Roma non è stata costruita in un giorno.',
  nativeSayingTranslation: 'Rome was not built in a day.',
  quickReplies: ['molto', 'assolutamente', 'non lo so', 'e tu?'],
  voiceId: PERSONA_VOICES.emmanuele,
  voiceGender: 'male',
  sampleAudioText: 'Salve, amico! Sono Emmanuele. Oggi Roma è piena di gente. Raccontami qualcosa di te!',
  sampleAudioTranslation: 'Hello, friend! I am Emmanuele. Rome is full of people today. Tell me something about yourself!',
  personaPrompt: PERSONA_PROMPTS.emmanuele,
  isPremium: isPremiumPersona('emmanuele')
};

export const TUTORS: Persona[] = [EMMANUELE];

export interface CefrLevelOption {
  level: CefrLevel;
  title: string;
  subtitle: string;
  vocabularyHint: string;
}

export const CEFR_LEVEL_OPTIONS: CefrLevelOption[] = [
  {
    level: 'A1',
    title: 'Beginner',
    subtitle: 'First steps in Italian',
    vocabularyHint: 'Very simple core words, short sentences (6–8 words), present tense only.'
  },
  {
    level: 'A2',
    title: 'Elementary',
    subtitle: 'Everyday basics',
    vocabularyHint: 'Accessible daily vocabulary, clear short sentences, present & past tense.'
  },
  {
    level: 'B1',
    title: 'Intermediate',
    subtitle: 'Natural conversation',
    vocabularyHint: 'Varied vocabulary on work, travel & opinions, with connectors and common idioms.'
  },
  {
    level: 'B2',
    title: 'Upper-Intermediate',
    subtitle: 'Nuanced & expressive',
    vocabularyHint: 'Rich vocabulary, subjunctive mood, subordinate clauses, and Roman sayings.'
  },
  {
    level: 'C1',
    title: 'Advanced',
    subtitle: 'Near-native fluency',
    vocabularyHint: 'Sophisticated lexicon, ironic nuances, complex syntax, and authentic idioms.'
  }
];

export function createInitialMessages(
  persona: Persona,
  learnerName: string,
  level: CefrLevel,
  topicId?: string
): ChatMessage[] {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const greeting = getTutorGreeting(persona.id, learnerName, level, topicId);

  return [
    {
      id: `init-${topicId ?? level}-${Date.now()}`,
      sender: 'persona',
      personaId: persona.id,
      text: greeting.text,
      translation: greeting.translation,
      grammarNotes: (greeting.grammarNotes ?? []).map((n) => ({
        wordOrPhrase: n.wordOrPhrase,
        explanation: n.explanation,
        category: (n.category as GrammarNote['category']) ?? 'vocabulary'
      })),
      timestamp
    }
  ];
}

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'e1',
    sender: 'persona',
    personaId: 'emmanuele',
    text: 'Salve! Roma è piena di turisti oggi. E tu, che lavoro fai?',
    translation: 'Hello! Rome is full of tourists today. And you, what do you do for work?',
    grammarNotes: [
      {
        wordOrPhrase: 'che lavoro fai?',
        explanation: 'Literally "what work do you do?". The everyday way to ask someone\'s job, using fare (to do).',
        category: 'verb'
      }
    ],
    timestamp: '09:40'
  }
];

export const INITIAL_SAVED_PHRASES: SavedPhrase[] = [];

export const ITALIAN_PRACTICE_PHRASES = [
  { it: 'Io lavoro in un ufficio.', en: 'I work in an office.' },
  { it: 'Puoi parlare un po\' più lentamente?', en: 'Can you speak a little slower?' },
  { it: 'Come si dice "weekend" in italiano?', en: 'How do you say "weekend" in Italian?' },
  { it: 'Che cosa mi consigli di vedere a Roma?', en: 'What do you recommend I see in Rome?' },
  { it: 'Mi piace molto il mio lavoro.', en: 'I like my job a lot.' }
];
