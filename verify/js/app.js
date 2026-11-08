/**
 * app.js — the controller: run state, derivation of every check, routing, capture,
 * card actions, install and update flow.
 *
 * Flow of truth: the stored run (core/state.js) holds ONLY the user's answers and
 * captured values. `derive(run)` recomputes every check and the final verdict from those
 * answers on every render (CHECK4-RULE C4-P14: deterministic recomputation; going back
 * and changing an answer always yields the state those answers imply).
 *
 * Network behavior of the whole client (Gates P-03, V-05, O-06):
 *   - same-origin static assets (precached by sw.js), and
 *   - POST /api/v1/record with { network, hash } on the user's explicit "Read the public
 *     record" tap (core/proxy-client.js), and
 *   - GET /api/v1/health once at start, which carries no user data (it tells the UI
 *     whether the proxy serves synthetic review fixtures, so the banner can say so).
 * Nothing else: no analytics, no fonts, no error reporting, no background sync.
 */
import { mount, h } from './ui/dom.js';
import { t, getLanguage } from './i18n/index.js';
import * as screens from './ui/screens.js';
import { classifyAddress, trimDisclosed } from './core/address.js';
import { evaluateCheck1, evaluateCheck2, evaluateCheck3, evaluateCheck4, intendedNetwork } from './core/checks.js';
import { finalFromLookup, V } from './core/record.js';
import { validateHash, parseQr, parseAmount, sameHash, setRecordHash } from './core/txhash.js';
import { NETWORKS, assetSupport } from './core/networks.js';
import { lookupRecord } from './core/proxy-client.js';
import * as store from './core/state.js';
import { buildCardSvg } from './core/card.js';
import { verdictLinks } from './core/content-map.js';
import { scanQr, readPhoto } from './ui/camera.js';
import { formatDate } from './i18n/index.js';

export const APP_VERSION = '0.1.2-phase1-subpath'; // keep in step with sw.js CACHE_VERSION

// ---------------------------------------------------------------------- derivation
/**
 * recordSubject(run) — which payment the Check 5 record is about. Pure.
 *
 * Invariant (CHECK4-RULE C4-P11, Gate C5-03; fix-pass finding B1): the subject is a
 * function of the hash actually being read, never a stored flag. It is 'test' only while
 * the Check 4 answer is TEST_SENT, a test hash was recorded, and the Check 5 hash IS that
 * test hash. Any other hash — typed in Check 5, scanned, pasted, carried from the lite
 * reader, or left behind after the Check 4 test-hash field was edited — is the full
 * payment, so its amount is compared against the intended amount. Deriving it here (and
 * not in an input handler) is what makes the rule hold on every path into Check 5.
 */
export function recordSubject(run) {
  const testHash = String(run.c4.testHash ?? '').trim();
  return run.c4.answer === 'TEST_SENT' && testHash && run.c5.hash && sameHash(run.c5.hash, testHash) ? 'test' : 'full';
}

/**
 * recordReadBlocked(run) — true when the run's intended asset was answered and is
 * outside the supported table (a token, another asset on Bitcoin, another coin, or
 * "I don't know"). SUPPORTED-NETWORKS §4.2 row 4 (frozen, SN-P15): "No proxy call";
 * the final verdict is INCOMPLETE naming the limitation, which derive() below already
 * computes without the record. Fix-pass finding M1, Gate P-03: ctx.lookup makes no
 * request at all in this case, on every trigger path. This is exactly the condition
 * under which derive() discards a lookup, so the verdict cannot change. (A run whose
 * asset question is still unanswered is not this row: there derive() does compare the
 * record, and Check 5 names the asset as missing.)
 */
export function recordReadBlocked(run) {
  return !!(run && run.intent.asset && !assetSupport(run.intent.asset).supported);
}

