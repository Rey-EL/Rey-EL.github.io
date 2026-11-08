/**
 * screens.js — every screen of the Phase 1 prototype (WP4–WP11).
 *
 * Each screen is a pure function of (ctx, derived) returning DOM built through dom.js,
 * so every string goes through the string table (WP12) and every value renders as text
 * (Gate A03). Screens never compute a verdict themselves: they display what
 * core/checks.js and core/record.js returned in `derived` (see app.js `derive`).
 *
 * There is no send, wallet-connect, sign, or key-entry control anywhere in this file or
 * the app [Spec §3 rule 1] [Gate E-05, C4-06]. The only text inputs accept: who is
 * asking, an address, a hash, an amount, and the user's own words for a network.
 */
import { h, raw } from './dom.js';
import { t, formatDate } from '../i18n/index.js';
import {
  deskScreen, statusBlock, stopScripts, standingFrame, verdictLinkList, valueRow, button,
  choiceGroup, checkboxGroup, textField,
} from './components.js';
import { NETWORKS, assetSupport, explorerLinks, EXPLORER_HOME } from '../core/networks.js';
import { groupBlocks, trimDisclosed } from '../core/address.js';
import { RED_FLAGS, check4AsksHistory } from '../core/checks.js';
import { WAIT_RULES, V } from '../core/record.js';
import { verdictLinks } from '../core/content-map.js';
import { formatUnits, sameHash, setRecordHash } from '../core/txhash.js';
import { hasBarcodeDetector, hasTextDetector, hasCamera } from './camera.js';

const PATH_KEYS = ['path.send', 'path.pay', 'path.claim', 'path.sent'];
const pathCtx = (run) => `p${run.entryPath}`; // per-path claim wording (Gates E-01…E-04)
const netName = (id) => (id && NETWORKS[id] ? t(NETWORKS[id].nameKey) : t('network.none'));
const assetName = (a) => t(`assetName.${a || 'UNKNOWN'}`);

// =========================================================================== Home (WP4)
export function home(ctx) {
  const resume = ctx.savedRun && h('div', { class: 'card resume', role: 'region', 'aria-label': t('resume.title') },
    h('h2', {}, t('resume.title')),
    h('p', {}, t('resume.body')),
    h('div', { class: 'row' },
      button('resume.continue', () => ctx.resume()),
      button('resume.restart', () => ctx.clearRunAndHome(), { cls: 'btn-secondary' })));
  return h('section', { class: 'screen', 'data-screen': 'home', 'aria-labelledby': 'home-title' },
    h('p', { class: 'tagline' }, t('app.tagline')),
    resume,
    h('h1', { id: 'home-title', tabindex: '-1' }, t('entry.question')),
    h('div', { class: 'paths' }, PATH_KEYS.map((k, i) =>
      h('button', { type: 'button', class: 'btn btn-path', on: { click: () => ctx.startRun(i + 1) } }, t(k)))),
    h('p', { class: 'help' }, t('entry.help')),
    h('nav', { class: 'secondary-nav', 'aria-label': t('nav.more') },
      button('nav.lite', () => ctx.go('lite'), { cls: 'btn-secondary' }),
      button('nav.cards', () => ctx.go('cards'), { cls: 'btn-secondary' }),
      button('nav.install', () => ctx.go('install'), { cls: 'btn-secondary' }),
      button('nav.settings', () => ctx.go('settings'), { cls: 'btn-secondary' })),
    standingFrame());
}

// ====================================================================== Intention (WP4)
export function intent(ctx, d) {
  const run = ctx.run;
  const support = assetSupport(run.intent.asset);
  const options = ['BTC', 'ETH', 'TOKEN_ETH', 'OTHER_BTC', 'OTHER_COIN', 'UNKNOWN'].map((v) => ({ value: v, labelKey: `assetChoice.${v}` }));
  return h('section', { class: 'screen', 'data-screen': 'intent', 'aria-labelledby': 'intent-title' },
    h('p', { class: 'step' }, t(PATH_KEYS[run.entryPath - 1])),
    h('h1', { id: 'intent-title', tabindex: '-1' }, t(`intent.title.${pathCtx(run)}`)),
    h('p', {}, t(`intent.context.${pathCtx(run)}`)),
    choiceGroup({ name: 'asset', legendKey: `intent.asset.${pathCtx(run)}`, options, value: run.intent.asset,
      onChange: (v) => ctx.update((r) => { r.intent.asset = v; }) }),
    !support.supported && run.intent.asset ? unsupportedNote(run.intent.asset) : null,
    support.supported ? textField({ id: 'amount', labelKey: `intent.amount.${pathCtx(run)}`, helpKey: 'intent.amount.help',
      value: run.intent.amount, inputmode: 'decimal', maxlength: 40, onInput: (v) => ctx.update((r) => { r.intent.amount = v; }) }) : null,
    d.amountInvalid ? h('p', { class: 'error', role: 'alert' }, h('span', { 'aria-hidden': 'true' }, raw('! ')), t('intent.amount.invalid', { asset: assetName(run.intent.asset) })) : null,
    h('p', { class: 'help' }, t('intent.local')),
    h('div', { class: 'row' },
      button('nav.continue', () => ctx.go('check1')),
      button('nav.home', () => ctx.go('home'), { cls: 'btn-secondary' })));
}

