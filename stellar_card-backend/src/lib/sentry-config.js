// @ts-check
// Sentry error tracking configuration and integration.
// Initializes Sentry for production error tracking and profiling.

const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const IS_PROD = process.env.NODE_ENV === 'production';
const SENTRY_DSN = process.env.SENTRY_DSN;

/**
 * Initialize Sentry for error tracking and performance monitoring.
 * Should be called at the very beginning of the application startup
 * before any other code runs.
 *
 * In production, requires SENTRY_DSN to be set in environment.
 * In development/test, Sentry is initialized but with a test configuration.
 */
function initSentry() {
  if (!IS_PROD) {
    // Dev/test mode: initialize with minimal config for local testing
    Sentry.init({
      dsn: SENTRY_DSN || '',
      tracesSampleRate: 0.1,
      environment: process.env.NODE_ENV || 'development',
      enabled: false, // Disabled in development/test to avoid sending events
    });
    return;
  }

  // Production configuration
  if (!SENTRY_DSN) {
    console.warn('[sentry] SENTRY_DSN not configured in production — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1, // Sample 10% of transactions for performance monitoring
    profilesSampleRate: 0.1, // Sample 10% of transactions for profiling
    integrations: [
      new Sentry.Integrations.OnUncaughtException({
        exitEvenIfOtherHandlersAreRegistered: false, // Don't exit process on uncaught exception
      }),
      new Sentry.Integrations.OnUnhandledRejection({
        mode: 'strict',
      }),
      nodeProfilingIntegration(),
    ],
    // Attachment options for additional context
    attachStacktrace: true,
    // Ignore specific errors that are expected and don't need tracking
    ignoreErrors: [
      'NetworkError: Failed to fetch', // Client-side network errors
      'NotSupportedError', // Browser API not available
    ],
    beforeSend(event, hint) {
      // Filter out sensitive information before sending to Sentry
      if (event.request) {
        // Remove Authorization headers
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['Authorization'];
        }
      }
      // Sanitize breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
          if (breadcrumb.data?.authorization) {
            delete breadcrumb.data.authorization;
          }
          return breadcrumb;
        });
      }
      return event;
    },
  });

  console.log(
    '[sentry] Initialized error tracking (dsn=%s, env=%s)',
    SENTRY_DSN.substring(0, 20) + '...',
    process.env.NODE_ENV,
  );
}

/**
 * Capture an error with context.
 * @param {Error} error
 * @param {Record<string, unknown>} [context]
 */
function captureException(error, context = {}) {
  if (!IS_PROD) return;

  Sentry.captureException(error, {
    tags: /** @type {Record<string, string>} */(context.tags || {}),
    extra: /** @type {Record<string, unknown>} */(context.extra || {}),
  });
}

/**
 * Capture a message with context.
 * @param {string} message
 * @param {'fatal'|'error'|'warning'|'info'|'debug'} [level='info']
 * @param {Record<string, unknown>} [context]
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!IS_PROD) return;

  Sentry.captureMessage(message, {
    level,
    tags: /** @type {Record<string, string>} */(context.tags || {}),
    extra: /** @type {Record<string, unknown>} */(context.extra || {}),
  });
}

/**
 * Set user context for error tracking.
 * @param {string} userId
 * @param {Record<string, unknown>} [metadata]
 */
function setUserContext(userId, metadata = {}) {
  if (!IS_PROD) return;

  Sentry.setUser({
    id: userId,
    ...metadata,
  });
}

/**
 * Clear user context.
 */
function clearUserContext() {
  if (!IS_PROD) return;
  Sentry.setUser(null);
}

/**
 * Create a Sentry Request Handler middleware for Express.
 * Captures request/response errors automatically.
 * Must be used BEFORE other error handlers.
 */
function sentryRequestHandler() {
  if (!IS_PROD) {
    return (_req, _res, next) => next();
  }
  return Sentry.Handlers.requestHandler();
}

/**
 * Create a Sentry Error Handler middleware for Express.
 * Must be used AFTER all other middlewares and route handlers.
 */
function sentryErrorHandler() {
  if (!IS_PROD) {
    return (_err, _req, _res, next) => next(_err);
  }
  return Sentry.Handlers.errorHandler();
}

module.exports = {
  Sentry,
  initSentry,
  captureException,
  captureMessage,
  setUserContext,
  clearUserContext,
  sentryRequestHandler,
  sentryErrorHandler,
};
