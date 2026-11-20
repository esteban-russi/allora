import { useEffect, useMemo, useState } from 'react';
import { EMMANUELE, INITIAL_MESSAGES, INITIAL_SAVED_PHRASES, TUTORS, createInitialMessages } from './product/data/personas';
import { ChatMessage, DevSettings, LearnerProfile, Persona, SavedPhrase } from './product/types';
import { ChatInterface } from './product/components/ChatInterface';
import { VoiceCallModal } from './product/components/VoiceCallModal';
import { DevSettingsDrawer } from './product/components/DevSettingsDrawer';
import { SettingsDialog, isDevLabEnabled } from './product/components/SettingsDialog';
import { PersonaProfileModal } from './product/components/PersonaProfileModal';
import { IconRail } from './product/components/IconRail';
import { TopHeader } from './product/components/TopHeader';
import { UtilityPanel } from './product/components/UtilityPanel';
import { HomeTab } from './product/components/HomeTab';
import { NotebookTab } from './product/components/NotebookTab';
import { ProfileTab } from './product/components/ProfileTab';
import { BottomTabBar } from './product/components/BottomTabBar';
import { OnboardingPage } from './product/components/OnboardingPage';
import { SignInScreen } from './platform/components/SignInScreen';
import { MagicLinkEmailForm } from './platform/components/MagicLinkEmailForm';
import { AccountMenu } from './platform/components/AccountMenu';
import { ConsentDialog } from './platform/components/ConsentDialog';
import { LimitReachedCard } from './platform/components/LimitReachedCard';
import { isTutorLockedForTier } from './product/components/PremiumEndedNotice';
import { PlansScreen } from './product/components/PlansScreen';
import { TERMS_VERSION } from './config/legal';
import type { Consent } from './platform/server/accountStore';
import { getBilling } from './platform/client/billing';
import { useAccount } from './platform/hooks/useAccount';
import { useConversationStats } from './product/hooks/useConversationStats';
import { useLimitReached } from './platform/hooks/useLimitReached';
import { useWebBilling } from './platform/hooks/useWebBilling';
import { useTutorChat } from './product/hooks/useTutorChat';
import { useScreenFlow, type SignInMode } from './product/hooks/useScreenFlow';
import { useAppNavigation } from './product/hooks/useAppNavigation';
import { speechService } from './product/client/speech';
import { setAccountDeletedHandler, setAppCheckFailedHandler } from './platform/client/apiClient';
import { completeMagicLink, EMAIL_FOR_SIGN_IN_KEY, isMagicLink, signOutToGuest } from './platform/client/firebaseAuth';
import { ACCOUNT_DELETED_NOTICE, APP_CHECK_FAILED_NOTICE, MERGE_FAILED_NOTICE, showNotice } from './platform/client/notice';
import { loadLearnerSession, saveLearnerSettings, startLearnerSession, toChatMessages, createConversation, deleteSessionById, fetchSessionById, fetchSessionList, getLearnerSessionId, rememberLearnerSessionId } from './product/client/learnerSession';
import type { ClientLearnerSession, SessionSummary } from './product/server/sessionStore';
import { ConversationListScreen } from './product/components/ConversationListScreen';
import { NewConversationSheet } from './product/components/NewConversationSheet';
import { fetchHabits, subscribeHabits, updateHabitSettings } from './product/client/habitsClient';
import type { HabitGoal, HabitReminder, HabitSummary } from './product/server/habitStore';

const GRAMMAR_STRICTNESS: DevSettings['grammarStrictness'][] = ['conversational', 'tutor', 'strict'];