/** SN-P13 / SN-P15 messages for an asset outside the table, with the §4.3 link rule. */
function unsupportedNote(asset) {
  const s = assetSupport(asset);
  if (s.reason === 'ASSET_MISSING') return h('p', { class: 'note' }, t('unsupported.asset_missing'));
  const key = asset === 'TOKEN_ETH' ? 'unsupported.token_eth' : asset === 'OTHER_BTC' ? 'unsupported.other_btc' : 'unsupported.standard';
  const home = s.reason === 'UNSUPPORTED_ASSET' ? EXPLORER_HOME[s.network] : null; // UNSUPPORTED_NETWORK: no link
  return h('div', { class: 'note' },
    h('p', {}, t(key)),
    h('p', {}, t('unsupported.still_runs')),
    home ? h('p', {}, h('a', { href: home.url, target: '_blank', rel: 'noopener noreferrer' }, t('unsupported.look_yourself', { explorer: t(home.labelKey) }))) : null);
}

// ===================================================================== Check 1 (WP5)
export function check1(ctx, d) {
  const run = ctx.run; const a = run.c1; const r = d.c1;
  const yn = (prefix) => ['yes', 'no', 'unsure'].map((v) => ({ value: v, labelKey: `${prefix}.${v}` }));
  return deskScreen({
    id: 'check1', titleKey: 'c1.title', stepKey: 'step.1',
    claim: [h('p', {}, t(`c1.claim.${pathCtx(run)}`))],
    evidence: [
      textField({ id: 'who', labelKey: `c1.who.${pathCtx(run)}`, value: a.who, maxlength: 120, onInput: (v) => ctx.update((x) => { x.c1.who = v; }) }),
      choiceGroup({ name: 'channel', legendKey: 'c1.channel', value: a.channel,
        options: ['email', 'text', 'call', 'social', 'in_person', 'website', 'other'].map((v) => ({ value: v, labelKey: `c1.channel.${v}` })),
        onChange: (v) => ctx.update((x) => { x.c1.channel = v; }) }),
      choiceGroup({ name: 'normal', legendKey: 'c1.normal', options: yn('c1.normal'), value: a.normalChannel, onChange: (v) => ctx.update((x) => { x.c1.normalChannel = v; }) }),
      choiceGroup({ name: 'contact', legendKey: 'c1.contact', options: yn('c1.contact'), value: a.contactMatch, onChange: (v) => ctx.update((x) => { x.c1.contactMatch = v; }) }),
      checkboxGroup({ name: 'flags', legendKey: 'c1.flags', values: a.flags,
        options: [...RED_FLAGS.map((f) => ({ value: f, labelKey: `c1.flag.${f}` })), { value: 'none', labelKey: 'c1.flag.none' }],
        onToggle: (v, on) => ctx.update((x) => {
          if (v === 'none') { x.c1.noFlags = on; if (on) x.c1.flags = []; return; }
          x.c1.flags = on ? [...new Set([...x.c1.flags, v])] : x.c1.flags.filter((f) => f !== v);
          if (on) x.c1.noFlags = false;
        }) }),
    ],
    record: [h('p', {}, t('c1.record'))],
    decision: [
      statusBlock(r.status, { items: r.items, itemPrefix: 'c1.item' }),
      r.status === 'FLAGGED' ? stopScripts(ctx, { context: 'c1' }) : null,
      nav(ctx, 'intent', 'check2'),
    ],
  });
}