/** Recomputes all check states and the verdict from stored answers. Pure. */
export function derive(run, lite) {
  const d = {};
  if (run) {
    const asset = run.intent.asset;
    const net = intendedNetwork(asset);
    d.amountInvalid = !!(net && run.intent.amount && parseAmount(run.intent.amount, NETWORKS[net].decimals) === null);
    const classification = run.c2.value ? classifyAddress(run.c2.value) : null;
    d.c1 = evaluateCheck1(run.c1);
    d.c2 = evaluateCheck2({ asset, classification, value: run.c2.value, comparison: run.c2.comparison, readFailed: run.c2.readFailed, qrKind: run.c2.qrKind });
    d.c3 = evaluateCheck3({ asset, check2: d.c2, networkAnswer: run.c3.networkAnswer });
    d.c4 = evaluateCheck4({ entryPath: run.entryPath, alreadySent: run.alreadySent, c1: d.c1.status, c2: d.c2.status, c3: d.c3.status, history: run.c4.history, answer: run.c4.answer });
    d.hashCheck = run.c5.hash && NETWORKS[run.c5.network] ? validateHash(run.c5.network, run.c5.hash) : null;
    d.lookupHash = d.hashCheck && d.hashCheck.ok ? run.c5.hash : null;
    const subject = recordSubject(run); // B1: follows the hash being read (C4-P11, C5-03)
    const amountSrc = subject === 'test' ? run.c4.testAmount : run.intent.amount;
    const intentForRecord = {
      network: net,
      asset: net ? NETWORKS[net].asset : null,
      receivingAddress: classification && classification.valid ? run.c2.value : null,
      amountUnits: net && amountSrc ? parseAmount(amountSrc, NETWORKS[net].decimals) : null,
      sendingAddress: run.c5.sendingAddress || null,
      subject,
    };
    const support = !!net;
    // Unsupported asset: no proxy call; the limitation is the missing item (SN-P15).
    d.final = !support && asset
      ? { verdict: V.INCOMPLETE, cause: asset === 'UNKNOWN' ? 'ASSET_MISSING' : 'UNSUPPORTED', lines: [], mismatched: [], missing: ['record'] }
      : run.c5.network === 'other'
        ? { verdict: V.INCOMPLETE, cause: 'UNSUPPORTED_NETWORK', lines: [], mismatched: [], missing: ['record'] }
        : !run.c5.network
          ? { verdict: V.INCOMPLETE, cause: 'NETWORK_NOT_SELECTED', lines: [], mismatched: [], missing: ['record'] }
          : finalFromLookup(intentForRecord, run.c5.lookup);
    d.final.subject = subject;
    // C4-P10: every flagged check is a visible caution line on the verdict and the card.
    d.cautions = [['1', d.c1], ['2', d.c2], ['3', d.c3], ['4', d.c4]]
      .filter(([, r]) => r.status === 'FLAGGED')
      .map(([n, r]) => t(n === '4' && r.reason === 'DECLINED_TEST' ? 'caution.c4_declined' : 'caution.flagged', { n }));
  }
  if (lite) {
    const net = NETWORKS[lite.network] ? lite.network : null;
    d.liteHashCheck = lite.hash && net ? validateHash(net, lite.hash) : null;
    const liteIntent = {
      network: lite.receivingAddress || lite.amount ? net : null,
      asset: lite.receivingAddress || lite.amount ? (net ? NETWORKS[net].asset : null) : null,
      receivingAddress: lite.receivingAddress || null,
      amountUnits: net && lite.amount ? parseAmount(lite.amount, NETWORKS[net].decimals) : null,
      sendingAddress: lite.sendingAddress || null,
      subject: 'full',
    };
    d.liteFinal = lite.network === 'other'
      ? { verdict: V.INCOMPLETE, cause: 'UNSUPPORTED_NETWORK', lines: [], mismatched: [], missing: ['record'] }
      : finalFromLookup(liteIntent, lite.lookup);
  }
  return d;
}

/** Copy of a run where only the record-input part is replaced (lite <-> run hand-off). */
const emptyLite = () => ({ network: null, hash: '', hashExact: '', receivingAddress: '', receivingExact: '', amount: '', sendingAddress: '', sendingExact: '', lookup: null });