export default function App() {
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(null);
  const flow = useScreenFlow();
  const { screen, setScreen } = flow;
  // True until the saved session (if any) has been loaded, so onboarding does not flash
  const [isRestoring, setIsRestoring] = useState<boolean>(true);
  // A sign-in link waiting for the learner to confirm which email it was sent to
  const [pendingMagicLinkUrl, setPendingMagicLinkUrl] = useState<string | null>(null);

  const { me, refresh: refreshAccount, setUsage, setConsent } = useAccount();
  const hasCurrentConsent = me?.consent?.termsVersion === TERMS_VERSION;
  const needsConsent = Boolean(me && !hasCurrentConsent);
  const [limitReached, setLimitReached] = useLimitReached(me?.tier);
  const [premiumEnded, setPremiumEnded] = useState<boolean>(false);

  useWebBilling(me?.email ?? null);

  const nav = useAppNavigation({ initialTab: 'chat' });
  const {
    activeTab,
    selectTab,
    isComposerFocused,
    setIsComposerFocused,
    homeHeadingRef,
    notebookHeadingRef,
    profileHeadingRef,
    pushOverlay,
    closeOverlay,
    pushScreen,
    closeScreen
  } = nav;

  const persona: Persona = useMemo(
    () => TUTORS.find((t) => t.id === learnerProfile?.personaId) ?? EMMANUELE,
    [learnerProfile?.personaId]
  );
  const learnerInitial = (learnerProfile?.name.trim().charAt(0) || 'E').toUpperCase();

  const [savedPhrases, setSavedPhrases] = useState<SavedPhrase[]>(INITIAL_SAVED_PHRASES);
  const [isCallOpen, setIsCallOpen] = useState<boolean>(false);

  // Modals & dialogs
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isDevLabOpen, setIsDevLabOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [profileModalPersona, setProfileModalPersona] = useState<Persona>(persona);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState<boolean>(false);
  const [isConversationsOpen, setIsConversationsOpen] = useState<boolean>(false);
  const [isNewConversationOpen, setIsNewConversationOpen] = useState<boolean>(false);
  const [sessionSummaries, setSessionSummaries] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => getLearnerSessionId());
  const [habits, setHabits] = useState<HabitSummary | null>(null);

  useEffect(() => {
    void fetchHabits();
    return subscribeHabits(setHabits);
  }, []);

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

  const speakIfAutoPlay = (text: string) => {
    if (!devSettings.autoPlayAudio) return;
    speechService.speakSmart(text, {
      provider: devSettings.voiceProvider,
      voiceName: persona.voiceId,
      gender: persona.voiceGender
    });
  };

  const chat = useTutorChat({
    initialMessages: INITIAL_MESSAGES,
    persona,
    learnerProfile,
    sessionId: activeSessionId,
    temperature: devSettings.temperature,
    grammarStrictness: devSettings.grammarStrictness,
    onQuotaReached: setLimitReached,
    onPremiumRequired: () => {
      setPremiumEnded(true);
      void refreshAccount();
    },
    onUsage: (used) => setUsage('chatMessages', used),
    onReply: speakIfAutoPlay
  });
  const { messages } = chat;
  const { grammarHighlight, talkingShare } = useConversationStats(messages);

  const applySession = (session: ClientLearnerSession) => {
    const tutor = TUTORS.find((t) => t.id === session.personaId) ?? EMMANUELE;
    const profile: LearnerProfile = { name: session.learnerName, level: session.learnerLevel, personaId: tutor.id };
    setLearnerProfile(profile);
    setActiveSessionId(session.sessionId);
    rememberLearnerSessionId(session.sessionId);
    const checkpointMessages = toChatMessages(session.checkpointTurns, tutor.id);
    chat.resetConversation(
      checkpointMessages.length > 0
        ? checkpointMessages
        : createInitialMessages(tutor, profile.name, profile.level, session.topic)
    );
    setSavedPhrases(session.progress.savedPhrases);
    if (GRAMMAR_STRICTNESS.includes(session.grammarStrictness as DevSettings['grammarStrictness'])) {
      setDevSettings((prev) => ({ ...prev, grammarStrictness: session.grammarStrictness as DevSettings['grammarStrictness'] }));
    }
  };

  const handleSignedIn = async (mode: SignInMode) => {
    const updatedMe = await refreshAccount();
    const session = await loadLearnerSession();
    if (session) {
      applySession(session);
    }
    const startSession = flow.afterSignIn({
      mode,
      hasSession: Boolean(session),
      isPremium: updatedMe?.tier === 'premium',
      billingAvailable: getBilling().isAvailable()
    });
    if (startSession && learnerProfile) {
      void startLearnerSession({ profile: learnerProfile, grammarStrictness: devSettings.grammarStrictness, savedPhrases });
    }
  };

  // Start over as a new guest: blank profile, conversation and notebook, back to onboarding,
  // where the guest is offered sign-in again after finishing it
  const resetToGuest = () => {
    setIsAccountMenuOpen(false);
    setIsCallOpen(false);
    setIsProfileModalOpen(false);
    setLearnerProfile(null);
    setActiveSessionId(null);
    chat.resetConversation(INITIAL_MESSAGES);
    chat.setDraft('');
    setSavedPhrases(INITIAL_SAVED_PHRASES);
    setLimitReached(null);
    setPremiumEnded(false);
    flow.clearTutorSelection();
    void refreshAccount();
    setScreen('onboarding');
  };

  // The account was deleted in another tab or on another device: sign this tab out too.
  // Also surface a notice if App Check rejects a request.
  useEffect(() => {
    setAccountDeletedHandler(() => {
      signOutToGuest()
        .catch((err: unknown) => console.warn('[Account] Sign out after deletion failed:', err))
        .finally(() => {
          resetToGuest();
          showNotice(ACCOUNT_DELETED_NOTICE);
        });
    });
    setAppCheckFailedHandler(() => {
      showNotice(APP_CHECK_FAILED_NOTICE);
    });
    return () => {
      setAccountDeletedHandler(null);
      setAppCheckFailedHandler(null);
    };
  }, []);

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

  // Show the Premium-ended notice on load if the active tutor is premium while the user is not,
  // and clear it once the learner re-subscribes or switches to a free tutor.
  useEffect(() => {
    if (!learnerProfile || screen !== 'app') return;
    if (isTutorLockedForTier(persona, me?.tier)) {
      setPremiumEnded(true);
    } else if (!persona.isPremium || me?.tier === 'premium') {
      setPremiumEnded(false);
    }
  }, [learnerProfile, screen, persona, me?.tier]);

  const updateSavedPhrases = (next: SavedPhrase[]) => {
    setSavedPhrases(next);
    if (learnerProfile) {
      void saveLearnerSettings({ profile: learnerProfile, grammarStrictness: devSettings.grammarStrictness, savedPhrases: next });
    }
  };

  const handleCompleteOnboarding = (profile: LearnerProfile, consent?: Consent, habitGoal?: HabitGoal) => {
    if (habitGoal) {
      void updateHabitSettings({ goal: habitGoal });
    }
    const selectedTutor = TUTORS.find((t) => t.id === profile.personaId) ?? EMMANUELE;
    const isFirstOnboarding = learnerProfile === null;
    if (consent) setConsent(consent);
    setLearnerProfile(profile);
    flow.clearTutorSelection();
    chat.resetConversation(createInitialMessages(selectedTutor, profile.name, profile.level));
    void startLearnerSession({ profile, grammarStrictness: devSettings.grammarStrictness, savedPhrases });
    closeScreen('onboarding');
    if (me?.isAnonymous && isFirstOnboarding) {
      setScreen('signin-after-onboarding');
    } else {
      setScreen('app');
    }
  };

  const handleSavePhrase = (message: ChatMessage) => {
    updateSavedPhrases(
      savedPhrases.some(p => p.id === message.id)
        ? savedPhrases.filter(p => p.id !== message.id)
        : [{ id: message.id, it: message.text, en: message.translation }, ...savedPhrases]
    );
  };

  const handleContinueWithEmmanuele = () => {
    const nextProfile: LearnerProfile = {
      name: learnerProfile?.name ?? '',
      level: learnerProfile?.level ?? 'A2',
      personaId: EMMANUELE.id
    };
    setPremiumEnded(false);
    setLimitReached(null);
    setLearnerProfile(nextProfile);
    chat.resetConversation(createInitialMessages(EMMANUELE, nextProfile.name, nextProfile.level));
    setDevSettings((prev) => ({ ...prev, voiceId: EMMANUELE.voiceId }));
    void startLearnerSession({
      profile: nextProfile,
      grammarStrictness: devSettings.grammarStrictness,
      savedPhrases
    });
  };

  const handleSelectTutor = (nextTutor: Persona) => {
    if (learnerProfile?.personaId === nextTutor.id) {
      selectTab('chat');
      return;
    }
    const nextProfile: LearnerProfile = {
      name: learnerProfile?.name ?? '',
      level: learnerProfile?.level ?? 'A2',
      personaId: nextTutor.id
    };
    setLearnerProfile(nextProfile);
    chat.resetConversation(createInitialMessages(nextTutor, nextProfile.name, nextProfile.level));
    setDevSettings((prev) => ({ ...prev, voiceId: nextTutor.voiceId }));
    void startLearnerSession({
      profile: nextProfile,
      grammarStrictness: devSettings.grammarStrictness,
      savedPhrases
    });
    selectTab('chat');
  };

  const startCall = async () => {
    const m = await refreshAccount();
    if (isTutorLockedForTier(persona, m?.tier ?? me?.tier)) {
      setPremiumEnded(true);
      return;
    }
    if (m && m.usage.voiceSeconds >= m.limits.voiceSeconds) {
      setLimitReached({
        counter: 'voiceSeconds',
        limit: m.limits.voiceSeconds,
        tier: m.tier,
        resetsAt: m.resetsAt
      });
      pushOverlay('limit-reached-voice', () => setLimitReached(null));
      return;
    }
    setIsCallOpen(true);
    pushOverlay('voice-call', () => setIsCallOpen(false));
  };

  const endCall = () => {
    setIsCallOpen(false);
    closeOverlay('voice-call');
  };

  const openSettings = () => {
    setIsSettingsOpen(true);
    pushOverlay('settings', () => setIsSettingsOpen(false));
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    closeOverlay('settings');
  };

  const openConversations = () => {
    pushScreen('screen:conversations', () => setIsConversationsOpen(false));
    setIsConversationsOpen(true);
    void fetchSessionList().then(setSessionSummaries);
  };

  const closeConversations = () => {
    closeScreen('screen:conversations');
    setIsConversationsOpen(false);
  };

  const openNewConversation = () => {
    pushOverlay('new-conversation', () => setIsNewConversationOpen(false));
    setIsNewConversationOpen(true);
  };

  const closeNewConversation = () => {
    closeOverlay('new-conversation');
    setIsNewConversationOpen(false);
  };

  const handleSelectSession = async (sessionId: string) => {
    const session = await fetchSessionById(sessionId);
    if (session) {
      applySession(session);
      rememberLearnerSessionId(session.sessionId);
    }
    closeConversations();
    selectTab('chat');
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSessionById(sessionId);
    const updated = await fetchSessionList();
    setSessionSummaries(updated);
    const activeId = getLearnerSessionId();
    if (!activeId || activeId === sessionId) {
      if (updated.length > 0) {
        const next = await fetchSessionById(updated[0].sessionId);
        if (next) applySession(next);
      } else if (learnerProfile) {
        void startLearnerSession({ profile: learnerProfile, grammarStrictness: devSettings.grammarStrictness, savedPhrases });
      }
    }
  };

  const handleStartNewConversation = async (personaId: string, topicId: string) => {
    const tutor = TUTORS.find((t) => t.id === personaId) ?? EMMANUELE;
    const nextProfile: LearnerProfile = {
      name: learnerProfile?.name ?? '',
      level: learnerProfile?.level ?? 'A2',
      personaId: tutor.id
    };
    setLearnerProfile(nextProfile);
    const session = await createConversation({
      personaId,
      topic: topicId,
      learnerName: nextProfile.name,
      learnerLevel: nextProfile.level,
      grammarStrictness: devSettings.grammarStrictness,
      savedPhrases
    });
    if (session) {
      applySession(session);
    } else {
      const tempId = `temp_${Date.now()}`;
      setActiveSessionId(tempId);
      rememberLearnerSessionId(tempId);
      chat.resetConversation(createInitialMessages(tutor, nextProfile.name, nextProfile.level, topicId));
    }
    if (isConversationsOpen) closeConversations();
    selectTab('chat');
  };

  const handleSaveHabitGoal = (goal: HabitGoal) => {
    void updateHabitSettings({ goal });
  };

  const handleSaveReminder = (reminder: HabitReminder) => {
    void updateHabitSettings({ reminder });
  };

  const openDevLab = () => {
    closeSettings();
    setIsDevLabOpen(true);
    pushOverlay('dev-lab', () => setIsDevLabOpen(false));
  };

  const closeDevLab = () => {
    setIsDevLabOpen(false);
    closeOverlay('dev-lab');
  };

  const openProfileModal = (targetPersona?: Persona) => {
    setProfileModalPersona(targetPersona ?? persona);
    setIsProfileModalOpen(true);
    pushOverlay('persona-profile', () => setIsProfileModalOpen(false));
  };

  const closeProfileModal = () => {
    setIsProfileModalOpen(false);
    closeOverlay('persona-profile');
  };

  const openAccountMenu = () => {
    setIsAccountMenuOpen(true);
    pushOverlay('account-menu', () => setIsAccountMenuOpen(false));
  };

  const closeAccountMenu = () => {
    setIsAccountMenuOpen(false);
    closeOverlay('account-menu');
  };

  const navigateToPlans = () => {
    pushScreen('plans', () => setScreen('app'));
    setScreen('plans');
  };

  const navigateToSignIn = () => {
    pushScreen('signin-login', () => setScreen('app'));
    setScreen('signin-login');
  };

  const navigateToEditProfile = () => {
    pushScreen('onboarding', () => setScreen('app'));
    setScreen('onboarding');
  };

  const handleSeePlansForTutor = (tutorId: string) => {
    const isGuest = !me || me.isAnonymous;
    if (isGuest) {
      pushScreen('signin-login', () => setScreen('app'));
    } else {
      pushScreen('plans', () => setScreen('app'));
    }
    flow.seePlansForTutor(tutorId, isGuest);
  };

  const panelProps = {
    persona,
    grammarHighlight,
    savedPhrases,
    talkingShare,
    me,
    onSwitchToVoice: startCall,
    onOpenProfile: () => openProfileModal(persona),
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
        onSignedIn={() => {
          closeScreen('signin-login');
          void handleSignedIn('login');
        }}
        onSkip={() => {
          closeScreen('signin-login');
          flow.cancelSignIn();
        }}
      />
    );
  }

  if (screen === 'plans' && me) {
    return (
      <PlansScreen
        me={me}
        onDone={(purchased = false) => {
          closeScreen('plans');
          flow.afterPlans(purchased, me?.tier === 'premium');
        }}
        onNeedSignIn={() => {
          closeScreen('plans');
          navigateToSignIn();
        }}
        refreshAccount={refreshAccount}
      />
    );
  }

  if (screen === 'onboarding' || !learnerProfile) {
    return (
      <OnboardingPage
        initialProfile={learnerProfile}
        initialTutorId={flow.selectedTutorId ?? undefined}
        initialConsentAccepted={hasCurrentConsent}
        tier={me?.tier ?? 'guest'}
        canUpgrade={getBilling().isAvailable()}
        onSeePlans={(tutorId) => handleSeePlansForTutor(tutorId)}
        onComplete={handleCompleteOnboarding}
        onLogin={me?.isAnonymous ? navigateToSignIn : undefined}
      />
    );
  }

  const devLabEnabled = isDevLabEnabled();

  const handleSaveSettings = (updated: DevSettings) => {
    setDevSettings(updated);
    if (learnerProfile && updated.grammarStrictness !== devSettings.grammarStrictness) {
      void saveLearnerSettings({ profile: learnerProfile, grammarStrictness: updated.grammarStrictness, savedPhrases });
    }
  };

  return (
    <div className="h-dvh w-full flex overflow-hidden bg-canvas text-ink">
      <IconRail
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === 'notebook' && window.matchMedia('(min-width: 1024px)').matches && activeTab === 'chat') {
            notebookHeadingRef.current?.focus();
            notebookHeadingRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          } else {
            selectTab(tab);
          }
        }}
        learnerInitial={learnerInitial}
        onOpenSettings={openSettings}
        onOpenAccount={openAccountMenu}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader
          activeTab={activeTab}
          persona={persona}
          learnerInitial={learnerInitial}
          learnerLevel={learnerProfile.level}
          mode={isCallOpen ? 'voice' : 'text'}
          onSelectVoice={startCall}
          onOpenAccount={openAccountMenu}
          onOpenConversations={openConversations}
          habits={habits}
        />

        <div className="flex-1 min-h-0 flex gap-5 lg:pr-5 lg:pb-5">
          {activeTab === 'home' && (
            <div className="flex-1 min-w-0 flex">
              <HomeTab
                learnerProfile={learnerProfile}
                persona={persona}
                messages={messages}
                savedPhrases={savedPhrases}
                talkingShare={talkingShare}
                tier={me?.tier ?? 'guest'}
                canUpgrade={getBilling().isAvailable() && me?.tier !== 'premium'}
                habits={habits}
                onNavigateToChat={() => selectTab('chat')}
                onNavigateToNotebook={() => selectTab('notebook')}
                onStartVoiceCall={() => void startCall()}
                onSelectTutor={handleSelectTutor}
                onSeePlansForTutor={handleSeePlansForTutor}
                onOpenTutorProfile={(t) => openProfileModal(t)}
                onOpenNewConversation={openNewConversation}
                headingRef={homeHeadingRef}
              />
            </div>
          )}

          {activeTab === 'chat' && (
            isConversationsOpen ? (
              <div className="flex-1 min-w-0 flex">
                <ConversationListScreen
                  sessions={sessionSummaries}
                  activeSessionId={activeSessionId}
                  onSelectSession={(id) => void handleSelectSession(id)}
                  onDeleteSession={handleDeleteSession}
                  onOpenNewConversation={openNewConversation}
                  onBack={closeConversations}
                />
              </div>
            ) : (
              <>
                <div id="chat" className={`flex-1 min-w-0 flex ${isComposerFocused ? 'pb-0' : 'pb-16 md:pb-0'}`}>
                  <ChatInterface
                    persona={persona}
                    messages={messages}
                    devSettings={devSettings}
                    savedPhraseIds={savedPhrases.map((p) => p.id)}
                    onSendMessage={chat.sendMessage}
                    onSavePhrase={handleSavePhrase}
                    isAiGenerating={chat.isAiGenerating}
                    draft={chat.draft}
                    onDraftChange={chat.setDraft}
                    failedReply={chat.failedReply}
                    onRetryReply={chat.retryReply}
                    limitReached={limitReached}
                    premiumEnded={premiumEnded}
                    tier={me?.tier ?? 'guest'}
                    canUpgrade={getBilling().isAvailable() && me?.tier !== 'premium'}
                    onSignIn={navigateToSignIn}
                    onSeePlans={() => {
                      if (me?.isAnonymous) navigateToSignIn();
                      else navigateToPlans();
                    }}
                    onContinueWithEmmanuele={handleContinueWithEmmanuele}
                    onComposerFocus={() => setIsComposerFocused(true)}
                    onComposerBlur={() => setIsComposerFocused(false)}
                  />
                </div>

                <div className="hidden lg:block w-[360px] xl:w-[380px] shrink-0">
                  <UtilityPanel {...panelProps} notebookHeadingRef={notebookHeadingRef} />
                </div>
              </>
            )
          )}

          {activeTab === 'notebook' && (
            <div className="flex-1 min-h-0 flex">
              <NotebookTab
                savedPhrases={savedPhrases}
                grammarHighlight={grammarHighlight}
                persona={persona}
                onRemovePhrase={panelProps.onRemovePhrase}
                headingRef={notebookHeadingRef}
              />
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="flex-1 min-h-0 flex">
              <ProfileTab
                learnerProfile={learnerProfile}
                devSettings={devSettings}
                onSaveSettings={handleSaveSettings}
                habits={habits}
                onSaveHabitGoal={handleSaveHabitGoal}
                onSaveReminder={handleSaveReminder}
                onOpenDevLab={devLabEnabled ? openDevLab : undefined}
                me={me}
                onEditProfile={navigateToEditProfile}
                onSignIn={navigateToSignIn}
                onUpgrade={navigateToPlans}
                onSignedOut={resetToGuest}
                onAccountDeleted={resetToGuest}
                headingRef={profileHeadingRef}
              />
            </div>
          )}
        </div>
      </div>

      <BottomTabBar
        activeTab={activeTab}
        onSelectTab={selectTab}
        isHidden={isComposerFocused || isCallOpen}
      />

      {isCallOpen && (
        <VoiceCallModal
          persona={persona}
          devSettings={devSettings}
          learnerProfile={learnerProfile}
          onEndCall={endCall}
          onPremiumRequired={() => {
            setPremiumEnded(true);
            void refreshAccount();
          }}
          onLimitReached={async () => {
            const m = await refreshAccount();
            if (m) {
              setLimitReached({
                counter: 'voiceSeconds',
                limit: m.limits.voiceSeconds,
                tier: m.tier,
                resetsAt: m.resetsAt
              });
              pushOverlay('limit-reached-voice', () => setLimitReached(null));
            }
          }}
        />
      )}

      {limitReached && limitReached.counter === 'voiceSeconds' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeOverlay('limit-reached-voice');
              setLimitReached(null);
            }
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
                closeOverlay('limit-reached-voice');
                setLimitReached(null);
                navigateToSignIn();
              }}
              onSeePlans={() => {
                closeOverlay('limit-reached-voice');
                setLimitReached(null);
                navigateToPlans();
              }}
              onDismiss={() => {
                closeOverlay('limit-reached-voice');
                setLimitReached(null);
              }}
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  closeOverlay('limit-reached-voice');
                  setLimitReached(null);
                }}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-ink-muted hover:text-ink hover:bg-surface-tint transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={closeSettings}
        settings={devSettings}
        onSaveSettings={handleSaveSettings}
        onOpenDevLab={devLabEnabled ? openDevLab : undefined}
      />

      {devLabEnabled && (
        <DevSettingsDrawer
          isOpen={isDevLabOpen}
          onClose={closeDevLab}
          settings={devSettings}
          onSaveSettings={handleSaveSettings}
          activePersonaName={persona.fullName}
        />
      )}

      <PersonaProfileModal
        persona={profileModalPersona}
        isOpen={isProfileModalOpen}
        onClose={closeProfileModal}
        onStartVideoCall={startCall}
      />

      <AccountMenu
        isOpen={isAccountMenuOpen}
        onClose={closeAccountMenu}
        me={me}
        onEditProfile={() => {
          closeAccountMenu();
          navigateToEditProfile();
        }}
        onSignIn={() => {
          closeAccountMenu();
          navigateToSignIn();
        }}
        onUpgrade={() => {
          closeAccountMenu();
          navigateToPlans();
        }}
        onSignedOut={resetToGuest}
        onAccountDeleted={resetToGuest}
      />

      <ConsentDialog isOpen={needsConsent} onAccepted={setConsent} />

      <NewConversationSheet
        isOpen={isNewConversationOpen}
        onClose={closeNewConversation}
        tier={me?.tier ?? 'guest'}
        canUpgrade={getBilling().isAvailable() && me?.tier !== 'premium'}
        onSeePlansForTutor={handleSeePlansForTutor}
        onStartConversation={(personaId, topicId) => void handleStartNewConversation(personaId, topicId)}
      />
    </div>
  );
}