// ===================================================================== Check 2 (WP6)
export function check2(ctx, d) {
  const run = ctx.run; const c = run.c2; const r = d.c2; const cls = r.classification;
  const support = assetSupport(run.intent.asset);
  const blocks = c.value ? groupBlocks(c.value) : [];
  const item = (code) => (code === 'FAMILY_MISMATCH'
    ? { code, params: { asset: assetName(run.intent.asset), family: t(`family.${cls.family}`) } }
    : code);
  return deskScreen({
    id: 'check2', titleKey: 'c2.title', stepKey: 'step.2',
    claim: [h('p', {}, t(`c2.claim.${pathCtx(run)}`))],
    evidence: [
      !support.supported ? unsupportedNote(run.intent.asset) : null,
      h('p', {}, t('c2.capture.intro')),
      h('div', { class: 'capture' },
        button('c2.capture.scan', () => ctx.scan('c2'), { disabled: !hasCamera() || !hasBarcodeDetector() }),
        !hasBarcodeDetector() ? h('p', { class: 'help' }, t('camera.no_qr_support')) : null,
        h('label', { class: 'btn btn-secondary file-btn', for: 'photo-input' }, t('c2.capture.photo')),
        h('input', { id: 'photo-input', type: 'file', accept: 'image/*', capture: 'environment', class: 'visually-hidden',
          on: { change: (e) => ctx.photo('c2', e.target.files && e.target.files[0], e.target) } }),
        !hasBarcodeDetector() && !hasTextDetector() ? h('p', { class: 'help' }, t('camera.no_photo_support')) : null,
        button('c2.capture.paste', () => ctx.pasteInto('c2'), { cls: 'btn-secondary' }),
        textField({ id: 'address-manual', labelKey: 'c2.capture.manual', helpKey: 'c2.capture.manual_help', mono: true, value: c.exact,
          maxlength: 140, onInput: (v) => ctx.setDestination(v, 'manual') })),
      ctx.cameraMessage ? h('p', { class: 'note', role: 'alert' }, t(ctx.cameraMessage)) : null,
      c.qrExtra ? h('p', { class: 'note' }, t('c2.qr.also_says', { text: c.qrExtra })) : null,
      c.qrKind === 'ETHEREUM_EXTRA' || c.qrKind === 'NOT_ADDRESS' ? valueRow('c2.qr.raw', c.qrRaw || '') : null,
    ],
    record: c.value ? [
      // Gate C2-07: show the exact captured value, then what will be compared.
      valueRow('c2.exact', `[${c.exact}]`),
      c.exact !== c.value ? h('p', { class: 'note' }, t('c2.trimmed')) : null,
      h('p', {}, t('c2.blocks.intro')),
      h('ol', { class: 'blocks mono', 'aria-label': t('c2.blocks.label') }, blocks.map((b) => h('li', {}, raw(b)))),
      cls && cls.valid ? h('p', {}, t(`c2.kind.${cls.kind}`)) : null,
      cls && cls.noChecksum ? h('p', { class: 'note' }, t('c2.no_checksum')) : null,
      cls && cls.kind === 'BITCOIN_MAINNET' ? h('p', { class: 'help' }, t('c2.bc1_case')) : null,
      h('p', { class: 'note' }, t('c2.lookalike')),
      cls && cls.valid && cls.family === (support.network === 'bitcoin-mainnet' ? 'bitcoin' : 'ethereum')
        ? choiceGroup({ name: 'compare', legendKey: 'c2.compare', value: c.comparison,
          options: ['match', 'different', 'declined'].map((v) => ({ value: v, labelKey: `c2.compare.${v}` })),
          onChange: (v) => ctx.update((x) => { x.c2.comparison = v; }) }) : null,
    ] : [h('p', {}, t('c2.record.empty'))],
    decision: [
      statusBlock(r.status, { items: r.items.map(item), itemPrefix: 'c2.item' }),
      r.status === 'FLAGGED' ? stopScripts(ctx, { context: 'c2' }) : null,
      nav(ctx, 'check1', 'check3'),
    ],
  });
}

// ===================================================================== Check 3 (WP7)
export function check3(ctx, d) {
  const run = ctx.run; const r = d.c3; const cls = d.c2.classification;
  const support = assetSupport(run.intent.asset);
  const intendedNet = support.network;
  const families = { bitcoin: 'Bitcoin', ethereum: 'Ethereum' };
  const told = run.c3.otherWords
    ? t('c3.told.words', { words: run.c3.otherWords })
    : t(intendedNet === 'bitcoin-mainnet' ? 'c3.told.other_than_bitcoin' : 'c3.told.other_than_ethereum');
  const item = (code) => {
    if (code === 'WRONG_NETWORK_FAMILY') return { code, params: { intended: netName(intendedNet), found: t(`family.${cls.family}`) } };
    if (code === 'TOLD_DIFFERENT_NETWORK') return { code, params: { intended: netName(intendedNet), told } };
    return code;
  };
  return deskScreen({
    id: 'check3', titleKey: 'c3.title', stepKey: 'step.3',
    claim: [h('p', {}, t('c3.claim'))],
    evidence: [
      valueRow('c3.intended_asset', assetName(run.intent.asset).text, 'plain'),
      valueRow('c3.intended_network', netName(intendedNet).text, 'plain'),
      cls && cls.valid ? h('p', {}, t(`c3.destination.${cls.kind}`)) : h('p', {}, t('c3.destination.unknown')),
      r.askNetwork ? choiceGroup({ name: 'network', legendKey: 'c3.question', value: run.c3.networkAnswer,
        options: [{ value: 'match', labelKey: `c3.answer.${families[cls.family]}` }, { value: 'different', labelKey: 'c3.answer.different' }, { value: 'unknown', labelKey: 'c3.answer.unknown' }],
        onChange: (v) => ctx.update((x) => { x.c3.networkAnswer = v; }) }) : null,
      r.askNetwork && run.c3.networkAnswer === 'different'
        ? textField({ id: 'other-network', labelKey: 'c3.other_words', helpKey: 'c3.other_words_help', value: run.c3.otherWords, maxlength: 60,
          onInput: (v) => ctx.update((x) => { x.c3.otherWords = v; }) }) : null,
    ],
    record: [h('p', { class: 'warning' }, h('span', { 'aria-hidden': 'true' }, raw('! ')), t('c3.warning'))],
    decision: [
      statusBlock(r.status, { items: r.items.map(item), itemPrefix: 'c3.item' }),
      r.routeBack ? button('c3.back_to_2', () => ctx.go('check2'), { cls: 'btn-secondary' }) : null,
      r.status === 'FLAGGED' ? stopScripts(ctx, { context: 'c3' }) : null,
      nav(ctx, 'check2', 'check4'),
    ],
  });
}

