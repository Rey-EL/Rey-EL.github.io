/**
 * content-map.js — versioned content map for verdict links (OPEN-QUESTIONS item 4).
 *
 * Every verdict must link the public correction log, the matching Desk episode, and the
 * matching Crypto Basics part [Spec §4 verdict screen] [Plan §5] [Gate V-03].
 *
 * STATUS: STOP ITEM (recorded in reports/IMPLEMENTER-REPORT.md). The governing documents
 * supply no URL for the correction log, any Desk episode, or any Crypto Basics part, and
 * no mapping from entry path / failed check / fraud pattern to an episode or part.
 * OPEN-QUESTIONS item 4 says builders "should not guess canonical public links or create
 * placeholder targets that later ship by accident", and BUILD-PLAN §7 forbids inventing a
 * link-target rule. So every target below is `null`, and the UI renders each required
 * link as a labelled, NON-clickable line that says the link is not yet assigned.
 *
 * The one mapping the spec itself grounds: Spec §5.2 says Read the Record (lite) "is
 * Part 4 as a tool", so Check 5 / Read the Record map to Crypto Basics Part 4. Its URL is
 * still not supplied.
 *
 * To complete: fill `url` values (https only; dom.js refuses any other scheme) and the
 * mapping rules, bump CONTENT_MAP_VERSION, and re-run test/boundaries.test.mjs, whose
 * "V-03 content map" test checks the invariants above: three labelled links on every
 * verdict, every target either null (unassigned) or an https URL, never a placeholder.
 */
export const CONTENT_MAP_VERSION = '2026-11-05-unassigned';

export const CONTENT_MAP = Object.freeze({
  correctionLog: Object.freeze({ url: null }),
  desk: Object.freeze({ default: Object.freeze({ url: null }) }),
  basics: Object.freeze({
    part4: Object.freeze({ url: null, ground: 'Spec §5.2: Read the Record (lite) is Part 4 as a tool' }),
    default: Object.freeze({ url: null }),
  }),
});

/**
 * Resolve the three verdict links for a run. `context` (entry path, failed checks) is
 * accepted now so the mapping can be added without changing callers.
 * Returns [{ id, labelKey, url|null }].
 */
export function verdictLinks(context = {}) {
  const basics = context.source === 'record' || context.reachedCheck5 ? CONTENT_MAP.basics.part4 : CONTENT_MAP.basics.default;
  return [
    { id: 'correction', labelKey: 'links.correctionLog', url: CONTENT_MAP.correctionLog.url },
    { id: 'desk', labelKey: 'links.desk', url: CONTENT_MAP.desk.default.url },
    { id: 'basics', labelKey: basics === CONTENT_MAP.basics.part4 ? 'links.basicsPart4' : 'links.basics', url: basics.url },
  ];
}
