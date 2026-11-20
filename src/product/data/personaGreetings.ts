import type { CefrLevel } from '../types';
import { getTopicById } from './topics';

export interface PersonaGreeting {
  text: string;
  translation: string;
  grammarNotes?: Array<{
    wordOrPhrase: string;
    explanation: string;
    category: string;
  }>;
}

/**
 * Returns the opening greeting line for a tutor, adapted to CEFR level or topic.
 * Kept free of asset imports so both browser and Node server can use it.
 */
export function getTutorGreeting(
  personaId: string,
  learnerName: string = '',
  level: CefrLevel = 'A2',
  topicId?: string
): PersonaGreeting {
  const cleanName = learnerName.trim() || 'amico';

  if (topicId && topicId !== 'free_chat') {
    const topic = getTopicById(topicId);
    if (topic?.firstLine) {
      return {
        text: topic.firstLine.text,
        translation: topic.firstLine.translation,
        grammarNotes: []
      };
    }
  }

  const tutorName = personaId === 'emmanuele' ? 'Emmanuele' : (personaId.charAt(0).toUpperCase() + personaId.slice(1));

  const greetingsByLevel: Record<CefrLevel, { text: string; translation: string; noteWord: string; noteExplanation: string }> = {
    A1: {
      text: `Ciao ${cleanName}! Io sono ${tutorName}. Come stai oggi?`,
      translation: `Hi ${cleanName}! I am ${tutorName}. How are you today?`,
      noteWord: 'Come stai?',
      noteExplanation: 'The friendly, informal way to ask "How are you?" in Italian.'
    },
    A2: {
      text: `Salve, ${cleanName}! Roma è piena di turisti oggi. E tu, che lavoro fai?`,
      translation: `Hello, ${cleanName}! Rome is full of tourists today. And you, what do you do for work?`,
      noteWord: 'che lavoro fai?',
      noteExplanation: 'Literally "what work do you do?". The everyday way to ask someone\'s job, using fare (to do).'
    },
    B1: {
      text: `Salve, ${cleanName}! Stavo passeggiando vicino al Foro Romano. Raccontami un po': come mai hai deciso di imparare l'italiano?`,
      translation: `Hello, ${cleanName}! I was strolling near the Roman Forum. Tell me a bit: how come you decided to learn Italian?`,
      noteWord: 'come mai',
      noteExplanation: 'A natural, conversational way to ask "how come" or "why", softer and more curious than "perché".'
    },
    B2: {
      text: `Benvenuto a Roma, ${cleanName}! Qui si dice che tutte le strade portano a Roma. Quale aspetto della nostra cultura ti incuriosisce di più?`,
      translation: `Welcome to Rome, ${cleanName}! Here they say all roads lead to Rome. Which aspect of our culture intrigues you the most?`,
      noteWord: 'ti incuriosisce',
      noteExplanation: 'From "incuriosire" (to make curious / intrigue). Takes an indirect object pronoun ("ti") for the person intrigued.'
    },
    C1: {
      text: `Salve, ${cleanName}! È un vero piacere fare la tua conoscenza all'ombra del Colosseo. Dimmi pure: cosa ti spinge ad approfondire le sfumature della nostra lingua?`,
      translation: `Greetings, ${cleanName}! It is a true pleasure to make your acquaintance in the shadow of the Colosseum. Do tell me: what drives you to delve into the nuances of our language?`,
      noteWord: 'cosa ti spinge a…',
      noteExplanation: 'Idiomatic use of "spingere" (literally "to push") meaning "what drives/motivates you to…".'
    }
  };

  const chosen = greetingsByLevel[level] || greetingsByLevel.A2;
  return {
    text: chosen.text,
    translation: chosen.translation,
    grammarNotes: [
      {
        wordOrPhrase: chosen.noteWord,
        explanation: chosen.noteExplanation,
        category: 'vocabulary'
      }
    ]
  };
}
