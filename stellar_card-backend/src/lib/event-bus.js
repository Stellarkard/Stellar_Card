// @ts-check
// In-process event bus for real-time dashboard updates.
//
// Every state change that should appear live in the admin or per-user
// dashboard emits exactly one event here. SSE endpoints (/admin/stream,
// /dashboard/stream) subscribe and forward matching events to connected
// clients.
//
// Events are NOT persisted — subscribers see only events that happen
// while they're connected. On reconnect, the client refetches the full
// state from the REST endpoints and then starts listening again. This
// keeps the bus cheap (no outbox, no replay) while giving instant
// updates for the 99% case.
//
// Event shapes (all carry `type` + payload):
//
//   { type: 'agent_state', api_key_id, state, wallet_public_key, detail, at }
//     - fired when an agent reports via POST /v1/agent/status or when the
//       backend derives a new state (e.g. first delivered order → 'active')
//
//   { type: 'order', order_id, api_key_id, status, phase, updated_at }
//     - fired on every orders row update
//
//   { type: 'approval', approval_id, api_key_id, order_id, status, updated_at }
//     - fired when an approval is requested, approved, rejected, or expires
//
//   { type: 'key', api_key_id, action, at }
//     - fired on key lifecycle events: created, suspended, unsuspended,
//       rotated, deleted
//
//   { type: 'system', frozen, consecutive_failures, at }
//     - fired when the system-state row changes
//
// Consumers that only care about a subset filter on `type`.

const { EventEmitter } = require('events');

const bus = new EventEmitter();
// No hard cap — SSE clients come and go, and accidental over-subscription
// should be caught by the max-listeners warning not a silent drop.
bus.setMaxListeners(1000);

/**
 * Emit a dashboard event. Swallows listener errors so a misbehaving SSE
 * client can't take down the write path.
 *
 * Adversarial audit F1-event-bus (2026-04-15): payload spread must
 * come FIRST, then the controlled `type` and `at` fields overlay on
 * top. The previous order `{ type, at, ...payload }` meant a caller
 * that passed a payload containing its own `type` or `at` field
 * would silently overwrite the event's type — JavaScript spread
 * precedence: the later key wins. No current caller triggers this
 * because they construct explicit payload objects, but a future
 * caller doing `emitBusEvent('order', { ...row })` where row has a
 * `type` column would misroute every event to whatever the row's
 * type happened to be. Controlled-field-overlay-after-spread makes
 * the precedence structurally safe.
 *
 * F2-event-bus (2026-04-15): Object.freeze the final event so
 * listeners can't mutate the shared reference. EventEmitter passes
 * the same object to every listener synchronously — a mutating
 * listener (accidental or not) affects all subsequent listeners.
 * Sloppy-mode writes to a frozen object silently fail; strict-mode
 * throws; the listener's own try/catch inside `wrapped` catches
 * the throw either way.
 *
 * @param {string} type
 * @param {object} payload
 */
function emit(type, payload) {
  try {
    const event = Object.freeze({
      ...payload,
      type,
      at: new Date().toISOString(),
    });
    bus.emit('event', event);
  } catch (err) {
    /* never throw — dashboard is best-effort */
    console.error('[event-bus] emit failed:', err);
  }
}

/**
 * Subscribe to events. Returns a disposer.
 *
 * Handles both synchronous throws AND async rejections — the previous
 * implementation only caught sync errors, so an async handler
 * (e.g. one that does `await db.query(...)` inside) that rejected
 * would escape as an unhandled promise rejection. The listener would
 * appear subscribed but every event it received would silently fail,
 * with the only signal being a node-level rejection warning on stderr.
 * Adversarial audit F1-event-bus.
 *
 * @param {(evt: object) => void | Promise<void>} handler
 */
