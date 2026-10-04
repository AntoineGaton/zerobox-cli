/**
 * @module limits
 * Gmail pacing limits shared by the API layer, the apply step and the UI.
 */

/**
 * messages.trash costs 5 quota units: 30/s is 150 units/s, well under the
 * 250/s per-user limit, leaving room for retries and other calls.
 * 22,000 messages take about 12 minutes.
 */
export const TRASH_PER_SECOND = 30;

/** Gmail sends cost 100 quota units: at most one unsubscribe email per second. */
export const MAILTO_GAP_MS = 1000;

/** Gmail caps sending at about 500 messages a day (consumer accounts): stay below. */
export const MAILTO_MAX_PER_RUN = 400;

/** For estimates only: one-click POSTs run 4 at a time, roughly 5 a second. */
export const ONE_CLICK_PER_SECOND = 5;

/** For estimates only: filter creation, roughly 5 a second. */
export const FILTERS_PER_SECOND = 5;