// ---------------------------------------------------------------------- controller
export function createApp(root, env = {}) {
  const ctx = {
    version: APP_VERSION,
    run: null,
    lite: emptyLite(),
    prefs: store.loadPrefs(),
    cards: store.loadCards(),
    savedRun: store.loadRun(),
    screen: 'home',
    busy: false,
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
    cameraMessage: null,
    cardMessage: null,
    canPromptInstall: false,
    fixtureMode: false,
    scriptId: null,
    returnScreen: null,
  };
  let installEvent = null;
  const fetchImpl = env.fetch || globalThis.fetch;

  function persist() { if (ctx.run) store.saveRun(ctx.run); }

  ctx.render = function render() {
    applyPrefs();
    const d = derive(ctx.run, ctx.lite);
    const s = ctx.screen;
    const view = s === 'script' ? screens.scriptView(ctx, ctx.scriptId)
      : s === 'home' || !ctx.run && /^(intent|check\d|verdict)$/.test(s) ? screens.home(ctx)
        : s === 'lite' ? screens.check5Lite(ctx, d)
          : s === 'lite-result' ? screens.verdict(ctx, { ...d, final: d.liteFinal, lookupHash: d.liteHashCheck && d.liteHashCheck.ok ? ctx.lite.hash : null }, { lite: true })
            : s === 'verdict' ? screens.verdict(ctx, d)
              : screens[s](ctx, d);
    mount(root,
      ctx.fixtureMode ? h('p', { class: 'banner', role: 'note' }, t('banner.fixtures')) : null,
      ctx.updateReady ? h('div', { class: 'banner', role: 'status' }, t('update.ready'), h('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => ctx.applyUpdate() } }, t('update.button'))) : null,
      view);
    ctx.lastDerived = d;
    const heading = root.querySelector && root.querySelector('h1, #script-title');
    if (heading && heading.focus && ctx.focusOnRender) { heading.focus(); ctx.focusOnRender = false; }
  };

  function applyPrefs() {
    if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.setAttribute) return;
    document.documentElement.setAttribute('data-text-size', ctx.prefs.textSize);
    document.documentElement.setAttribute('lang', getLanguage());
  }

  ctx.go = (screen) => {
    ctx.cardMessage = null; ctx.cameraMessage = null;
    ctx.screen = screen; ctx.focusOnRender = true;
    if (ctx.run && /^(intent|check\d|verdict)$/.test(screen)) { ctx.run.screen = screen; persist(); }
    ctx.render();
  };
  ctx.update = (fn) => { fn(ctx.run); persist(); ctx.render(); };

  // WP4 entry flow ------------------------------------------------------------------
  ctx.startRun = (path) => {
    ctx.run = store.newRun(path);
    ctx.savedRun = null;
    persist();
    ctx.go('intent');
  };
  ctx.resume = () => { ctx.run = ctx.savedRun; ctx.savedRun = null; ctx.go(ctx.run.screen || 'check1'); };
  ctx.clearRunAndHome = () => {
    store.clearRun(); ctx.run = null; ctx.savedRun = null; ctx.lite = emptyLite();
    ctx.go('home'); ctx.cardMessage = 'run.cleared'; ctx.render();
  };

  // WP6 capture ---------------------------------------------------------------------
  ctx.setDestination = (value, method, qr) => {
    const { exact, trimmed } = trimDisclosed(value);
    ctx.update((r) => {
      Object.assign(r.c2, { exact, value: trimmed, method, comparison: null, readFailed: false, qrKind: qr ? qr.kind : null, qrExtra: qr && qr.extra ? qr.extra : '', qrRaw: qr ? qr.rawText : '' });
      r.c3.networkAnswer = null; r.c3.otherWords = '';
    });
  };
  /** Applies scanned text to the target: c2 address, c5 / lite hash. QR text is data only (SN-P11). */
  function applyScanned(target, text) {
    if (target === 'c2') {
      const qr = parseQr(text);
      if (qr.kind === 'VALUE' || qr.kind === 'BITCOIN_URI' || qr.kind === 'ETHEREUM_URI') ctx.setDestination(qr.value, 'qr', qr);
      else ctx.update((r) => Object.assign(r.c2, { exact: '', value: '', method: 'qr', qrKind: qr.kind, qrRaw: qr.rawText, qrExtra: '', comparison: null }));
    } else {
      // Scanned / pasted hash: exact value kept for disclosure (SN-P18, C2-07); the
      // record subject then follows this hash (recordSubject, B1).
      ctx.updateRecordInput(target === 'c5', (x) => setRecordHash(x, text));
    }
  }
  ctx.scan = async (target) => {
    const video = h('video', { playsinline: true, muted: true, class: 'scanner', 'aria-label': t('camera.preview') });
    const abort = new AbortController();
    mount(root, h('section', { class: 'screen', 'data-screen': 'scanner' },
      h('h1', { tabindex: '-1' }, t('camera.scanning')), video,
      h('button', { type: 'button', class: 'btn btn-secondary', on: { click: () => abort.abort() } }, t('camera.stop'))));
    const res = await scanQr(video, abort.signal);
    ctx.render();
    if (res.ok) applyScanned(target, res.text);
    else { ctx.cameraMessage = `camera.${res.cause}`; if (target === 'c2' && res.cause !== 'ABORTED' && res.cause !== 'DENIED') ctx.update((r) => { r.c2.readFailed = false; }); ctx.render(); }
  };
  ctx.photo = async (target, file, input) => {
    if (!file) return;
    const res = await readPhoto(file);
    if (input) input.value = ''; // drop the file reference from the input
    if (res.ok) applyScanned(target, res.text);
    else {
      ctx.cameraMessage = `camera.photo_${res.cause}`;
      if (target === 'c2') ctx.update((r) => { r.c2.readFailed = true; r.c2.value = ''; r.c2.exact = ''; });
      else ctx.render();
    }
  };
  ctx.pasteInto = async (target) => {
    try {
      const text = await navigator.clipboard.readText();
      if (target === 'c2') ctx.setDestination(text, 'paste'); else applyScanned(target, text);
    } catch { ctx.cameraMessage = 'paste.unavailable'; ctx.render(); }
  };

  // WP9 / WP10 record lookup --------------------------------------------------------
  ctx.updateRecordInput = (inRun, fn) => {
    if (inRun) ctx.update((r) => fn(r.c5)); else { fn(ctx.lite); ctx.render(); }
  };
  /**
   * The only path from the UI to the proxy (core/proxy-client.js). Order of the guards:
   *   1. M1 / SN-P15 row 4 / Gate P-03: an unsupported intended asset makes NO request
   *      (checked first, so no hash state, network choice, or trigger can reach fetch);
   *      the run goes to its INCOMPLETE verdict, which derive() names.
   *   2. Gate R-04: a hash is required.
   *   3. Network not chosen or outside the table: no request. In the lite reader, no
   *      network asks the user to choose one and records no result (fix-pass m2), and a
   *      network outside the table names the limitation and stays on the input screen
   *      (SUPPORTED-NETWORKS §4.2 last row, Gate R-03; fix-pass m1). In a run both go
   *      to the verdict, where derive() names NETWORK_NOT_SELECTED or UNSUPPORTED_NETWORK.
   *   4. Gate C5-07: a malformed hash makes no request.
   */
  ctx.lookup = async (inRun) => {
    if (inRun && recordReadBlocked(ctx.run)) { ctx.go('verdict'); return; } // M1: zero requests
    const s = inRun ? ctx.run.c5 : ctx.lite;
    if (!s.hash) { ctx.cameraMessage = 'c5.hash_required'; ctx.render(); return; } // Gate R-04
    if (!inRun && !s.network) { ctx.cameraMessage = 'c5.network_required'; ctx.render(); return; } // m2: ask; record nothing
    if (s.network === 'other' || !NETWORKS[s.network]) {
      s.lookup = { kind: 'UNSUPPORTED_NETWORK' }; // no request (Gate R-03)
      if (inRun) { persist(); ctx.go('verdict'); } // in-run: derive() names NETWORK_NOT_SELECTED / UNSUPPORTED_NETWORK
      else ctx.render(); // m1, SN §4.2 last row: lite names the limitation and STAYS on the input screen
      return;
    }
    if (!validateHash(s.network, s.hash).ok) { ctx.render(); return; } // Gate C5-07: no request
    ctx.busy = true; ctx.render();
    const result = await lookupRecord(s.network, s.hash, fetchImpl);
    ctx.busy = false;
    s.lookup = result;
    if (result.mode === 'fixtures') ctx.fixtureMode = true;
    persist();
    ctx.go(inRun ? 'verdict' : 'lite-result');
  };
  /** Gate R-02: carry lite values into a full run only on the user's explicit action. */
  ctx.liteToRun = () => {
    const l = ctx.lite;
    ctx.run = store.newRun(4);
    // A carried hash starts a run with no Check 4 answer, so recordSubject() reads it
    // as the full payment (B1); the exact captured values travel with it (SN-P18).
    ctx.run.c5 = { ...ctx.run.c5, network: l.network, hash: l.hash, hashExact: l.hashExact ?? l.hash, sendingAddress: l.sendingAddress, sendingExact: l.sendingExact ?? l.sendingAddress, lookup: l.lookup };
    if (l.network) ctx.run.intent.asset = NETWORKS[l.network] ? NETWORKS[l.network].asset : null;
    if (l.amount) ctx.run.intent.amount = l.amount;
    if (l.receivingAddress) { const { exact, trimmed } = trimDisclosed(l.receivingExact || l.receivingAddress); Object.assign(ctx.run.c2, { exact, value: trimmed, method: 'carried' }); }
    persist();
    ctx.go('intent');
  };

  // WP11 stop scripts ---------------------------------------------------------------
  ctx.showScript = (id) => { ctx.returnScreen = ctx.screen; ctx.scriptId = id; ctx.go('script'); };
  ctx.closeScript = () => ctx.go(ctx.returnScreen || 'home');
  ctx.copyText = async (text) => { try { await navigator.clipboard.writeText(text); } catch { /* user can select the text instead */ } };
  ctx.shareText = async (text) => { try { if (navigator.share) await navigator.share({ text }); else await navigator.clipboard.writeText(text); } catch { /* user cancelled */ } };

  // WP3 record card -----------------------------------------------------------------
  function cardModel(lite) {
    const d = derive(ctx.run, ctx.lite);
    const f = lite ? d.liteFinal : d.final;
    const heading = t({ MATCH: 'verdict.match', MISMATCH: 'verdict.mismatch', INCOMPLETE: 'verdict.incomplete' }[f.verdict]).text;
    const checkLines = lite ? [] : [['1', d.c1], ['2', d.c2], ['3', d.c3], ['4', d.c4]].map(([n, r]) =>
      t('card.check_line', { n, name: t(`c${n}.title`), state: t(n === '4' && r.reason === 'NOT_APPLICABLE' ? 'status.does_not_apply' : `status.${r.status.toLowerCase()}`) }).text);
    const recordLines = (f.lines || []).filter((l) => l.result !== 'match').map((l) => t(`card.line.${l.result}`, { field: t(`field.${l.field}`) }).text);
    const missing = f.cause ? [t(`card.cause.${f.cause}`).text] : [];
    return {
      title: t('card.title').text,
      heading,
      subjectLine: f.subject === 'test' ? t('verdict.test_line').text : '',
      date: formatDate(Math.floor(Date.now() / 1000)),
      sections: [
        { label: t('card.section.checks').text, lines: checkLines },
        { label: t('card.section.lines').text, lines: [...recordLines, ...missing] },
        { label: t('card.section.cautions').text, lines: lite ? [] : d.cautions.map((c) => c.text) },
      ],
      frame: t('frame.educational').text,
      links: verdictLinks({ source: lite ? 'record' : 'run', reachedCheck5: true }).map((l) => `${t(l.labelKey).text}: ${l.url || t('links.unassigned').text}`),
    };
  }
  function cardFile(model) {
    const svg = buildCardSvg(model);
    return new File([svg], `verify-record-card-${Date.now()}.svg`, { type: 'image/svg+xml' });
  }
  ctx.saveCard = (lite) => {
    const m = cardModel(lite);
    store.saveCard(m); ctx.cards = store.loadCards();
    ctx.cardMessage = 'card.saved'; ctx.render();
  };
  function download(file) {
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: file.name, hidden: true });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  ctx.downloadCard = (lite) => { download(cardFile(cardModel(lite))); ctx.cardMessage = 'card.downloaded'; ctx.render(); };
  ctx.downloadSaved = (i) => { download(cardFile(ctx.cards[i])); };
  ctx.shareCard = async (lite) => {
    const file = cardFile(cardModel(lite));
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); ctx.cardMessage = 'card.shared'; }
      else { download(file); ctx.cardMessage = 'card.share_fallback'; } // download fallback [Plan WP3]
    } catch { ctx.cardMessage = 'card.share_cancelled'; }
    ctx.render();
  };
  ctx.clearCards = () => { store.clearCards(); ctx.cards = []; ctx.cardMessage = 'cards.cleared'; ctx.render(); };

  // Preferences ---------------------------------------------------------------------
  ctx.setPref = (k, v) => { ctx.prefs = { ...ctx.prefs, [k]: v }; store.savePrefs(ctx.prefs); ctx.render(); };

  // WP2 install + update ------------------------------------------------------------
  ctx.promptInstall = async () => { if (installEvent) { installEvent.prompt(); installEvent = null; ctx.canPromptInstall = false; ctx.render(); } };
  ctx.applyUpdate = () => { if (ctx.waitingWorker) ctx.waitingWorker.postMessage({ type: 'SKIP_WAITING' }); };

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; ctx.canPromptInstall = true; if (ctx.screen === 'install') ctx.render(); });
    window.addEventListener('online', () => { ctx.offline = false; ctx.render(); });   // no automatic retry (O-06)
    window.addEventListener('offline', () => { ctx.offline = true; ctx.render(); });
  }
  return ctx;
}

/** Service worker registration and update flow (WP2). Never touches localStorage. */
export function registerServiceWorker(ctx) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { scope: './' }).then((reg) => { // relative to the document base
    const offer = (w) => { ctx.waitingWorker = w; ctx.updateReady = true; ctx.render(); };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => { /* the app still works online without a worker */ });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