function subscribe(handler) {
  const wrapped = (evt) => {
    try {
      const result = handler(evt);
      // If the handler returned a thenable, also catch its rejection.
      // Use .then(noop, errorHandler) rather than .catch so a non-
      // Promise thenable without a .catch method still works.
      if (result && typeof (/** @type {any} */ (result).then) === 'function') {
        /** @type {any} */ (result).then(undefined, (err) => {
          console.error('[event-bus] async handler rejected:', err);
        });
      }
    } catch (err) {
      console.error('[event-bus] handler threw:', err);
    }
  };
  bus.on('event', wrapped);
  return () => bus.off('event', wrapped);
}

/**
 * Current number of subscribers. Exposed for observability so ops
 * can catch a leaked-disposer bug (a stream-close path that forgets
 * to unsubscribe) before the silent max-listeners warning fires at
 * 1000. Adversarial audit F2-event-bus.
 */
function listenerCount() {
  return bus.listenerCount('event');
}

// ---------------------------------------------------------------------------
// Order lifecycle event constants and typed emitters (#984)
//
// These build on the generic emit/subscribe primitives above. Each constant
// is the value of the `type` field that listeners can filter on.  The typed
// helpers enforce a consistent payload shape so callers don't have to
// remember field names or risk type divergence between emitters and listeners.
//
// Event shapes:
//
//   ORDER_CREATED  → { type, order_id, api_key_id, amount_usdc, currency,
//                       merchant_id, at }
//   ORDER_PAID     → { type, order_id, api_key_id, amount_usdc, tx_hash,
//                       stellar_tx_id, at }
//   ORDER_FULFILLED→ { type, order_id, api_key_id, card_last4, fulfilled_at,
//                       at }
//   ORDER_FAILED   → { type, order_id, api_key_id, reason, at }
// ---------------------------------------------------------------------------

/** @type {'order:created'} */
const ORDER_CREATED = 'order:created';
/** @type {'order:paid'} */
const ORDER_PAID = 'order:paid';
/** @type {'order:fulfilled'} */
const ORDER_FULFILLED = 'order:fulfilled';
/** @type {'order:failed'} */
const ORDER_FAILED = 'order:failed';

/**
 * @param {{ order_id: string; api_key_id: string; amount_usdc: number;
 *            currency?: string; merchant_id?: string }} payload
 */
function emitOrderCreated(payload) {
  emit(ORDER_CREATED, {
    order_id: payload.order_id,
    api_key_id: payload.api_key_id,
    amount_usdc: payload.amount_usdc,
    currency: payload.currency ?? 'USDC',
    merchant_id: payload.merchant_id ?? null,
  });
}

/**
 * @param {{ order_id: string; api_key_id: string; amount_usdc: number;
 *            tx_hash?: string; stellar_tx_id?: string }} payload
 */
function emitOrderPaid(payload) {
  emit(ORDER_PAID, {
    order_id: payload.order_id,
    api_key_id: payload.api_key_id,
    amount_usdc: payload.amount_usdc,
    tx_hash: payload.tx_hash ?? null,
    stellar_tx_id: payload.stellar_tx_id ?? null,
  });
}

/**
 * @param {{ order_id: string; api_key_id: string; card_last4?: string;
 *            fulfilled_at?: string }} payload
 */
function emitOrderFulfilled(payload) {
  emit(ORDER_FULFILLED, {
    order_id: payload.order_id,
    api_key_id: payload.api_key_id,
    card_last4: payload.card_last4 ?? null,
    fulfilled_at: payload.fulfilled_at ?? new Date().toISOString(),
  });
}

/**
 * @param {{ order_id: string; api_key_id: string; reason: string }} payload
 */
function emitOrderFailed(payload) {
  emit(ORDER_FAILED, {
    order_id: payload.order_id,
    api_key_id: payload.api_key_id,
    reason: payload.reason,
  });
}

module.exports = {
  emit,
  subscribe,
  listenerCount,
  ORDER_CREATED,
  ORDER_PAID,
  ORDER_FULFILLED,
  ORDER_FAILED,
  emitOrderCreated,
  emitOrderPaid,
  emitOrderFulfilled,
  emitOrderFailed,
};