// ===================================================================== Check 4 (WP8)
export function check4(ctx, d) {
  const run = ctx.run; const r = d.c4; const c4 = run.c4;
  const notApplicable = r.reason === 'NOT_APPLICABLE';
  const asksHistory = check4AsksHistory({ entryPath: run.entryPath, alreadySent: run.alreadySent, c1: d.c1.status, c2: d.c2.status, c3: d.c3.status, answer: c4.answer });
  const showRecording = !(run.entryPath === 4); // C4: on path 4 the recording question is not shown
  const bodyKey = { NOT_APPLICABLE: 'c4.body.na', UPSTREAM_FLAGGED: 'c4.body.upstream', TEST_NOT_NEEDED: 'c4.body.not_needed', TEST_SENT: 'c4.body.sent', DECLINED_TEST: 'c4.body.declined', DECISION_MISSING: 'c4.body.missing' }[r.reason];
  // CHECK4-RULE §4.4 row 2 (frozen): "Check [n] flagged … settle Check [n] first." (m3)
  const flaggedNames = r.reason === 'UPSTREAM_FLAGGED' ? r.items.map((i) => t(`c4.item.${i}`).text).join(', ') : '';
  const answers = r.fit === 'NOT_NEEDED'
    ? [{ value: 'TEST_SENT', labelKey: 'c4.answer.sent_anyway' }, { value: 'TEST_NOT_SENT', labelKey: 'c4.answer.not_sent_plain' }, { value: 'ALREADY_SENT_FULL', labelKey: 'c4.answer.already' }]
    : [{ value: 'TEST_SENT', labelKey: 'c4.answer.sent' }, { value: 'TEST_NOT_SENT', labelKey: 'c4.answer.not_sent' }, { value: 'ALREADY_SENT_FULL', labelKey: 'c4.answer.already' }];
  return deskScreen({
    id: 'check4', titleKey: 'c4.title', stepKey: 'step.4',
    claim: [h('p', {}, t(notApplicable ? 'c4.claim.sent' : 'c4.claim'))],
    evidence: notApplicable ? [h('p', {}, t('c4.already_sent'))] : [
      r.reason !== 'UPSTREAM_FLAGGED' && r.fit === 'RECOMMENDED' ? h('p', { class: 'strong' }, t('c4.recommend')) : null,
      h('div', { class: 'explain' }, ['1', '2', '3', '4', '5', '6', '7', '8'].map((n) => h('p', {}, t(`c4.explain.${n}`)))),
      asksHistory ? choiceGroup({ name: 'history', legendKey: 'c4.history', value: c4.history,
        options: ['yes', 'no', 'unsure'].map((v) => ({ value: v, labelKey: `c4.history.${v}` })),
        onChange: (v) => ctx.update((x) => { x.c4.history = v; }) }) : null,
    ],
    record: [
      h('p', { class: 'strong' }, t('c4.never_sends')),
      showRecording ? choiceGroup({ name: 'test', legendKey: 'c4.question', value: c4.answer, options: answers,
        onChange: (v) => ctx.update((x) => { x.c4.answer = v; if (v === 'ALREADY_SENT_FULL') x.alreadySent = true; else if (x.entryPath !== 4) x.alreadySent = false; }) }) : null,
      c4.answer === 'TEST_SENT' && !notApplicable ? h('div', {},
        h('p', {}, t('c4.handoff')),
        // C4-P11 hand-off: the test hash is carried into Check 5 only while Check 5 is empty
        // or still holds the previous test hash, so editing it never overwrites a
        // full-payment hash already entered there. No subject is stored: app.js
        // recordSubject() derives it from the two hashes (fix-pass B1, Gate C5-03).
        textField({ id: 'test-hash', labelKey: 'c4.test_hash', value: c4.testHash, mono: true, maxlength: 80, onInput: (v) => ctx.update((x) => {
          const carry = !x.c5.hash || sameHash(x.c5.hash, x.c4.testHash);
          x.c4.testHash = v;
          if (carry) setRecordHash(x.c5, v);
        }) }),
        textField({ id: 'test-amount', labelKey: 'c4.test_amount', helpKey: 'c4.test_amount_help', value: c4.testAmount, inputmode: 'decimal', maxlength: 40, onInput: (v) => ctx.update((x) => { x.c4.testAmount = v; }) })) : null,
    ],
    decision: [
      statusBlock(r.status, { headingKey: notApplicable ? 'status.does_not_apply' : undefined }),
      h('p', {}, t(bodyKey, { checks: flaggedNames })),
      r.status === 'FLAGGED' ? stopScripts(ctx, { context: 'c4' }) : null,
      nav(ctx, 'check3', 'check5'),
    ],
  });
}

