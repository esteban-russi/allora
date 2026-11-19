import { useEffect, useMemo, useRef, useState } from 'react';
import { EMMANUELE, INITIAL_MESSAGES, INITIAL_SAVED_PHRASES, TUTORS, createInitialMessages } from './data/personas';
import { generatePersonaFallbackMessage } from './data/fallbacks';
import { ChatMessage, DevSettings, GrammarNote, LearnerProfile, Persona, SavedPhrase } from './types';
import { ChatInterface } from './components/ChatInterface';
import { VoiceCallModal } from './components/VoiceCallModal';
import { DevSettingsDrawer } from './components/DevSettingsDrawer';
import { PersonaProfileModal } from './components/PersonaProfileModal';
import { IconRail } from './components/IconRail';
import { TopHeader } from './components/TopHeader';
import { UtilityPanel } from './components/UtilityPanel';
import { OnboardingPage } from './components/OnboardingPage';
import { SignInScreen } from './components/SignInScreen';
import { MagicLinkEmailForm } from './components/MagicLinkEmailForm';
import { AccountMenu } from './components/AccountMenu';
import { LimitReachedCard } from './components/LimitReachedCard';
import { PlansScreen } from './components/PlansScreen';
import { getBilling } from './utils/billing';
import { useDialog } from './hooks/useDialog';
import { useAccount } from './hooks/useAccount';
import { speechService } from './utils/speech';
import { completeMagicLink, EMAIL_FOR_SIGN_IN_KEY, isMagicLink } from './utils/firebaseAuth';
import { MERGE_FAILED_NOTICE, showNotice } from './utils/notice';
import { loadLearnerSession, postChat, saveLearnerSettings, startLearnerSession, toChatMessages } from './utils/learnerSession';
import { readQuotaError, type QuotaError } from './utils/quotaError';
import type { ClientLearnerSession } from './server/sessionStore';

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const GRAMMAR_STRICTNESS: DevSettings['grammarStrictness'][] = ['conversational', 'tutor', 'strict'];

