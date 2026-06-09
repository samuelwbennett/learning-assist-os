/* ============================================================================
 * Learning Assist OS — content script
 * ----------------------------------------------------------------------------
 * Browser overlay that helps students get unstuck without giving the answer.
 *
 * Design goals for this rewrite:
 *   - Shadow DOM isolation (host page CSS cannot break the overlay)
 *   - Real help-ladder gate (must explicitly say "still stuck" to advance)
 *   - SPA-aware: detects problem changes via MutationObserver + history hooks
 *   - Request rate limiting + dedup (protect API spend, prevent spamming)
 *   - Telemetry hooks for every meaningful event
 *   - Accessibility: ARIA roles, keyboard shortcut, focus management
 *   - Universal icon (no English-only label on the launcher)
 *   - Stuck-detection skeleton ready for behavior-aware logic
 *
 * NOTE: Keep this file framework-free. We can introduce Preact later if needed.
 * ==========================================================================*/

(function () {
  'use strict';

  if (window.__LA_LOADED__) return;
  window.__LA_LOADED__ = true;

  // ==========================================================================
  // CONFIG
  // ==========================================================================
  const CONFIG = {
    API_URL: 'https://learning-assist-os.vercel.app/api/assist',
    TELEMETRY_URL: 'https://learning-assist-os.vercel.app/api/telemetry',
    MAX_TEXT_LENGTH: 4000,                // up from 2500 to fit reading passages
    MIN_REQUEST_INTERVAL_MS: 2500,        // soft client-side rate limit
    MAX_REQUESTS_PER_SESSION: 60,
    INACTIVITY_THRESHOLD_MS: 90_000,      // 90s with no host-page interaction
    INACTIVITY_CHECK_INTERVAL_MS: 5000,
    STUCK_PROMPT_COOLDOWN_MS: 120_000,    // don't re-prompt within 2 minutes
    DEBUG: false,
  };

  const COLORS = {
    black: '#0a0a0a',
    softBlack: '#1c1c1e',
    ink: '#111111',
    white: '#ffffff',
    cloud: '#f5f5f7',
    mist: '#fafafa',
    border: 'rgba(0,0,0,0.10)',
    muted: '#737373',
    subtle: '#a1a1a6',
    gold: '#b9975b',
    success: '#34c759',
  };

  const FONT =
    "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', " +
    "'Helvetica Neue', Arial, sans-serif";

  // ==========================================================================
  // STRINGS (i18n)
  // ==========================================================================
  const STRINGS = {
    english: {
      title: 'Learning Assist',
      tagline: 'Get unstuck — without getting the answer.',
      ladderHeading: 'Help ladder',
      english: 'English',
      spanish: 'Español',
      level1Title: 'Nudge',
      level1Sub: 'What is this asking?',
      level2Title: 'Hint',
      level2Sub: 'What strategy could I try?',
      level3Title: 'Explain',
      level3Sub: 'Show me a similar example with different numbers.',
      conceptHeading: 'Concept',
      conceptSummaryTitle: 'Summarize concept',
      conceptSummarySub: 'Explain the topic behind these problems.',
      videoTitle: 'Watch a video',
      videoSub: 'Open a related Khan Academy lesson.',
      videoFinding: 'Finding a related video…',
      videoOpen: 'Open Khan Academy',
      videoFoundIntro: 'Found a Khan Academy lesson on:',
      videoNotFound: "I couldn't find a clear topic for a video.",
      ratingPrompt: 'Was that helpful?',
      ratingThanks: 'Thanks!',
      ratingThumbsUp: 'Yes, that helped',
      ratingThumbsDown: 'Not really',
      misconceptionsPrompt: "Which of these is closer to what's tricky?",
      misconceptionsLoading: 'Looking for common stuck points…',
      misconceptionsSkip: 'Something else',
      misconceptionsError: "Couldn't get suggestions — try escalating instead.",
      thinking: 'Thinking…',
      stillStuck: 'Still stuck →',
      tryIt: 'I’ll try that',
      gotIt: 'Got it',
      locked: 'Locked',
      open: 'Open',
      stuckPrompt: 'Still on this one?',
      stuckPromptSub: 'Want a small nudge to keep going?',
      stuckYes: 'Yes, nudge me',
      stuckNo: 'No, I’m thinking',
      errorReach: 'Could not reach Learning Assist.',
      errorGeneric: 'Something went wrong.',
      rateLimited: 'Take a breath — try again in a moment.',
      truncatedNotice: 'Long passage — guidance is based on the visible portion.',
      noProblem: 'Highlight the problem you’re working on, then tap me.',
      close: 'Close',
      minimize: 'Minimize',
    },
    spanish: {
      title: 'Asistente de Aprendizaje',
      tagline: 'Avanza — sin recibir la respuesta.',
      ladderHeading: 'Niveles de ayuda',
      english: 'English',
      spanish: 'Español',
      level1Title: 'Pista',
      level1Sub: '¿Qué te pide el problema?',
      level2Title: 'Sugerencia',
      level2Sub: '¿Qué estrategia puedo probar?',
      level3Title: 'Explicación',
      level3Sub: 'Muéstrame un ejemplo similar con otros números.',
      conceptHeading: 'Concepto',
      conceptSummaryTitle: 'Resumir concepto',
      conceptSummarySub: 'Explica el tema detrás de estos problemas.',
      videoTitle: 'Ver un video',
      videoSub: 'Abre una lección relacionada de Khan Academy.',
      videoFinding: 'Buscando un video relacionado…',
      videoOpen: 'Abrir Khan Academy',
      videoFoundIntro: 'Encontré una lección de Khan Academy sobre:',
      videoNotFound: 'No pude identificar un tema claro para un video.',
      ratingPrompt: '¿Te ayudó?',
      ratingThanks: '¡Gracias!',
      ratingThumbsUp: 'Sí, me ayudó',
      ratingThumbsDown: 'No mucho',
      misconceptionsPrompt: '¿Cuál de estas se parece más a lo que te cuesta?',
      misconceptionsLoading: 'Buscando puntos comunes de dificultad…',
      misconceptionsSkip: 'Algo más',
      misconceptionsError: 'No pude obtener sugerencias — intenta escalar.',
      thinking: 'Pensando…',
      stillStuck: 'Sigo atorado →',
      tryIt: 'Voy a intentarlo',
      gotIt: 'Entendido',
      locked: 'Bloqueado',
      open: 'Abrir',
      stuckPrompt: '¿Sigues en este?',
      stuckPromptSub: '¿Quieres una pista pequeña para continuar?',
      stuckYes: 'Sí, dame una pista',
      stuckNo: 'No, sigo pensando',
      errorReach: 'No se pudo conectar.',
      errorGeneric: 'Algo salió mal.',
      rateLimited: 'Espera un momento e intenta de nuevo.',
      truncatedNotice: 'Texto largo — la guía se basa en la parte visible.',
      noProblem: 'Selecciona el problema en el que trabajas y toca el botón.',
      close: 'Cerrar',
      minimize: 'Minimizar',
    },
  };

  const t = (key) => (STRINGS[state.selectedLanguage] || STRINGS.english)[key] || key;

  // ==========================================================================
  // STATE
  // ==========================================================================
  const state = {
    selectedLanguage: 'english',
    highestUnlockedLevel: 1,
    lastLevelShown: null,
    problemFingerprint: '',
    requestInFlight: false,
    lastRequestTime: 0,
    sessionRequestCount: 0,
    lastInteractionTime: Date.now(),
    lastStuckPromptTime: 0,
    sessionId: generateSessionId(),
    problemEnteredAt: Date.now(),
    attemptsOnProblem: 0,
    student: null,   // { id, name, gradeLevel, language } — set on first run
    profile: null,   // rolling behavior summary (see makeEmptyProfile)
  };

  function generateSessionId() {
    return 'la_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ==========================================================================
  // STUDENT PROFILE
  // ----------------------------------------------------------------------------
  // V1 personalization: per-device student identity + rolling behavior summary
  // stored in chrome.storage.local. The summary travels with each /api/assist
  // request so the server can shape the system prompt per student.
  //
  // No server-side database needed for V1. When we provision Vercel KV later,
  // the same shape moves server-side; the client just sends studentId and the
  // server reads the profile from KV.
  // ==========================================================================

  const PROFILE_STORAGE_KEY = 'la_student_profile_v1';
  const STUDENT_STORAGE_KEY = 'la_student_identity_v1';
  const PROFILE_RECENT_LIMIT = 20;
  const PROFILE_TOPICS_LIMIT = 8;

  function makeEmptyProfile() {
    return {
      // Rolling counts of help types used (last ~7 days, decay applied lazily)
      helpUsage: { nudge: 0, hint: 0, worked_example: 0, concept_summary: 0, video_topic: 0 },
      // Recent help-level escalations (e.g., {from:1,to:2,ts})
      recentEscalations: [],
      // Last few topics extracted from video_topic or worked_example calls
      recentTopics: [],
      // Outcome ratings (we'll wire these up next)
      thumbsUp: 0,
      thumbsDown: 0,
      // Total problems seen (distinct problemKey count)
      problemsSeen: 0,
      // Distinct problem fingerprints we've already counted (size-capped)
      _seenFingerprints: [],
      lastUpdated: Date.now(),
      version: 1,
    };
  }

  function chromeStorageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (_) { resolve({}); }
    });
  }
  function chromeStorageSet(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve(true));
      } catch (_) { resolve(false); }
    });
  }

  async function loadStudent() {
    const data = await chromeStorageGet([STUDENT_STORAGE_KEY, PROFILE_STORAGE_KEY]);
    state.student = data[STUDENT_STORAGE_KEY] || null;
    state.profile = data[PROFILE_STORAGE_KEY] || makeEmptyProfile();
    if (state.student && state.student.language) {
      state.selectedLanguage = state.student.language;
    }
  }

  async function saveStudent(student) {
    state.student = student;
    await chromeStorageSet({ [STUDENT_STORAGE_KEY]: student });
  }

  async function saveProfile() {
    state.profile.lastUpdated = Date.now();
    await chromeStorageSet({ [PROFILE_STORAGE_KEY]: state.profile });
  }

  // Update the profile when the student does something meaningful. Keep this
  // tight — too many counters become noise. Each `kind` corresponds to a
  // distinct behavioral signal worth shaping the prompt around.
  async function updateProfile(kind, payload) {
    if (!state.profile) state.profile = makeEmptyProfile();
    const p = state.profile;

    if (kind === 'help_used' && payload && payload.requestType) {
      const t = payload.requestType;
      p.helpUsage[t] = (p.helpUsage[t] || 0) + 1;
    }
    if (kind === 'escalated' && payload) {
      p.recentEscalations.unshift({ from: payload.fromLevel, to: payload.toLevel, ts: Date.now() });
      if (p.recentEscalations.length > PROFILE_RECENT_LIMIT) {
        p.recentEscalations.length = PROFILE_RECENT_LIMIT;
      }
    }
    if (kind === 'topic' && payload && payload.topic) {
      // Dedupe and prepend most-recent
      const existing = p.recentTopics.filter((tt) => tt !== payload.topic);
      p.recentTopics = [payload.topic, ...existing].slice(0, PROFILE_TOPICS_LIMIT);
    }
    if (kind === 'rating' && payload) {
      if (payload.value === 'up') p.thumbsUp += 1;
      if (payload.value === 'down') p.thumbsDown += 1;
    }
    if (kind === 'problem_seen' && payload && payload.fingerprint) {
      const seen = p._seenFingerprints || [];
      if (!seen.includes(payload.fingerprint)) {
        seen.unshift(payload.fingerprint);
        if (seen.length > 200) seen.length = 200;
        p._seenFingerprints = seen;
        p.problemsSeen = seen.length;
      }
    }

    await saveProfile();
  }

  // Build the JSON blob we ship to the server for prompt personalization.
  // Strip internal fields and include a few derived metrics the prompt can use.
  function buildProfileForRequest() {
    if (!state.profile) return null;
    const p = state.profile;
    const totalEsc = p.recentEscalations.length;
    const avgEscalationDepth = totalEsc > 0
      ? +(p.recentEscalations.reduce((a, e) => a + (e.to || 0), 0) / totalEsc).toFixed(2)
      : null;

    return {
      helpUsage: p.helpUsage,
      avgEscalationDepth,
      recentTopics: p.recentTopics,
      problemsSeen: p.problemsSeen,
      thumbsUp: p.thumbsUp,
      thumbsDown: p.thumbsDown,
    };
  }

  function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
  }

  // ==========================================================================
  // TELEMETRY (fire-and-forget, beacon-based)
  // ==========================================================================
  function track(event, props) {
    const payload = {
      event,
      sessionId: state.sessionId,
      ts: Date.now(),
      host: location.hostname,
      path: location.pathname,
      problemKey: state.problemFingerprint,
      lang: state.selectedLanguage,
      ...(props || {}),
    };
    // Use fetch + keepalive instead of navigator.sendBeacon. sendBeacon hardcodes
    // credentials: 'include', which forces the server to send
    // Access-Control-Allow-Credentials: true and a specific (non-*) origin.
    // We don't need cookies for telemetry, so we send credentials: 'omit' to
    // avoid that whole CORS handshake. keepalive: true preserves sendBeacon's
    // "request keeps running even if the page unloads" behavior.
    try {
      fetch(CONFIG.TELEMETRY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
        keepalive: true,
        mode: 'cors',
      }).catch(() => { /* fire-and-forget */ });
    } catch (_) { /* telemetry must never break the product */ }
    if (CONFIG.DEBUG) console.log('[LA]', event, payload);
  }

  // ==========================================================================
  // TEXT EXTRACTION + MATH CLEANING
  // ==========================================================================
  function cleanMath(text) {
    return String(text)
      .replace(/\\\(/g, '').replace(/\\\)/g, '')
      .replace(/\\\[/g, '').replace(/\\\]/g, '')
      .replace(/\\times/g, '×')
      .replace(/\\div/g, '÷')
      .replace(/\\cdot/g, '·')
      .replace(/\\pm/g, '±')
      .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
      .replace(/\\text\{([^{}]+)\}/g, '$1')
      .replace(/\\mathrm\{([^{}]+)\}/g, '$1')
      .replace(/\\left/g, '').replace(/\\right/g, '')
      .replace(/\\[,;:!]/g, ' ')
      .replace(/\\\\/g, ' ')
      .replace(/\{([^{}]+)\}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getProblemText() {
    // Prefer user selection if it looks substantive.
    const sel = (window.getSelection && window.getSelection().toString().trim()) || '';
    if (sel.length >= 20) {
      return {
        text: cleanMath(sel.slice(0, CONFIG.MAX_TEXT_LENGTH)),
        truncated: sel.length > CONFIG.MAX_TEXT_LENGTH,
        source: 'selection',
      };
    }

    // Otherwise, try platform-specific extraction.
    const adapted = extractByAdapter();
    if (adapted && adapted.length >= 20) {
      return {
        text: cleanMath(adapted.slice(0, CONFIG.MAX_TEXT_LENGTH)),
        truncated: adapted.length > CONFIG.MAX_TEXT_LENGTH,
        source: 'adapter',
      };
    }

    // Last resort: visible body text.
    const body = (document.body.innerText || '').trim();
    return {
      text: cleanMath(body.slice(0, CONFIG.MAX_TEXT_LENGTH)),
      truncated: body.length > CONFIG.MAX_TEXT_LENGTH,
      source: 'body',
    };
  }

  // Per-platform problem extractors. Add more adapters here as you support
  // additional LMS surfaces. Returning null falls through to the next strategy.
  function extractByAdapter() {
    const host = location.hostname;
    try {
      if (host.includes('mathacademy.com')) {
        const node =
          document.querySelector('[data-test="problem-prompt"]') ||
          document.querySelector('.problem-content') ||
          document.querySelector('[class*="Problem"]');
        return node ? node.innerText : null;
      }
      if (host.includes('khanacademy.org')) {
        const node =
          document.querySelector('[data-test-id="exercise-question-renderer"]') ||
          document.querySelector('.paragraph') ||
          document.querySelector('article');
        return node ? node.innerText : null;
      }
      if (host.includes('canvas') || host.includes('instructure.com')) {
        const node =
          document.querySelector('.question_text') ||
          document.querySelector('#questions') ||
          document.querySelector('.assignment-description');
        return node ? node.innerText : null;
      }
      if (host.includes('schoology.com')) {
        const node =
          document.querySelector('.question-content') ||
          document.querySelector('.assessment-question');
        return node ? node.innerText : null;
      }
    } catch (_) { /* fall through */ }
    return null;
  }

  // ==========================================================================
  // PROBLEM CHANGE DETECTION (SPA-aware)
  // ==========================================================================
  function fingerprintProblem() {
    const { text } = getProblemText();
    return djb2(text.slice(0, 600));
  }

  function checkProblemChanged() {
    const fp = fingerprintProblem();
    if (fp && fp !== state.problemFingerprint) {
      const previous = state.problemFingerprint;
      state.problemFingerprint = fp;
      state.highestUnlockedLevel = 1;
      state.lastLevelShown = null;
      state.problemEnteredAt = Date.now();
      state.attemptsOnProblem = 0;
      state.lastInteractionTime = Date.now();
      track('problem_changed', { previous, next: fp });
    }
  }

  function setupSpaNavigationHooks() {
    const fire = () => setTimeout(checkProblemChanged, 300);

    // history.pushState / replaceState don't emit events by default.
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState = function () { _push.apply(this, arguments); fire(); };
    history.replaceState = function () { _replace.apply(this, arguments); fire(); };
    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);

    // Coalesced DOM observer — fires at most every 750ms.
    let scheduled = false;
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; checkProblemChanged(); }, 750);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // ==========================================================================
  // STUCK DETECTION (skeleton — replace with behavior-aware model)
  // ==========================================================================
  function setupStuckDetection() {
    const bumpInteraction = () => { state.lastInteractionTime = Date.now(); };

    // Use capture so we see events even if host page stops propagation.
    window.addEventListener('click', bumpInteraction, { capture: true });
    window.addEventListener('keydown', bumpInteraction, { capture: true });
    window.addEventListener('input', bumpInteraction, { capture: true });
    window.addEventListener('scroll', bumpInteraction, { capture: true, passive: true });

    setInterval(() => {
      const now = Date.now();
      const idleMs = now - state.lastInteractionTime;
      const sinceLastPrompt = now - state.lastStuckPromptTime;
      const isMenuOpen = !!shadow.getElementById('la-menu');
      const isPopupOpen = !!shadow.getElementById('la-popup');

      if (
        idleMs >= CONFIG.INACTIVITY_THRESHOLD_MS &&
        sinceLastPrompt >= CONFIG.STUCK_PROMPT_COOLDOWN_MS &&
        !isMenuOpen &&
        !isPopupOpen &&
        document.visibilityState === 'visible'
      ) {
        showStuckPrompt();
      }
    }, CONFIG.INACTIVITY_CHECK_INTERVAL_MS);
  }

  // ==========================================================================
  // SHADOW DOM ROOT (style isolation from host page)
  // ==========================================================================
  const host = document.createElement('div');
  host.id = 'learning-assist-host';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host, * { box-sizing: border-box; }
    button { font-family: ${FONT}; }
    @keyframes laPulse {
      0%   { box-shadow: 0 0 0 0 rgba(185,151,91,0.40), 0 18px 45px rgba(0,0,0,0.24); }
      70%  { box-shadow: 0 0 0 14px rgba(185,151,91,0),  0 18px 45px rgba(0,0,0,0.24); }
      100% { box-shadow: 0 0 0 0 rgba(185,151,91,0),     0 18px 45px rgba(0,0,0,0.24); }
    }
    @keyframes laFadeUp {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes laShimmer {
      0%   { background-position: -200px 0; }
      100% { background-position: 200px 0; }
    }
    .la-glass {
      background: rgba(255,255,255,0.94);
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border: 1px solid rgba(0,0,0,0.09);
      box-shadow: 0 24px 70px rgba(0,0,0,0.22);
    }
    .la-launcher {
      position: fixed; right: 22px; bottom: 22px;
      width: 64px; height: 64px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.18);
      background: linear-gradient(145deg, ${COLORS.black}, ${COLORS.softBlack});
      color: ${COLORS.white};
      cursor: pointer; pointer-events: auto;
      display: flex; align-items: center; justify-content: center;
      animation: laPulse 2.6s infinite;
      transition: transform 160ms ease, box-shadow 160ms ease;
      box-shadow: 0 18px 45px rgba(0,0,0,0.24);
    }
    .la-launcher:hover { transform: scale(1.06); }
    .la-launcher:focus-visible {
      outline: 2px solid ${COLORS.gold};
      outline-offset: 3px;
    }
    .la-launcher svg { width: 38px; height: 38px; stroke: ${COLORS.white}; }

    .la-menu, .la-popup, .la-toast {
      position: fixed;
      pointer-events: auto;
      font-family: ${FONT};
      color: ${COLORS.ink};
      animation: laFadeUp 180ms ease-out;
      box-sizing: border-box;
    }
    .la-menu { right: 22px; bottom: 96px; width: 360px; border-radius: 28px; padding: 20px; }
    .la-popup {
      right: 22px; top: 92px; width: 430px;
      max-height: 86vh;
      border-radius: 28px;
      overflow-y: auto;
      overflow-x: hidden;
      /* Don't let scrollbars eat into the rounded corners */
      scrollbar-width: thin;
    }
    .la-toast {
      right: 22px; bottom: 96px; width: 320px; border-radius: 22px; padding: 16px 18px;
    }

    .la-h1 { font-size: 19px; font-weight: 700; letter-spacing: -0.02em; color: ${COLORS.black}; margin: 0; }
    .la-sub { font-size: 13px; color: ${COLORS.muted}; margin-top: 4px; line-height: 1.4; }
    .la-section-label {
      font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
      color: ${COLORS.muted}; margin: 14px 2px 9px; font-weight: 700;
    }

    .la-icon-btn {
      border: none; background: ${COLORS.cloud}; color: ${COLORS.muted};
      width: 32px; height: 32px; border-radius: 50%;
      font-size: 18px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .la-icon-btn:hover { background: #ececec; }
    .la-icon-btn:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }

    .la-lang-toggle {
      margin: 17px 0 14px; padding: 4px;
      display: flex; gap: 4px;
      background: ${COLORS.cloud}; border-radius: 999px;
      border: 1px solid rgba(0,0,0,0.06);
    }
    .la-lang-btn {
      flex: 1; padding: 10px 12px; border-radius: 999px;
      border: none; background: transparent; color: ${COLORS.ink};
      font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .la-lang-btn[aria-pressed="true"] { background: ${COLORS.black}; color: ${COLORS.white}; }
    .la-lang-btn:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }

    .la-help-card {
      width: 100%; margin: 8px 0; padding: 14px;
      border-radius: 18px; cursor: pointer;
      border: 1px solid rgba(0,0,0,0.10);
      background: rgba(245,245,247,0.92);
      color: ${COLORS.ink};
      text-align: left;
      transition: all 160ms ease;
      display: flex; align-items: center; gap: 13px;
    }
    .la-help-card:hover:not([disabled]) {
      background: ${COLORS.white};
      transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(0,0,0,0.08);
    }
    .la-help-card:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
    .la-help-card[disabled] { cursor: not-allowed; opacity: 0.55; }
    .la-help-num {
      min-width: 34px; height: 34px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: ${COLORS.black}; color: ${COLORS.white};
      font-size: 12px; font-weight: 700;
    }
    .la-help-card[disabled] .la-help-num { background: #eeeeee; color: #aaa; }
    .la-help-meta { flex: 1; }
    .la-help-title { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; }
    .la-help-subtitle { font-size: 13px; color: ${COLORS.muted}; margin-top: 3px; line-height: 1.35; }
    .la-help-status {
      font-size: 12px; font-weight: 700; letter-spacing: 0.04em;
      color: ${COLORS.gold};
    }
    .la-help-card[disabled] .la-help-status { color: #aaa; }

    .la-concept-card {
      width: 100%; margin: 4px 0 0;
      padding: 13px 14px;
      border-radius: 16px; cursor: pointer;
      border: 1px dashed rgba(0,0,0,0.18);
      background: transparent;
      color: ${COLORS.ink};
      text-align: left;
      transition: all 160ms ease;
      display: flex; align-items: center; gap: 12px;
    }
    .la-concept-card:hover {
      background: ${COLORS.cloud};
      border-style: solid;
      transform: translateY(-1px);
    }
    .la-concept-card:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
    .la-concept-icon {
      min-width: 32px; height: 32px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: ${COLORS.cloud};
      color: ${COLORS.ink};
    }
    .la-concept-icon svg { width: 16px; height: 16px; }
    .la-concept-meta { flex: 1; }
    .la-concept-title { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
    .la-concept-subtitle { font-size: 12px; color: ${COLORS.muted}; margin-top: 2px; line-height: 1.35; }

    .la-popup-header {
      padding: 17px 18px 15px;
      display: flex; justify-content: space-between; align-items: center;
      cursor: move;
      border-bottom: 1px solid rgba(0,0,0,0.08);
    }
    .la-popup-content {
      padding: 18px;
      line-height: 1.55; font-size: 16px;
      letter-spacing: -0.005em;
      color: ${COLORS.ink};
    }
    .la-popup-content p { margin: 0 0 10px; }
    .la-popup-actions {
      display: flex; gap: 8px;
      padding: 14px 18px 18px;
      border-top: 1px solid rgba(0,0,0,0.06);
      background: ${COLORS.mist};
    }
    .la-action {
      flex: 1; padding: 12px 14px;
      border-radius: 14px; border: 1px solid rgba(0,0,0,0.08);
      background: ${COLORS.white}; color: ${COLORS.ink};
      font-weight: 650; font-size: 14px;
      cursor: pointer;
    }
    .la-action.primary { background: ${COLORS.black}; color: ${COLORS.white}; border-color: ${COLORS.black}; }
    .la-action:hover { filter: brightness(0.96); }
    .la-action:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }

    .la-truncated {
      font-size: 12px; color: ${COLORS.muted};
      padding: 8px 12px; margin: 0 0 12px;
      background: ${COLORS.cloud};
      border-radius: 10px;
    }

    .la-svg-container {
      margin: 14px auto;
      padding: 12px;
      max-width: 280px;
      background: ${COLORS.white};
      border: 1px solid rgba(0,0,0,0.06);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .la-svg-container svg {
      max-width: 100%;
      height: auto;
      display: block;
    }

    .la-misconceptions {
      padding: 14px 16px;
      border-top: 1px solid rgba(0,0,0,0.06);
      background: ${COLORS.mist};
    }
    .la-misconceptions-prompt {
      font-size: 13px;
      font-weight: 650;
      color: ${COLORS.ink};
      margin: 0 0 10px;
      letter-spacing: -0.01em;
    }
    .la-misconception-btn {
      display: block;
      width: 100%;
      padding: 11px 14px;
      margin-bottom: 6px;
      border-radius: 12px;
      border: 1px solid rgba(0,0,0,0.10);
      background: ${COLORS.white};
      color: ${COLORS.ink};
      font-family: ${FONT};
      font-size: 14px;
      text-align: left;
      cursor: pointer;
      transition: transform 160ms ease, background 160ms ease,
                  border-color 160ms ease, box-shadow 160ms ease;
    }
    .la-misconception-btn:hover {
      background: ${COLORS.white};
      border-color: ${COLORS.gold};
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(0,0,0,0.06);
    }
    .la-misconception-btn:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
    .la-misconception-btn[disabled] { opacity: 0.55; cursor: default; }
    .la-misconception-btn.la-misconception-skip {
      font-style: italic;
      color: ${COLORS.muted};
      border-style: dashed;
      background: transparent;
      margin-top: 4px;
    }
    .la-misconceptions-loading {
      font-size: 13px;
      color: ${COLORS.muted};
      padding: 6px 0 2px;
    }

    .la-rating-row {
      display: flex; align-items: center; justify-content: center;
      gap: 12px; padding: 11px 14px;
      border-top: 1px solid rgba(0,0,0,0.06);
      font-size: 13px; color: ${COLORS.muted};
    }
    .la-rating-prompt { font-weight: 600; letter-spacing: -0.01em; }
    .la-rating-btn {
      border: 1px solid rgba(0,0,0,0.10);
      background: ${COLORS.white};
      border-radius: 999px;
      width: 38px; height: 38px;
      cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      color: ${COLORS.ink};
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease;
    }
    .la-rating-btn:hover:not([disabled]) {
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(0,0,0,0.06);
    }
    .la-rating-btn:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
    .la-rating-btn[disabled] { cursor: default; }
    .la-rating-btn.la-selected-up {
      background: #e8f7ee; border-color: ${COLORS.success}; color: ${COLORS.success};
    }
    .la-rating-btn.la-selected-down {
      background: #fdeeee; border-color: #e26b6b; color: #c54343;
    }
    .la-rating-btn.la-faded { opacity: 0.4; }
    .la-rating-btn svg { width: 18px; height: 18px; }

    .la-debug {
      margin-top: 16px; padding: 12px;
      border-radius: 12px;
      background: #fff7ec; border: 1px solid #f0d9a8;
      font-size: 12px; color: #5b4421;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .la-debug-title {
      font-weight: 700; color: #8a6a1f;
      letter-spacing: 0.06em; text-transform: uppercase;
      font-size: 10px; margin-bottom: 8px;
    }
    .la-debug-row { margin: 4px 0; word-break: break-word; }
    .la-debug-preview {
      margin-top: 6px; padding: 8px 10px;
      background: #fff; border-radius: 8px;
      border: 1px solid #e8d6a8;
      white-space: pre-wrap;
      max-height: 220px; overflow-y: auto;
      font-size: 11.5px; line-height: 1.5;
    }

    .la-skeleton {
      height: 14px; border-radius: 7px;
      background: linear-gradient(90deg, #eee 25%, #f5f5f7 37%, #eee 63%);
      background-size: 400px 100%;
      animation: laShimmer 1.4s infinite linear;
      margin-bottom: 10px;
    }
    .la-skeleton:nth-child(2) { width: 92%; }
    .la-skeleton:nth-child(3) { width: 78%; }

    .la-toast-title { font-size: 15px; font-weight: 700; color: ${COLORS.black}; }
    .la-toast-sub { font-size: 13px; color: ${COLORS.muted}; margin-top: 2px; }
    .la-toast-actions { display: flex; gap: 8px; margin-top: 12px; }

    .la-sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0;
      margin: -1px; overflow: hidden; clip: rect(0,0,0,0);
      white-space: nowrap; border: 0;
    }
  `;
  shadow.appendChild(styleEl);

  // ==========================================================================
  // LAUNCHER
  // ==========================================================================
  const launcher = document.createElement('button');
  launcher.className = 'la-launcher';
  launcher.id = 'la-launcher';
  launcher.setAttribute('aria-label', 'Open Learning Assist');
  launcher.setAttribute('title', 'Learning Assist  ·  Ctrl/Cmd + Shift + H');
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.6 8.6a3.4 3.4 0 0 1 6.6.95c0 1.75-1.35 2.45-2.4 3.15-.95.65-1.15 1.25-1.15 2.3"
            stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="18.4" r="1.15" fill="currentColor"/>
    </svg>
  `;
  shadow.appendChild(launcher);

  launcher.addEventListener('click', () => {
    track('launcher_clicked');
    toggleMenu();
  });

  // Keyboard shortcut: Ctrl/Cmd + Shift + H
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault();
      track('launcher_shortcut');
      toggleMenu();
    }
  });

  // ==========================================================================
  // MENU (help ladder)
  // ==========================================================================
  function toggleMenu() {
    // If a setup card is already open, just close it.
    const setupOpen = shadow.getElementById('la-setup');
    if (setupOpen) { setupOpen.remove(); return; }
    const existing = shadow.getElementById('la-menu');
    if (existing) { existing.remove(); return; }
    // First-run gate: if no student identity yet, walk the teacher through it
    // before any help is available.
    if (!state.student) {
      showStudentSetup();
      return;
    }
    showMenu();
  }

  function showMenu() {
    const old = shadow.getElementById('la-menu');
    if (old) old.remove();

    const menu = document.createElement('div');
    menu.className = 'la-menu la-glass';
    menu.id = 'la-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', t('title'));

    menu.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <h2 class="la-h1">${escapeHtml(t('title'))}</h2>
          <div class="la-sub">${escapeHtml(t('tagline'))}</div>
        </div>
        <button class="la-icon-btn" id="la-close-menu" aria-label="${escapeHtml(t('close'))}">×</button>
      </div>

      <div class="la-lang-toggle" role="group" aria-label="Language">
        <button class="la-lang-btn" id="la-en"
          aria-pressed="${state.selectedLanguage === 'english'}">${escapeHtml(t('english'))}</button>
        <button class="la-lang-btn" id="la-es"
          aria-pressed="${state.selectedLanguage === 'spanish'}">${escapeHtml(t('spanish'))}</button>
      </div>

      <div class="la-section-label">${escapeHtml(t('ladderHeading'))}</div>
      ${helpCard(1, '01', t('level1Title'), t('level1Sub'))}
      ${helpCard(2, '02', t('level2Title'), t('level2Sub'))}
      ${helpCard(3, '03', t('level3Title'), t('level3Sub'))}

      <div class="la-section-label">${escapeHtml(t('conceptHeading'))}</div>
      <button class="la-concept-card" id="la-concept">
        <span class="la-concept-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 5h16M4 12h16M4 19h10"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="la-concept-meta">
          <span class="la-concept-title">${escapeHtml(t('conceptSummaryTitle'))}</span>
          <span class="la-concept-subtitle">${escapeHtml(t('conceptSummarySub'))}</span>
        </span>
      </button>
      <button class="la-concept-card" id="la-video">
        <span class="la-concept-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <polygon points="9,6 19,12 9,18" fill="currentColor"/>
          </svg>
        </span>
        <span class="la-concept-meta">
          <span class="la-concept-title">${escapeHtml(t('videoTitle'))}</span>
          <span class="la-concept-subtitle">${escapeHtml(t('videoSub'))}</span>
        </span>
      </button>
    `;
    shadow.appendChild(menu);

    shadow.getElementById('la-close-menu').addEventListener('click', () => menu.remove());
    shadow.getElementById('la-en').addEventListener('click', () => setLanguage('english'));
    shadow.getElementById('la-es').addEventListener('click', () => setLanguage('spanish'));

    shadow.querySelectorAll('.la-help-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const level = Number(btn.dataset.level);
        if (level > state.highestUnlockedLevel) return;
        menu.remove();
        requestAssist(level);
      });
    });

    shadow.getElementById('la-concept').addEventListener('click', () => {
      menu.remove();
      requestConceptSummary();
    });

    shadow.getElementById('la-video').addEventListener('click', () => {
      menu.remove();
      requestVideoTopic();
    });

    // Focus management for keyboard users
    const firstFocusable = shadow.getElementById('la-en');
    if (firstFocusable) firstFocusable.focus();
  }

  function helpCard(level, num, title, subtitle) {
    const locked = level > state.highestUnlockedLevel;
    return `
      <button class="la-help-card" data-level="${level}" ${locked ? 'disabled aria-disabled="true"' : ''}>
        <span class="la-help-num">${num}</span>
        <span class="la-help-meta">
          <span class="la-help-title">${escapeHtml(title)}</span>
          <span class="la-help-subtitle">${escapeHtml(subtitle)}</span>
        </span>
        <span class="la-help-status">${locked ? escapeHtml(t('locked')) : escapeHtml(t('open'))}</span>
      </button>
    `;
  }

  function setLanguage(lang) {
    state.selectedLanguage = lang;
    track('language_changed', { lang });
    showMenu();
  }

  // ==========================================================================
  // FIRST-RUN SETUP (sets the student profile for this device)
  // ----------------------------------------------------------------------------
  // Shown once on a fresh install. The teacher (or student under teacher
  // supervision) types in the student's first name, grade level, and preferred
  // language. Stored in chrome.storage.local. Can be edited later via the
  // "Sign in" link inside the menu (TODO: add edit affordance later).
  // ==========================================================================
  function showStudentSetup() {
    const old = shadow.getElementById('la-menu') || shadow.getElementById('la-setup');
    if (old) old.remove();

    const card = document.createElement('div');
    card.className = 'la-menu la-glass';
    card.id = 'la-setup';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Student setup');
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <h2 class="la-h1">Who's using this device?</h2>
          <div class="la-sub">One-time setup. Helps me give better hints.</div>
        </div>
      </div>

      <div style="margin-top:16px;">
        <label style="display:block;font-size:12px;color:${COLORS.muted};letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">First name</label>
        <input id="la-setup-name" type="text" maxlength="40" autocomplete="off"
          style="width:100%;padding:11px 12px;border-radius:12px;border:1px solid ${COLORS.border};background:${COLORS.cloud};font-size:15px;font-family:${FONT};outline:none;"
          placeholder="e.g. Isaac" />
      </div>

      <div style="margin-top:14px;">
        <label style="display:block;font-size:12px;color:${COLORS.muted};letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">Grade</label>
        <select id="la-setup-grade"
          style="width:100%;padding:11px 12px;border-radius:12px;border:1px solid ${COLORS.border};background:${COLORS.cloud};font-size:15px;font-family:${FONT};outline:none;cursor:pointer;">
          <option value="">Choose grade…</option>
          <option value="K">Kindergarten</option>
          ${[1,2,3,4,5,6,7,8,9,10,11,12].map((g) =>
            `<option value="${g}">Grade ${g}</option>`
          ).join('')}
        </select>
      </div>

      <div style="margin-top:14px;">
        <label style="display:block;font-size:12px;color:${COLORS.muted};letter-spacing:0.06em;text-transform:uppercase;font-weight:700;margin-bottom:6px;">Language / Idioma</label>
        <div class="la-lang-toggle" style="margin:0;">
          <button class="la-lang-btn" id="la-setup-en" aria-pressed="true">English</button>
          <button class="la-lang-btn" id="la-setup-es" aria-pressed="false">Español</button>
        </div>
      </div>

      <div style="margin-top:18px;display:flex;gap:8px;">
        <button class="la-action primary" id="la-setup-save" style="flex:1;">Get started</button>
      </div>
    `;
    shadow.appendChild(card);

    const nameInput = shadow.getElementById('la-setup-name');
    const gradeSelect = shadow.getElementById('la-setup-grade');
    const enBtn = shadow.getElementById('la-setup-en');
    const esBtn = shadow.getElementById('la-setup-es');
    let chosenLang = 'english';

    enBtn.addEventListener('click', () => {
      chosenLang = 'english';
      enBtn.setAttribute('aria-pressed', 'true');
      esBtn.setAttribute('aria-pressed', 'false');
    });
    esBtn.addEventListener('click', () => {
      chosenLang = 'spanish';
      enBtn.setAttribute('aria-pressed', 'false');
      esBtn.setAttribute('aria-pressed', 'true');
    });

    shadow.getElementById('la-setup-save').addEventListener('click', async () => {
      const name = (nameInput.value || '').trim().slice(0, 40);
      const grade = gradeSelect.value || '';
      if (!name || !grade) {
        nameInput.style.borderColor = name ? COLORS.border : '#e26b6b';
        gradeSelect.style.borderColor = grade ? COLORS.border : '#e26b6b';
        return;
      }
      const id = 'stu_' + djb2(name + '|' + grade + '|' + Date.now());
      const student = {
        id,
        name,
        gradeLevel: grade,
        language: chosenLang,
        createdAt: Date.now(),
      };
      await saveStudent(student);
      state.selectedLanguage = chosenLang;
      track('student_setup_completed', {
        gradeLevel: grade,
        language: chosenLang,
      });
      card.remove();
      showMenu();
    });

    setTimeout(() => nameInput.focus(), 60);
  }

  // ==========================================================================
  // POPUP (response display)
  // ==========================================================================
  function showPopup({ html, level, truncated, debugInfo, requestType }) {
    const old = shadow.getElementById('la-popup');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.className = 'la-popup la-glass';
    popup.id = 'la-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', t('title'));

    // Level 3 is now the terminal "Explain" rung. Concept summary and video
    // come in with level === null, so they also show only the "Got it" button.
    const isExplain = typeof level === 'number' && level >= 3;
    const canEscalate = typeof level === 'number' && level >= 1 && level < 3;

    // Show the rating row on real tutoring responses, but NOT on:
    //   - degraded responses (the leak fallback — student didn't get a real hint)
    //   - simple error/info messages (no level, no requestType)
    const isTutoringResponse = (typeof level === 'number') || requestType === 'concept_summary';
    const showRating = isTutoringResponse && !debugInfo;

    popup.innerHTML = `
      <div class="la-popup-header" id="la-popup-header">
        <div>
          <h2 class="la-h1">${escapeHtml(t('title'))}</h2>
          <div class="la-sub">${escapeHtml(t('tagline'))}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="la-icon-btn" id="la-minimize" aria-label="${escapeHtml(t('minimize'))}">–</button>
          <button class="la-icon-btn" id="la-close-popup" aria-label="${escapeHtml(t('close'))}">×</button>
        </div>
      </div>
      <div class="la-popup-content" id="la-content" aria-live="polite">
        ${truncated ? `<div class="la-truncated">${escapeHtml(t('truncatedNotice'))}</div>` : ''}
        ${html}
        ${debugInfo ? `
          <div class="la-debug">
            <div class="la-debug-title">Debug · response was blocked</div>
            <div class="la-debug-row"><strong>tier:</strong> ${escapeHtml(String(debugInfo.tier ?? 'n/a'))}</div>
            <div class="la-debug-row"><strong>reason:</strong> ${escapeHtml(String(debugInfo.reason ?? 'n/a'))}</div>
            ${debugInfo.overlap ? `<div class="la-debug-row"><strong>overlap:</strong> ${escapeHtml(JSON.stringify(debugInfo.overlap))}</div>` : ''}
            <div class="la-debug-row"><strong>model said:</strong></div>
            <div class="la-debug-preview">${escapeHtml(String(debugInfo.responsePreview || '(empty)'))}</div>
          </div>
        ` : ''}
      </div>
      ${showRating ? `
        <div class="la-rating-row" id="la-rating-row">
          <span class="la-rating-prompt" id="la-rating-prompt">${escapeHtml(t('ratingPrompt'))}</span>
          <button class="la-rating-btn" id="la-rating-up" aria-label="${escapeHtml(t('ratingThumbsUp'))}" title="${escapeHtml(t('ratingThumbsUp'))}">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="7" y1="22" x2="7" y2="11"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="la-rating-btn" id="la-rating-down" aria-label="${escapeHtml(t('ratingThumbsDown'))}" title="${escapeHtml(t('ratingThumbsDown'))}">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7L2.34 12.7a2 2 0 0 0 2 2.3z"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="17" y1="2" x2="17" y2="13"
                stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
          </button>
        </div>` : ''}
      ${level ? `
        <div class="la-popup-actions">
          <button class="la-action" id="la-try">
            ${escapeHtml(isExplain ? t('gotIt') : t('tryIt'))}
          </button>
          ${canEscalate ? `<button class="la-action primary" id="la-escalate">
            ${escapeHtml(t('stillStuck'))}
          </button>` : ''}
        </div>` : ''}
    `;
    shadow.appendChild(popup);

    if (showRating) {
      const promptEl = shadow.getElementById('la-rating-prompt');
      const upBtn = shadow.getElementById('la-rating-up');
      const downBtn = shadow.getElementById('la-rating-down');

      const handleRating = (value) => {
        if (upBtn.disabled) return;
        upBtn.disabled = true;
        downBtn.disabled = true;
        if (value === 'up') {
          upBtn.classList.add('la-selected-up');
          downBtn.classList.add('la-faded');
        } else {
          downBtn.classList.add('la-selected-down');
          upBtn.classList.add('la-faded');
        }
        promptEl.textContent = t('ratingThanks');

        track('hint_rated', { value, level, requestType });
        updateProfile('rating', { value });

        // Thumbs-down → kick off the misconceptions diagnostic. The original
        // request's level + requestType are captured in this closure so we
        // can re-fire the same kind of help with refined context.
        if (value === 'down') {
          showMisconceptionsForPopup({ originalLevel: level, originalRequestType: requestType });
        }
      };

      upBtn.addEventListener('click', () => handleRating('up'));
      downBtn.addEventListener('click', () => handleRating('down'));
    }

    makeDraggable(popup, shadow.getElementById('la-popup-header'));

    shadow.getElementById('la-close-popup').addEventListener('click', () => {
      track('popup_closed', { level });
      popup.remove();
    });

    const minBtn = shadow.getElementById('la-minimize');
    minBtn.addEventListener('click', () => {
      const content = shadow.getElementById('la-content');
      const collapsed = content.style.display === 'none';
      content.style.display = collapsed ? 'block' : 'none';
      minBtn.textContent = collapsed ? '–' : '+';
      popup.style.width = collapsed ? '430px' : '300px';
      track('popup_minimized', { collapsed: !collapsed });
    });

    const tryBtn = shadow.getElementById('la-try');
    if (tryBtn) {
      tryBtn.addEventListener('click', () => {
        track('hint_accepted', { level });
        state.attemptsOnProblem += 1;
        state.lastInteractionTime = Date.now(); // they're back at it
        popup.remove();
      });
    }

    const escBtn = shadow.getElementById('la-escalate');
    if (escBtn) {
      escBtn.addEventListener('click', () => {
        track('hint_escalated', { fromLevel: level, toLevel: level + 1 });
        updateProfile('escalated', { fromLevel: level, toLevel: level + 1 });
        // The escalation IS the gate: only here do we unlock the next level.
        state.highestUnlockedLevel = Math.max(state.highestUnlockedLevel, level + 1);
        popup.remove();
        requestAssist(level + 1);
      });
    }
  }

  function showLoadingPopup(level, requestType) {
    const old = shadow.getElementById('la-popup');
    if (old) old.remove();

    const subtitleKey = requestType === 'video_topic' ? 'videoFinding' : 'thinking';

    const popup = document.createElement('div');
    popup.className = 'la-popup la-glass';
    popup.id = 'la-popup';
    popup.setAttribute('role', 'status');
    popup.setAttribute('aria-live', 'polite');
    popup.innerHTML = `
      <div class="la-popup-header">
        <div>
          <h2 class="la-h1">${escapeHtml(t('title'))}</h2>
          <div class="la-sub">${escapeHtml(t(subtitleKey))}</div>
        </div>
      </div>
      <div class="la-popup-content">
        <div class="la-skeleton"></div>
        <div class="la-skeleton"></div>
        <div class="la-skeleton"></div>
      </div>
    `;
    shadow.appendChild(popup);
  }

  function showSimpleMessage(message) {
    showPopup({ html: `<p>${escapeHtml(message)}</p>`, level: null, truncated: false });
  }

  // ==========================================================================
  // MISCONCEPTIONS DIAGNOSTIC
  // ----------------------------------------------------------------------------
  // After 👎 on a hint, fetch 3 problem-specific misconception labels from the
  // server and inject them into the popup as tap-targets. Selecting one re-fires
  // the *same* requestType with the misconception label as studentContext, so
  // the next response is targeted at that specific stuck point.
  // ==========================================================================
  async function showMisconceptionsForPopup({ originalLevel, originalRequestType }) {
    const popup = shadow.getElementById('la-popup');
    if (!popup) return;

    // Drop a loading line in below the rating row so the student knows
    // something is happening. ~1-2s typical latency on gpt-4o-mini.
    let loadingEl = shadow.getElementById('la-misconceptions');
    if (!loadingEl) {
      loadingEl = document.createElement('div');
      loadingEl.id = 'la-misconceptions';
      loadingEl.className = 'la-misconceptions';
      const ratingRow = shadow.getElementById('la-rating-row');
      if (ratingRow && ratingRow.parentNode) {
        ratingRow.parentNode.insertBefore(loadingEl, ratingRow.nextSibling);
      } else {
        popup.appendChild(loadingEl);
      }
    }
    loadingEl.innerHTML = `<div class="la-misconceptions-loading">${escapeHtml(t('misconceptionsLoading'))}</div>`;

    const labels = await fetchMisconceptions();
    if (!labels || labels.length === 0) {
      loadingEl.innerHTML = `<div class="la-misconceptions-loading">${escapeHtml(t('misconceptionsError'))}</div>`;
      track('misconceptions_failed_client');
      return;
    }

    track('misconceptions_shown', { count: labels.length });

    loadingEl.innerHTML = `
      <div class="la-misconceptions-prompt">${escapeHtml(t('misconceptionsPrompt'))}</div>
      ${labels.map((label, i) => `
        <button class="la-misconception-btn" data-idx="${i}" data-label="${escapeHtml(label)}">
          ${escapeHtml(label)}
        </button>
      `).join('')}
      <button class="la-misconception-btn la-misconception-skip" id="la-mc-skip">
        ${escapeHtml(t('misconceptionsSkip'))}
      </button>
    `;

    loadingEl.querySelectorAll('.la-misconception-btn').forEach((btn) => {
      if (btn.classList.contains('la-misconception-skip')) {
        btn.addEventListener('click', () => {
          track('misconception_skipped');
          loadingEl.remove();
        });
        return;
      }
      btn.addEventListener('click', () => {
        const label = btn.dataset.label || btn.textContent.trim();
        const idx = Number(btn.dataset.idx || 0);
        // Visually mark the chosen one and disable the rest
        loadingEl.querySelectorAll('.la-misconception-btn').forEach((b) => { b.disabled = true; });
        btn.style.borderColor = COLORS.gold;
        btn.style.background = '#fff7ec';
        track('misconception_selected', { idx, label });

        // Re-fire the original help request, this time with the misconception
        // label as studentContext. The popup will be replaced by the new
        // response when it lands.
        if (typeof originalLevel === 'number') {
          requestAssist(originalLevel, label);
        } else if (originalRequestType === 'concept_summary') {
          performRequest({ level: null, requestType: 'concept_summary', studentContext: label });
        }
      });
    });
  }

  async function fetchMisconceptions() {
    const { text } = getProblemText();
    if (!text || text.length < 5) return [];

    const studentSnapshot = state.student ? {
      id: state.student.id,
      name: state.student.name,
      gradeLevel: state.student.gradeLevel,
    } : null;

    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          requestType: 'misconceptions',
          language: state.selectedLanguage,
          url: location.hostname,
          path: location.pathname,
          sessionId: state.sessionId,
          problemKey: state.problemFingerprint,
          student: studentSnapshot,
        }),
      });
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.misconceptions) ? data.misconceptions : [];
      return list
        .map((m) => (m && typeof m.label === 'string') ? m.label.trim() : '')
        .filter(Boolean)
        .slice(0, 3);
    } catch (_) {
      return [];
    }
  }

  // ==========================================================================
  // VIDEO POPUP (Khan Academy handoff)
  // ==========================================================================
  // Shows the identified topic and a primary CTA that opens KA in a new tab.
  // window.open() must run inside a real click handler — browsers block
  // window.open() called from async fetch-response handlers as a popup.
  function showVideoPopup({ topic, searchUrl }) {
    const old = shadow.getElementById('la-popup');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.className = 'la-popup la-glass';
    popup.id = 'la-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', t('videoTitle'));

    popup.innerHTML = `
      <div class="la-popup-header" id="la-popup-header">
        <div>
          <h2 class="la-h1">${escapeHtml(t('videoTitle'))}</h2>
          <div class="la-sub">${escapeHtml(t('videoSub'))}</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="la-icon-btn" id="la-close-popup" aria-label="${escapeHtml(t('close'))}">×</button>
        </div>
      </div>
      <div class="la-popup-content" aria-live="polite">
        <p style="margin:0 0 6px;color:${COLORS.muted};font-size:13px;">
          ${escapeHtml(t('videoFoundIntro'))}
        </p>
        <p style="margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em;">
          ${escapeHtml(topic)}
        </p>
      </div>
      <div class="la-popup-actions">
        <button class="la-action" id="la-video-cancel">${escapeHtml(t('close'))}</button>
        <button class="la-action primary" id="la-video-open">
          ${escapeHtml(t('videoOpen'))} →
        </button>
      </div>
    `;
    shadow.appendChild(popup);

    makeDraggable(popup, shadow.getElementById('la-popup-header'));

    shadow.getElementById('la-close-popup').addEventListener('click', () => {
      track('video_dismissed', { topic });
      popup.remove();
    });
    shadow.getElementById('la-video-cancel').addEventListener('click', () => {
      track('video_dismissed', { topic });
      popup.remove();
    });
    shadow.getElementById('la-video-open').addEventListener('click', () => {
      track('video_opened', { topic });
      // Direct user-gesture open avoids popup blockers.
      window.open(searchUrl, '_blank', 'noopener,noreferrer');
      popup.remove();
    });
  }

  // ==========================================================================
  // STUCK PROMPT (proactive nudge)
  // ==========================================================================
  function showStuckPrompt() {
    state.lastStuckPromptTime = Date.now();
    track('stuck_prompt_shown', {
      idleMs: Date.now() - state.lastInteractionTime,
      timeOnProblemMs: Date.now() - state.problemEnteredAt,
    });

    const old = shadow.getElementById('la-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.className = 'la-toast la-glass';
    toast.id = 'la-toast';
    toast.setAttribute('role', 'dialog');
    toast.setAttribute('aria-label', t('stuckPrompt'));
    toast.innerHTML = `
      <div class="la-toast-title">${escapeHtml(t('stuckPrompt'))}</div>
      <div class="la-toast-sub">${escapeHtml(t('stuckPromptSub'))}</div>
      <div class="la-toast-actions">
        <button class="la-action" id="la-stuck-no">${escapeHtml(t('stuckNo'))}</button>
        <button class="la-action primary" id="la-stuck-yes">${escapeHtml(t('stuckYes'))}</button>
      </div>
    `;
    shadow.appendChild(toast);

    shadow.getElementById('la-stuck-no').addEventListener('click', () => {
      track('stuck_prompt_dismissed');
      state.lastInteractionTime = Date.now();
      toast.remove();
    });
    shadow.getElementById('la-stuck-yes').addEventListener('click', () => {
      track('stuck_prompt_accepted');
      toast.remove();
      requestAssist(1);
    });

    setTimeout(() => { if (shadow.getElementById('la-toast') === toast) toast.remove(); }, 20000);
  }

  // ==========================================================================
  // API CALL (rate limited + deduped)
  // ----------------------------------------------------------------------------
  // requestType is the canonical signal to the server prompt. Mapping:
  //   level 1  -> 'nudge'           : clarify what's being asked
  //   level 2  -> 'hint'            : suggest a strategy, no computation
  //   level 3  -> 'worked_example'  : SAME skill as visible problems,
  //                                   DIFFERENT values, full walkthrough
  //   (no level) 'concept_summary'  : explain the topic, problem-agnostic
  //   (no level) 'video_topic'      : extract topic for a Khan Academy search
  //
  // SERVER PROMPT NOTE: the /api/assist route branches on requestType.
  // ==========================================================================
  const REQUEST_TYPE_BY_LEVEL = {
    1: 'nudge',
    2: 'hint',
    3: 'worked_example',
  };

  async function requestAssist(level, studentContext) {
    return performRequest({
      level,
      requestType: REQUEST_TYPE_BY_LEVEL[level] || 'nudge',
      studentContext,
    });
  }

  async function requestConceptSummary() {
    return performRequest({ level: null, requestType: 'concept_summary' });
  }

  async function requestVideoTopic() {
    return performRequest({ level: null, requestType: 'video_topic' });
  }

  async function performRequest({ level, requestType, studentContext }) {
    if (state.requestInFlight) return;

    const now = Date.now();
    if (now - state.lastRequestTime < CONFIG.MIN_REQUEST_INTERVAL_MS) {
      showSimpleMessage(t('rateLimited'));
      return;
    }
    if (state.sessionRequestCount >= CONFIG.MAX_REQUESTS_PER_SESSION) {
      showSimpleMessage(t('rateLimited'));
      return;
    }

    const { text, truncated, source } = getProblemText();
    if (!text || text.length < 10) {
      showSimpleMessage(t('noProblem'));
      track('request_skipped_no_text', { requestType });
      return;
    }

    // Refresh fingerprint in case the SPA observer hasn't fired yet
    const fp = djb2(text.slice(0, 600));
    if (fp !== state.problemFingerprint) {
      state.problemFingerprint = fp;
      state.problemEnteredAt = now;
    }

    state.requestInFlight = true;
    state.lastRequestTime = now;
    state.sessionRequestCount += 1;
    state.lastLevelShown = level;

    showLoadingPopup(level, requestType);
    track('hint_requested', {
      level,
      requestType,
      source,
      textLen: text.length,
      truncated,
      hasContext: !!(studentContext && studentContext.trim()),
    });
    const startTs = now;

    // Snapshot the student profile + identity for this request. Server uses
    // these to personalize the prompt. Profile is null on the very first call
    // before setup is complete (in which case we never reach this path because
    // toggleMenu gates on state.student).
    const studentSnapshot = state.student ? {
      id: state.student.id,
      name: state.student.name,
      gradeLevel: state.student.gradeLevel,
    } : null;
    const profileSnapshot = buildProfileForRequest();

    // Update profile: count distinct problems seen
    if (state.problemFingerprint) {
      updateProfile('problem_seen', { fingerprint: state.problemFingerprint });
    }

    // Optional studentContext now comes from the misconception buttons (after
    // a 👎). Empty / missing → omit from the request.
    const ctx = (studentContext || '').trim().slice(0, 200);

    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          level,
          requestType,
          language: state.selectedLanguage,
          url: location.hostname,
          path: location.pathname,
          sessionId: state.sessionId,
          problemKey: state.problemFingerprint,
          truncated,
          source,
          student: studentSnapshot,
          studentProfile: profileSnapshot,
          studentContext: ctx || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      const latencyMs = Date.now() - startTs;

      if (!res.ok) {
        track('hint_error', { level, requestType, status: res.status, latencyMs });
        showSimpleMessage(cleanMath(data.message || t('errorGeneric')));
        return;
      }

      // video_topic has its own popup shape: a topic + a "Open Khan Academy"
      // button that triggers window.open() inside the click handler (browsers
      // block popups opened from non-user-gesture code paths, so we never auto-open).
      if (requestType === 'video_topic') {
        track('video_topic_received', { latencyMs, topic: data.topic || '', hasUrl: !!data.searchUrl });
        if (data.topic) {
          updateProfile('topic', { topic: data.topic });
        }
        updateProfile('help_used', { requestType });
        if (data.searchUrl && data.topic) {
          showVideoPopup({ topic: data.topic, searchUrl: data.searchUrl });
        } else {
          showSimpleMessage(cleanMath(data.message || t('videoNotFound')));
        }
        return;
      }

      const cleaned = cleanMath(data.message || '');
      const html = renderResponseHtml(cleaned);
      track('hint_received', { level, requestType, latencyMs, replyLen: cleaned.length, degraded: !!data.degraded });
      // Personalization: count this help type for the rolling 7-day usage map.
      // Skip if degraded (the student didn't actually receive a useful hint).
      if (!data.degraded) {
        updateProfile('help_used', { requestType });
      }
      showPopup({
        html,
        level,
        truncated,
        debugInfo: data.degraded ? data._debug : null,
        requestType,
      });
    } catch (err) {
      track('hint_error', { level, requestType, error: String(err) });
      showSimpleMessage(t('errorReach'));
    } finally {
      state.requestInFlight = false;
    }
  }

  function renderResponseHtml(text) {
    // Split the response on <svg>...</svg> blocks. Even-indexed segments are
    // prose (HTML-escaped + paragraph-wrapped); odd-indexed segments are the
    // SVG blocks themselves, which the server has already sanitized via
    // /lib/svg-sanitizer.js. We render those SVG blocks unescaped inside a
    // styled container so they sit cleanly between paragraphs.
    const segments = String(text || '').split(/(<svg\b[\s\S]*?<\/svg\s*>)/gi);

    const html = segments.map((seg, i) => {
      if (i % 2 === 1) {
        // SVG block — trust the server sanitizer.
        return `<div class="la-svg-container">${seg}</div>`;
      }
      // Prose segment.
      const paragraphs = seg
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (paragraphs.length === 0) return '';
      return paragraphs
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
    }).join('');

    return html || `<p>${escapeHtml(text)}</p>`;
  }

  // ==========================================================================
  // DRAGGABLE (scoped, with proper cleanup)
  // ==========================================================================
  function makeDraggable(el, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    function onDown(e) {
      dragging = true;
      const rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    function onMove(e) {
      if (!dragging) return;
      el.style.left = (e.clientX - offsetX) + 'px';
      el.style.top = (e.clientY - offsetY) + 'px';
      el.style.right = 'auto';
    }
    function onUp() {
      dragging = false;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    handle.addEventListener('mousedown', onDown);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ==========================================================================
  // INIT
  // ==========================================================================
  setupSpaNavigationHooks();
  setupStuckDetection();
  state.problemFingerprint = fingerprintProblem();

  // Load the per-device student identity + rolling profile before anything
  // else. This is async but cheap (~5ms from chrome.storage.local).
  loadStudent().then(() => {
    track('extension_loaded', {
      hasStudent: !!state.student,
      gradeLevel: state.student && state.student.gradeLevel,
    });
  });

  // Re-fingerprint after a short delay to catch lazy-loaded problem content.
  setTimeout(checkProblemChanged, 1500);
})();