// ===================================================================== Check 5 (WP9)
export function check5(ctx, d) {
  return recordScreen(ctx, d, { id: 'check5', titleKey: 'c5.title', stepKey: 'step.5', inRun: true });
}

// ====================================================== Read the Record (lite) (WP10)
export function check5Lite(ctx, d) {
  return recordScreen(ctx, { ...d, hashCheck: d.liteHashCheck }, { id: 'lite', titleKey: 'lite.title', stepKey: 'lite.step', inRun: false });
}

/**
 * disclosedField — a hash or address input whose surrounding whitespace is removed only
 * AFTER disclosure (SN-P18, Gate C2-07; fix-pass m4), the same rule Check 2 applies.
 * The input keeps showing exactly what the user entered (`exact`). When the value that
 * will be read and compared (`compared`) differs from it, the screen shows both between
 * brackets with the plain note that only start/end spaces were removed. Nothing else is
 * ever changed: no case, prefix, or character repair. `blocks` adds the numbered-block
 * view of the compared value (used for the lite receiving address).
 */
function disclosedField({ id, labelKey, helpKey, exact, compared, onInput, maxlength, blocks = false }) {
  const shownExact = exact ?? compared ?? '';
  const changed = !!shownExact && shownExact !== compared;
  return h('div', { class: 'disclosed-field' },
    textField({ id, labelKey, helpKey, value: shownExact, mono: true, maxlength, onInput }),
    changed ? h('div', { class: 'note', 'data-key': `${id}-trimmed` },
      valueRow('c5.capture.exact', `[${shownExact}]`),
      h('p', {}, t('c5.capture.trimmed')),
      valueRow('c5.capture.compared', `[${compared}]`)) : null,
    blocks && compared ? h('div', {},
      h('p', {}, t('lite.compare.to_blocks')),
      h('ol', { class: 'blocks mono', 'aria-label': t('c2.blocks.label') }, groupBlocks(compared).map((b) => h('li', {}, raw(b))))) : null);
}
/** Stores an address field as { compared (trimmed), exact } — m4, SN-P18. */
const setAddress = (x, field, exactField, v) => { const r = trimDisclosed(v); x[field] = r.trimmed; x[exactField] = r.exact; };