export default function App() {
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(null);
  const [screen, setScreen] = useState<'onboarding' | 'signin-after-onboarding' | 'signin-login' | 'plans' | 'app'>('onboarding');
  // True until the saved session (if any) has been loaded, so onboarding does not flash
  const [isRestoring, setIsRestoring] = useState<boolean>(true);
  // A sign-in link waiting for the learner to confirm which email it was sent to
  const [pendingMagicLinkUrl, setPendingMagicLinkUrl] = useState<string | null>(null);

  const { me, refresh: refreshAccount, setUsage } = useAccount();
  const [limitReached, setLimitReached] = useState<QuotaError | null>(null);
  const [chatDraft, setChatDraft] = useState<string>('');

  const persona: Persona = useMemo(
    () => TUTORS.find((t) => t.id === learnerProfile?.personaId) ?? EMMANUELE,
    [learnerProfile?.personaId]
  );
  const learnerInitial = (learnerProfile?.name.trim().charAt(0) || 'E').toUpperCase();

  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [savedPhrases, setSavedPhrases] = useState<SavedPhrase[]>(INITIAL_SAVED_PHRASES);
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);
  const [isCallOpen, setIsCallOpen] = useState<boolean>(false);

  // Modals & drawers
  const [isDevLabOpen, setIsDevLabOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isNotebookDrawerOpen, setIsNotebookDrawerOpen] = useState<boolean>(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState<boolean>(false);

  const notebookDrawerRef = useRef<HTMLDivElement>(null);
  const notebookHeadingRef = useRef<HTMLHeadingElement>(null);
  useDialog(notebookDrawerRef, isNotebookDrawerOpen, () => setIsNotebookDrawerOpen(false));

  // Experimental Dev Settings (Defaulting to real Gemini Live server TTS)
  const [devSettings, setDevSettings] = useState<DevSettings>({
    voiceProvider: 'gemini_live',
    voiceId: EMMANUELE.voiceId,
    sttProvider: 'production_cloud',
    voiceCallEngine: 'realtime_live',
    temperature: 0.7,
    speechRate: 0.95,
    audioSamplingRate: '24kHz',
    grammarStrictness: 'tutor',
    subtitlesEnabled: true,
    autoPlayAudio: false,
  });

  // Latest grammar tip from the tutor, featured in the notebook
  const grammarHighlight = useMemo<GrammarNote | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const notes = messages[i].grammarNotes;
      if (messages[i].sender === 'persona' && notes && notes.length > 0) return notes[0];
    }
    return null;
  }, [messages]);

  // Share of words the learner produced in this conversation
  const talkingShare = useMemo(() => {
    let learner = 0;
    let total = 0;
    for (const m of messages) {
      const words = countWords(m.text);
      total += words;
      if (m.sender === 'user') learner += words;
    }
    return total === 0 ? 0 : Math.round((learner / total) * 100);
  }, [messages]);

  const applySession = (session: ClientLearnerSession) => {
    const tutor = TUTORS.find((t) => t.id === session.personaId) ?? EMMANUELE;
    const profile: LearnerProfile = { name: session.learnerName, level: session.learnerLevel, personaId: tutor.id };
    setLearnerProfile(profile);
    setMessages([
      ...createInitialMessages(tutor, profile.name, profile.level),
      ...toChatMessages(session.checkpointTurns, tutor.id)
    ]);
    setSavedPhrases(session.progress.savedPhrases);
    if (GRAMMAR_STRICTNESS.includes(session.grammarStrictness as DevSettings['grammarStrictness'])) {
      setDevSettings((prev) => ({ ...prev, grammarStrictness: session.grammarStrictness as DevSettings['grammarStrictness'] }));
    }
  };

  const handleSignedIn = async (mode: 'login' | 'after-onboarding') => {
    const updatedMe = await refreshAccount();
    const session = await loadLearnerSession();
    if (session) {
      applySession(session);
      if (mode === 'after-onboarding' && getBilling().isAvailable() && updatedMe?.tier !== 'premium') {
        setScreen('plans');
      } else {
        setScreen('app');
      }
    } else if (mode === 'login') {
      setScreen('onboarding');
    } else {
      if (learnerProfile) {
        void startLearnerSession({ profile: learnerProfile, grammarStrictness: devSettings.grammarStrictness, savedPhrases });
      }
      if (getBilling().isAvailable() && updatedMe?.tier !== 'premium') {
        setScreen('plans');
      } else {
        setScreen('app');
      }
    }
  };

  // Leave the sign-in link's URL, so a reload does not try to use the one-time code again
  const clearMagicLinkUrl = () => window.history.replaceState(null, '', '/');

  // Complete an email-link sign-in, then show the account's conversation or say why it failed
  const finishMagicLink = async (url: string, email: string) => {
    const result = await completeMagicLink(url, email).catch(() => null);
    clearMagicLinkUrl();
    setPendingMagicLinkUrl(null);

    if (!result?.ok) {
      showNotice('That sign-in link has expired, was already used, or does not match this email. Request a new one.');
      setScreen('signin-login');
      return;
    }
    try {
      localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
    } catch {
      // Local storage unavailable
    }
    if (result.mergeFailed) showNotice(MERGE_FAILED_NOTICE);

    await refreshAccount();
    const session = await loadLearnerSession();
    if (session) {
      applySession(session);
      setScreen('app');
    } else {
      setScreen('onboarding');
    }
  };

  // Bring back the learner's profile, conversation and notebook from their saved session
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        if (typeof window !== 'undefined' && (await isMagicLink(window.location.href))) {
          const url = window.location.href;
          let email: string | null = null;
          try {
            email = localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
          } catch {
            // Local storage unavailable
          }
          if (!email) {
            // Opened in a browser that did not request the link: ask for the email first
            if (!cancelled) setPendingMagicLinkUrl(url);
            return;
          }
          await finishMagicLink(url, email);
          return;
        }

        const session = await loadLearnerSession();
        if (cancelled || !session) return;
        applySession(session);
        setScreen('app');
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Clear quota limit card when tier changes or reset time elapses
  useEffect(() => {
    if (!limitReached) return;
    if (me && limitReached.tier !== me.tier) {
      setLimitReached(null);
      return;
    }
    const resetMs = Date.parse(limitReached.resetsAt);
    if (!isNaN(resetMs)) {
      const remaining = resetMs - Date.now();
      if (remaining <= 0) {
        setLimitReached(null);
      } else {
        const timer = setTimeout(() => setLimitReached(null), remaining);
        return () => clearTimeout(timer);
      }
    }
  }, [limitReached, me?.tier]);

  const updateSavedPhrases = (next: SavedPhrase[]) => {
    setSavedPhrases(next);
    if (learnerProfile) {
      void saveLearnerSettings({ profile: learnerProfile, grammarStrictness: devSettings.grammarStrictness, savedPhrases: next });
    }
  };

  const speakIfAutoPlay = (text: string) => {
    if (!devSettings.autoPlayAudio) return;
    speechService.speakSmart(text, {
      provider: devSettings.voiceProvider,
      voiceName: persona.voiceId,
      gender: persona.voiceGender
    });
  };

  const handleCompleteOnboarding = (profile: LearnerProfile) => {
    const selectedTutor = TUTORS.find((t) => t.id === profile.personaId) ?? EMMANUELE;
    setLearnerProfile(profile);
    setMessages(createInitialMessages(selectedTutor, profile.name, profile.level));
    // A new profile starts a new conversation; the notebook carries over
    void startLearnerSession({ profile, grammarStrictness: devSettings.grammarStrictness, savedPhrases });
    if (me?.isAnonymous) {
      setScreen('signin-after-onboarding');
    } else {
      setScreen('app');
    }
  };

  // Handle student sending message in chat with real server Gemini API integration
  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      personaId: persona.id,
      text,
      translation: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updated = [...messages, userMsg];
    setMessages(updated);
    setIsAiGenerating(true);

    try {
      const res = await postChat({
        personaId: persona.id,
        history: updated.slice(-6),
        userMessage: text,
        temperature: devSettings.temperature,
        grammarStrictness: devSettings.grammarStrictness,
        learnerLevel: learnerProfile?.level ?? 'A2',
        learnerName: learnerProfile?.name
      });

      const quota = await readQuotaError(res);
      if (quota) {
        setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
        setChatDraft(text);
        setLimitReached(quota);
        setIsAiGenerating(false);
        return;
      }

      if (res.ok) {
        const data = await res.json();
        if (data?.quota && typeof data.quota.used === 'number') {
          setUsage('chatMessages', data.quota.used);
        }
        if (data.text) {
          const aiMessage: ChatMessage = {
            id: `b-${Date.now()}`,
            sender: 'persona',
            personaId: persona.id,
            text: data.text,
            translation: data.translation || '',
            grammarNotes: data.grammarNotes || [],
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          setMessages((prev) => [...prev, aiMessage]);
          speakIfAutoPlay(aiMessage.text);
          setIsAiGenerating(false);
          return;
        }
      }
    } catch (err) {
      console.warn('Server Gemini call error, using local fallback generator:', err);
    }

    // Local fallback generator if server is offline
    setTimeout(() => {
      const fallbackResponse = generatePersonaFallbackMessage(persona, text);
      setMessages((prev) => [...prev, fallbackResponse]);
      speakIfAutoPlay(fallbackResponse.text);
      setIsAiGenerating(false);
    }, 500);
  };

  const handleSavePhrase = (message: ChatMessage) => {
    updateSavedPhrases(
      savedPhrases.some(p => p.id === message.id)
        ? savedPhrases.filter(p => p.id !== message.id)
        : [{ id: message.id, it: message.text, en: message.translation }, ...savedPhrases]
    );
  };

  const openNotebook = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      notebookHeadingRef.current?.focus();
      notebookHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
      setIsNotebookDrawerOpen(true);
    }
  };

  const startCall = async () => {
    setIsNotebookDrawerOpen(false);
    const m = await refreshAccount();
    if (m && m.usage.voiceSeconds >= m.limits.voiceSeconds) {
      setLimitReached({
        counter: 'voiceSeconds',
        limit: m.limits.voiceSeconds,
        tier: m.tier,
        resetsAt: m.resetsAt
      });
      return;
    }
    setIsCallOpen(true);
  };

  const panelProps = {
    persona,
    grammarHighlight,
    savedPhrases,
    talkingShare,
    me,
    onSwitchToVoice: startCall,
    onOpenProfile: () => setIsProfileModalOpen(true),
    onRemovePhrase: (id: string) => updateSavedPhrases(savedPhrases.filter(p => p.id !== id))
  };

  if (isRestoring) {
    return (
      <div className="h-dvh w-full flex items-center justify-center bg-canvas text-ink" role="status" aria-live="polite">
        Caricamento…
      </div>
    );
  }

  if (pendingMagicLinkUrl) {
    return (
      <MagicLinkEmailForm
        onSubmit={(email) => void finishMagicLink(pendingMagicLinkUrl, email)}
        onCancel={() => {
          clearMagicLinkUrl();
          setPendingMagicLinkUrl(null);
          // Carry on as before the link was opened, with this browser's own session if any
          void loadLearnerSession().then((session) => {
            if (!session) return;
            applySession(session);
            setScreen('app');
          });
        }}
      />
    );
  }

  if (screen === 'signin-after-onboarding') {
    return (
      <SignInScreen
        mode="after-onboarding"
        onSignedIn={() => handleSignedIn('after-onboarding')}
        onSkip={() => setScreen('app')}
      />
    );
  }

  if (screen === 'signin-login') {
    return (
      <SignInScreen
        mode="login"
        onSignedIn={() => handleSignedIn('login')}
        onSkip={() => setScreen('onboarding')}
      />
    );
  }

  if (screen === 'plans' && me) {
    return (
      <PlansScreen
        me={me}
        onDone={() => setScreen('app')}
        onNeedSignIn={() => setScreen('signin-login')}
        refreshAccount={refreshAccount}
      />
    );
  }

  if (screen === 'onboarding' || !learnerProfile) {
    return (
      <OnboardingPage
        initialProfile={learnerProfile}
        onComplete={handleCompleteOnboarding}
        onLogin={me?.isAnonymous ? () => setScreen('signin-login') : undefined}
      />
    );
  }

  return (
    <div className="h-dvh w-full flex overflow-hidden bg-canvas text-ink">
      <IconRail
        learnerInitial={learnerInitial}
        onOpenNotebook={openNotebook}
        onOpenVoiceLab={() => setIsDevLabOpen(true)}
        onOpenAccount={() => setIsAccountMenuOpen(true)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader
          persona={persona}
          learnerInitial={learnerInitial}
          learnerLevel={learnerProfile.level}
          mode={isCallOpen ? 'voice' : 'text'}
          onSelectVoice={startCall}
          onOpenNotebook={openNotebook}
          onOpenAccount={() => setIsAccountMenuOpen(true)}
        />

        <div className="flex-1 min-h-0 flex gap-5 lg:pr-5 lg:pb-5">
          <div id="chat" className="flex-1 min-w-0 flex">
            <ChatInterface
              persona={persona}
              messages={messages}
              devSettings={devSettings}
              savedPhraseIds={savedPhrases.map(p => p.id)}
              onSendMessage={handleSendMessage}
              onSavePhrase={handleSavePhrase}
              isAiGenerating={isAiGenerating}
              draft={chatDraft}
              onDraftChange={setChatDraft}
              limitReached={limitReached}
              tier={me?.tier ?? 'guest'}
              canUpgrade={getBilling().isAvailable() && me?.tier === 'free'}
              onSignIn={() => setScreen('signin-login')}
              onSeePlans={() => setScreen('plans')}
            />
          </div>

          <div className="hidden lg:block w-[360px] xl:w-[380px] shrink-0">
            <UtilityPanel {...panelProps} notebookHeadingRef={notebookHeadingRef} />
          </div>
        </div>
      </div>

      {/* Notebook as a drawer below the lg breakpoint */}
      {isNotebookDrawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 flex justify-end bg-ink/30 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) setIsNotebookDrawerOpen(false); }}
        >
          <div
            ref={notebookDrawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Tutor and notebook"
            tabIndex={-1}
            className="w-full max-w-[380px] h-full p-3 focus:outline-none"
          >
            <UtilityPanel {...panelProps} onClose={() => setIsNotebookDrawerOpen(false)} />
          </div>
        </div>
      )}

      {isCallOpen && (
        <VoiceCallModal
          persona={persona}
          devSettings={devSettings}
          learnerProfile={learnerProfile}
          onEndCall={() => setIsCallOpen(false)}
          onLimitReached={async () => {
            const m = await refreshAccount();
            if (m) {
              setLimitReached({
                counter: 'voiceSeconds',
                limit: m.limits.voiceSeconds,
                tier: m.tier,
                resetsAt: m.resetsAt
              });
            }
          }}
        />
      )}

      {limitReached && limitReached.counter === 'voiceSeconds' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setLimitReached(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Voice limit reached"
            className="w-full max-w-sm bg-surface border border-line rounded-[24px] p-6 shadow-2xl space-y-4"
          >
            <LimitReachedCard
              quota={limitReached}
              tier={me?.tier ?? 'guest'}
              canUpgrade={getBilling().isAvailable() && me?.tier === 'free'}
              onSignIn={() => {
                setLimitReached(null);
                setScreen('signin-login');
              }}
              onSeePlans={() => {
                setLimitReached(null);
                setScreen('plans');
              }}
              onDismiss={() => setLimitReached(null)}
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setLimitReached(null)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-ink-muted hover:text-ink hover:bg-surface-tint transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <DevSettingsDrawer
        isOpen={isDevLabOpen}
        onClose={() => setIsDevLabOpen(false)}
        settings={devSettings}
        onSaveSettings={(updated) => {
          setDevSettings(updated);
          if (learnerProfile && updated.grammarStrictness !== devSettings.grammarStrictness) {
            void saveLearnerSettings({ profile: learnerProfile, grammarStrictness: updated.grammarStrictness, savedPhrases });
          }
        }}
        activePersonaName={persona.fullName}
      />

      <PersonaProfileModal
        persona={persona}
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onStartVideoCall={startCall}
      />

      <AccountMenu
        isOpen={isAccountMenuOpen}
        onClose={() => setIsAccountMenuOpen(false)}
        me={me}
        onEditProfile={() => {
          setIsAccountMenuOpen(false);
          setScreen('onboarding');
        }}
        onSignIn={() => {
          setIsAccountMenuOpen(false);
          setScreen('signin-login');
        }}
        onUpgrade={() => {
          setIsAccountMenuOpen(false);
          setScreen('plans');
        }}
        onSignedOut={() => {
          setIsAccountMenuOpen(false);
          refreshAccount();
          setScreen('onboarding');
        }}
        onAccountDeleted={() => {
          setIsAccountMenuOpen(false);
          refreshAccount();
          setScreen('onboarding');
        }}
      />
    </div>
  );
}