/** Shared by Check 5 and Read the Record (lite) — one input, one lookup, one comparison (Gate R-01). */
function recordScreen(ctx, d, { id, titleKey, stepKey, inRun }) {
  const s = inRun ? ctx.run.c5 : ctx.lite;
  const net = s.network;
  const supported = !!NETWORKS[net];
  const hashOk = d.hashCheck && d.hashCheck.ok;
  const links = supported && hashOk ? explorerLinks(net, s.hash.trim()) : [];
  const support = inRun ? assetSupport(ctx.run.intent.asset) : { supported: true };
  const netOptions = [
    { value: 'bitcoin-mainnet', labelKey: 'c5.network.bitcoin' },
    { value: 'ethereum-mainnet', labelKey: 'c5.network.ethereum' },
    { value: 'other', labelKey: 'c5.network.other' },
  ];
  return deskScreen({
    id, titleKey, stepKey,
    claim: [h('p', {}, t(inRun ? 'c5.claim' : 'lite.claim'))],
    evidence: [
      inRun && !support.supported ? unsupportedNote(ctx.run.intent.asset) : null,
      choiceGroup({ name: `${id}-net`, legendKey: 'c5.network', value: net, options: netOptions,
        onChange: (v) => ctx.updateRecordInput(inRun, (x) => { x.network = v; x.lookup = null; }) }),
      net === 'other' ? h('p', { class: 'note', role: 'alert' }, t('unsupported.standard')) : null,
      inRun && d.final && d.final.subject === 'test' ? h('p', { class: 'note' }, t('c5.subject.test')) : null, // derived subject (B1)
      button('c5.scan', () => ctx.scan(inRun ? 'c5' : 'lite'), { cls: 'btn-secondary', disabled: !hasCamera() || !hasBarcodeDetector() }),
      button('c5.paste', () => ctx.pasteInto(inRun ? 'c5' : 'lite'), { cls: 'btn-secondary' }),
      ctx.cameraMessage ? h('p', { class: 'note', role: 'alert' }, t(ctx.cameraMessage)) : null, // incl. Gate R-04
      disclosedField({ id: `${id}-hash`, labelKey: 'c5.hash', helpKey: 'c5.hash_help', exact: s.hashExact, compared: s.hash, maxlength: 80,
        onInput: (v) => ctx.updateRecordInput(inRun, (x) => setRecordHash(x, v)) }),
      d.hashCheck && !d.hashCheck.ok && s.hash ? h('p', { class: 'error', role: 'alert' }, h('span', { 'aria-hidden': 'true' }, raw('! ')), t(`hash.${d.hashCheck.problem}`)) : null,
      inRun ? disclosedField({ id: 'sending', labelKey: 'c5.sending', helpKey: 'c5.sending_help', exact: s.sendingExact, compared: s.sendingAddress, maxlength: 140,
        onInput: (v) => ctx.updateRecordInput(true, (x) => setAddress(x, 'sendingAddress', 'sendingExact', v)) }) : null,
      !inRun ? liteIntent(ctx) : null,
      h('p', { class: 'help' }, t('c5.connection_needed')),
      ctx.offline ? h('p', { class: 'note', role: 'alert' }, t('c5.offline_now')) : null,
      // M1: for an unsupported intended asset the read is disabled (no proxy call, SN-P15
      // row 4); ctx.lookup refuses it as well, so no other trigger can send the hash.
      button('c5.read', () => ctx.lookup(inRun), { disabled: ctx.busy || (inRun && !!ctx.run.intent.asset && !support.supported) }),
      ctx.busy ? h('p', { role: 'status', 'aria-live': 'polite' }, t('c5.reading')) : null,
      links.length ? h('div', {}, h('p', {}, t('c5.links_intro')), h('ul', { class: 'links' }, links.map((l) =>
        h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, t(l.labelKey)))))) : null,
    ],
    record: [h('p', {}, t('c5.record_note'))],
    decision: [
      s.lookup ? button('c5.see_verdict', () => ctx.go(inRun ? 'verdict' : 'lite-result')) : h('p', {}, t('c5.not_yet_read')),
      inRun ? nav(ctx, 'check4', 'verdict') : h('div', { class: 'row' }, button('nav.home', () => ctx.go('home'), { cls: 'btn-secondary' })),
    ],
  });
}

function liteIntent(ctx) {
  const l = ctx.lite;
  return h('details', { class: 'lite-intent' },
    h('summary', {}, t('lite.compare.title')),
    h('p', { class: 'help' }, t('lite.compare.help')),
    disclosedField({ id: 'lite-to', labelKey: 'lite.compare.to', exact: l.receivingExact, compared: l.receivingAddress, maxlength: 140, blocks: true,
      onInput: (v) => ctx.updateRecordInput(false, (x) => setAddress(x, 'receivingAddress', 'receivingExact', v)) }),
    textField({ id: 'lite-amount', labelKey: 'lite.compare.amount', value: l.amount, inputmode: 'decimal', maxlength: 40, onInput: (v) => ctx.updateRecordInput(false, (x) => { x.amount = v; }) }),
    disclosedField({ id: 'lite-from', labelKey: 'c5.sending', exact: l.sendingExact, compared: l.sendingAddress, maxlength: 140,
      onInput: (v) => ctx.updateRecordInput(false, (x) => setAddress(x, 'sendingAddress', 'sendingExact', v)) }));
}

// ============================================================= Verdict (WP9, WP11, WP3)
export function verdict(ctx, d, { lite = false } = {}) {
  const f = lite ? d.liteFinal : d.final;
  const s = lite ? ctx.lite : ctx.run.c5;
  const net = s.network;
  const headingKey = { MATCH: 'verdict.match', MISMATCH: 'verdict.mismatch', INCOMPLETE: 'verdict.incomplete' }[f.verdict];
  const symbol = { MATCH: '✓', MISMATCH: '!', INCOMPLETE: '?' }[f.verdict];
  const rec = f.record;
  const decimals = NETWORKS[net] ? NETWORKS[net].decimals : 0;
  const lines = renderLines(f, rec, decimals, net);
  const cautions = lite ? [] : d.cautions;
  const hashOk = d.lookupHash && NETWORKS[net];
  const links = hashOk ? explorerLinks(net, d.lookupHash) : [];
  return h('section', { class: 'screen', 'data-screen': lite ? 'lite-result' : 'verdict', 'aria-labelledby': 'verdict-title' },
    h('p', { class: 'step' }, t('verdict.standard_name')),
    h('h1', { id: 'verdict-title', tabindex: '-1', class: `verdict verdict-${f.verdict.toLowerCase()}`, 'data-status': f.verdict },
      h('span', { class: 'status-symbol', 'aria-hidden': 'true' }, raw(symbol)), t(headingKey)),
    f.subject === 'test' ? h('p', { class: 'strong' }, t('verdict.test_line')) : null,
    f.verdict === V.INCOMPLETE ? incompleteExplain(f, net) : null,
    rec ? plainRecord(rec, decimals) : null,
    lines.length ? h('div', {}, h('h2', {}, t('verdict.lines')), h('ul', { class: 'lines' }, lines)) : null,
    cautions.length ? h('div', { class: 'cautions' }, h('h2', {}, t('verdict.cautions')), h('ul', {}, cautions.map((c) => h('li', {}, c)))) : null,
    // Direct explorer links whenever a supported network and a valid hash exist (Gates
    // C5-08, C5-09, O-03); built only from the frozen table, never from user input (C5-10).
    links.length ? h('div', {}, h('p', {}, t('verdict.direct_links')),
      h('ul', { class: 'links' }, links.map((l) => h('li', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, t(l.labelKey)))))) : null,
    f.verdict === V.MISMATCH ? stopScripts(ctx, { context: 'verdict' }) : null,
    standingFrame(),
    verdictLinkList(verdictLinks({ source: lite ? 'record' : 'run', reachedCheck5: true })),
    h('div', { class: 'row' },
      button('card.save', () => ctx.saveCard(lite)),
      button('card.share', () => ctx.shareCard(lite), { cls: 'btn-secondary' }),
      button('card.download', () => ctx.downloadCard(lite), { cls: 'btn-secondary' })),
    ctx.cardMessage ? h('p', { role: 'status', 'aria-live': 'polite' }, t(ctx.cardMessage)) : null,
    lite
      ? h('div', { class: 'row' }, button('lite.to_run', () => ctx.liteToRun(), { cls: 'btn-secondary' }), button('lite.again', () => ctx.go('lite'), { cls: 'btn-secondary' }))
      : h('div', { class: 'row' }, button('nav.back', () => ctx.go('check5'), { cls: 'btn-secondary' }), button('run.clear', () => ctx.clearRunAndHome(), { cls: 'btn-secondary' })),
    button('nav.home', () => ctx.go('home'), { cls: 'btn-secondary' }));
}

/** Plain-language record: what moved, between which addresses, on which network, when [Plan WP9]. */
function plainRecord(rec, decimals) {
  const amount = rec.network === 'ethereum-mainnet' ? formatUnits(rec.valueUnits, decimals) : null;
  return h('div', { class: 'plain-record' },
    h('h2', {}, t('record.title')),
    h('p', {}, t('record.network', { network: netName(rec.network) })),
    amount !== null ? h('p', {}, t('record.eth_moved', { amount, from: rec.from[0] || '', to: rec.to[0] ? rec.to[0].address : '' })) : null,
    rec.network === 'bitcoin-mainnet' ? h('div', {},
      h('p', {}, t('record.btc_from')), h('ul', { class: 'mono' }, rec.from.map((a) => h('li', {}, raw(a)))),
      h('p', {}, t('record.btc_to')), h('ul', { class: 'mono' }, rec.to.map((o) => h('li', {}, raw(`${o.address} — ${formatUnits(o.units, decimals)} BTC`))))) : null,
    h('p', {}, rec.settlement === 'SETTLED' && rec.timestamp ? t('record.settled_at', { when: formatDate(rec.timestamp) })
      : t(`record.settlement.${rec.settlement}`)),
    rec.contractCall ? h('p', { class: 'note' }, t('record.contract_call')) : null,
    valueRow('record.hash', rec.hash));
}

function renderLines(f, rec, decimals, net) {
  return (f.lines || []).map((l) => {
    const params = {};
    if (l.field === 'amount' && l.recordUnits !== undefined) params.amount = formatUnits(l.recordUnits, decimals);
    if (l.field === 'settlement' && l.result === 'pending') params.wait = t(`check5.wait.pending.${net}`, WAIT_RULES[net] || {});
    const sym = { match: '✓', mismatch: '!', missing: '?', pending: '?', not_comparable: '–' }[l.result];
    return h('li', { 'data-status': l.result }, h('span', { 'aria-hidden': 'true' }, raw(`${sym} `)), t(`verdict.line.${l.field}.${l.result}`, params));
  });
}

function incompleteExplain(f, net) {
  const rule = WAIT_RULES[net];
  if (f.cause === 'NOT_FOUND') {
    return h('div', { class: 'note', role: 'alert' },
      h('p', { class: 'strong' }, t('check5.not_public')),
      h('p', {}, t(`check5.wait.${net}`, rule)),
      h('p', {}, t('check5.copy_whole')));
  }
  if (f.cause && f.cause !== 'NOT_RUN') return h('p', { class: 'note', role: 'alert' }, t(`check5.cause.${f.cause}`));
  if (f.cause === 'NOT_RUN') return h('p', { class: 'note' }, t('check5.cause.NOT_RUN'));
  return h('div', { class: 'note' }, h('p', {}, t('verdict.missing_intro')));
}

// ================================================================ Saved cards (WP3)
export function cards(ctx) {
  const list = ctx.cards;
  return h('section', { class: 'screen', 'data-screen': 'cards', 'aria-labelledby': 'cards-title' },
    h('h1', { id: 'cards-title', tabindex: '-1' }, t('cards.title')),
    h('p', {}, t('cards.local')),
    list.length ? h('ul', { class: 'card-list' }, list.map((c, i) => h('li', {},
      h('p', { class: 'strong' }, raw(c.heading)), h('p', {}, raw(c.date)),
      button('card.download', () => ctx.downloadSaved(i), { cls: 'btn-secondary' })))) : h('p', {}, t('cards.none')),
    list.length ? button('cards.clear', () => ctx.clearCards(), { cls: 'btn-secondary' }) : null,
    ctx.cardMessage ? h('p', { role: 'status', 'aria-live': 'polite' }, t(ctx.cardMessage)) : null,
    button('nav.home', () => ctx.go('home'), { cls: 'btn-secondary' }));
}

// =============================================================== Install help (WP2)
export function install(ctx) {
  return h('section', { class: 'screen', 'data-screen': 'install', 'aria-labelledby': 'install-title' },
    h('h1', { id: 'install-title', tabindex: '-1' }, t('install.title')),
    h('p', {}, t('install.intro')),
    h('h2', {}, t('install.android.title')),
    ctx.canPromptInstall ? button('install.android.button', () => ctx.promptInstall()) : h('p', {}, t('install.android.manual')),
    h('h2', {}, t('install.iphone.title')),
    h('ol', {}, ['1', '2', '3', '4'].map((n) => h('li', {}, t(`install.iphone.step${n}`)))),
    h('p', {}, t('install.offline')),
    h('p', { class: 'help' }, t('install.no_store')),
    button('nav.home', () => ctx.go('home'), { cls: 'btn-secondary' }));
}

// ================================================================== Settings (WP1, WP12)
export function settings(ctx) {
  return h('section', { class: 'screen', 'data-screen': 'settings', 'aria-labelledby': 'settings-title' },
    h('h1', { id: 'settings-title', tabindex: '-1' }, t('settings.title')),
    choiceGroup({ name: 'textsize', legendKey: 'settings.text_size', value: ctx.prefs.textSize,
      options: ['normal', 'large', 'larger'].map((v) => ({ value: v, labelKey: `settings.text_size.${v}` })),
      onChange: (v) => ctx.setPref('textSize', v) }),
    h('h2', {}, t('settings.language')),
    h('p', {}, t('settings.language.english_only')),
    h('h2', {}, t('settings.data')),
    h('p', {}, t('settings.data.body')),
    h('div', { class: 'row' },
      button('run.clear', () => ctx.clearRunAndHome(), { cls: 'btn-secondary' }),
      button('cards.clear', () => ctx.clearCards(), { cls: 'btn-secondary' })),
    ctx.cardMessage ? h('p', { role: 'status', 'aria-live': 'polite' }, t(ctx.cardMessage)) : null,
    h('p', { class: 'help' }, t('settings.version', { version: ctx.version })),
    button('nav.home', () => ctx.go('home'), { cls: 'btn-secondary' }));
}

// ======================================================= Full-screen stop script (WP11)
export function scriptView(ctx, id) {
  return h('section', { class: 'screen script-full', 'data-screen': 'script', 'aria-labelledby': 'script-title' },
    h('p', { class: 'script-to', id: 'script-title', tabindex: '-1' }, t(`stop.${id}.to`)),
    h('p', { class: 'script-big' }, t(`stop.${id}.text`)),
    button('nav.back', () => ctx.closeScript(), { cls: 'btn-secondary' }));
}

/** Back / next row used on every check (no step is ever locked: C4-P7 "never a hard block"). */
function nav(ctx, back, next) {
  return h('div', { class: 'row nav-row' },
    button('nav.back', () => ctx.go(back), { cls: 'btn-secondary' }),
    button(next === 'verdict' ? 'nav.to_verdict' : 'nav.next', () => ctx.go(next)));
}
