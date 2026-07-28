# Sentry Error Tracking Setup Guide

## Overview

Sentry is an error tracking and performance monitoring service that helps identify, triage, and resolve production issues in real-time. This guide explains how to set up and configure Sentry for the Stellar_Card backend.

## Features

- **Real-time error tracking**: Capture and alert on exceptions and errors
- **Performance monitoring**: Track slow transactions and API latency
- **Profiling**: Analyze CPU and memory usage
- **Error context**: Automatic capture of user, environment, and request data
- **Sensitive data filtering**: Automatic removal of authorization headers and sensitive information
- **Custom events**: Track business logic errors and custom metrics

## Setup Instructions

### 1. Create a Sentry Project

1. Go to [https://sentry.io/](https://sentry.io/)
2. Sign in or create an account
3. Create a new project:
   - Platform: **Node.js**
   - Alert frequency: **As it happens** (or your preference)
4. After project creation, you'll receive a **DSN** (Data Source Name)

### 2. Configure Environment Variables

Add your Sentry DSN to your `.env` file:

```bash
# Production only
SENTRY_DSN=https://<public_key>@<host>.ingest.sentry.io/<project_id>
```

The DSN format is: `https://<publicKey>@<host>.ingest.sentry.io/<projectId>`

### 3. Initialize Sentry in Your Application

The Sentry configuration is automatically initialized when the application starts. Ensure your application calls:

```javascript
const { initSentry } = require('./lib/sentry-config');

// Call at the very beginning of application startup
initSentry();

// Then initialize Express middleware
const { sentryRequestHandler, sentryErrorHandler } = require('./lib/sentry-config');

app.use(sentryRequestHandler());
// ... your routes ...
app.use(sentryErrorHandler());
```

### 4. Verify Configuration

Test that Sentry is working by sending a test event:

```bash
# In development (with SENTRY_DSN set)
NODE_ENV=production node -e "
const { initSentry, captureMessage } = require('./src/lib/sentry-config');
initSentry();
captureMessage('Test event from Stellar_Card backend', 'info');
console.log('Test event sent to Sentry');
"
```

Then check your Sentry dashboard to confirm the event was received.

## Usage

### Automatic Error Tracking

The following errors are automatically captured and sent to Sentry:

- Uncaught exceptions
- Unhandled promise rejections
- Error-level log messages via `logger.log('error', ...)`
- Express middleware errors

### Manual Error Reporting

Capture specific errors or messages:

```javascript
const { captureException, captureMessage } = require('./lib/sentry-config');

// Capture an exception
try {
  // some operation
} catch (err) {
  captureException(err, {
    tags: { operation: 'payment-processing' },
    extra: { order_id: '12345' }
  });
}

// Capture a message
captureMessage('Payment processing completed', 'info', {
  extra: { order_id: '12345', amount: '100.00' }
});
```

### Setting User Context

Track which user triggered an error:

```javascript
const { setUserContext, clearUserContext } = require('./lib/sentry-config');

// Set user context when user is authenticated
setUserContext(userId, {
  email: user.email,
  platform_id: user.platform_id,
});

// Clear context when user logs out
clearUserContext();
```

## Configuration Details

### Sampling Rates

By default:
- **Transaction sampling**: 10% of all transactions are sampled for performance monitoring
- **Profile sampling**: 10% of sampled transactions are profiled for CPU/memory analysis

Adjust in `src/lib/sentry-config.js`:

```javascript
Sentry.init({
  tracesSampleRate: 0.1,  // 10% sampling
  profilesSampleRate: 0.1, // 10% of traced transactions
});
```

### Sensitive Data Filtering

The following sensitive data is automatically filtered before sending to Sentry:

- Authorization headers (Bearer tokens, API keys)
- Session cookies
- Custom headers containing sensitive information

Additional filtering can be configured in the `beforeSend` hook within `src/lib/sentry-config.js`.

## Environment Behavior

### Production (`NODE_ENV=production`)

- **Enabled**: Yes, if `SENTRY_DSN` is configured
- **Sample rate**: 10% (configurable)
- **Profiling**: Enabled
- **Error routing**: All errors sent to Sentry

### Development/Test (`NODE_ENV=development` or `test`)

- **Enabled**: No (events not sent to Sentry)
- **Configuration**: Initialized but disabled
- **Use case**: Local development and testing

This prevents cluttering your Sentry dashboard with local development errors.

## Monitoring and Alerts

### Setting Up Alerts

1. Go to your Sentry project settings
2. Navigate to **Alerts** → **Alert Rules**
3. Create an alert rule:
   - **Trigger**: `An event is seen`
   - **Filter**: Select issue type (errors, performance, etc.)
   - **Action**: Email, Slack, webhook, etc.

### Common Alert Scenarios

- **Error spike**: Alert when error rate increases suddenly
- **New issue**: Alert on first occurrence of a new error
- **Critical errors**: Alert for errors with specific tags
- **Performance degradation**: Alert when transaction latency increases

## Troubleshooting

### Events Not Appearing in Sentry

1. **Check DSN**: Verify `SENTRY_DSN` is set correctly
2. **Check environment**: Ensure `NODE_ENV=production`
3. **Check logs**: Look for `[sentry]` initialization messages in stdout
4. **Test DSN**: Use the verification command from "Verify Configuration" section above
5. **Network**: Ensure your server can reach `*.ingest.sentry.io`

### High Sampling Rate

If you're seeing too many events:

1. Reduce `tracesSampleRate` and `profilesSampleRate` in `src/lib/sentry-config.js`
2. Add additional filtering in the `beforeSend` hook
3. Configure server-side sampling in your Sentry project settings

### Performance Impact

Sentry has minimal performance impact:

- Request handler middleware: ~1ms per request
- Error handler middleware: Only invoked on errors
- Event sending: Asynchronous, non-blocking
- Sampling: Reduces event volume and cost

## Best Practices

1. **Tag errors consistently**: Use tags to categorize errors by type, service, or environment
2. **Add context**: Include order IDs, user IDs, and other relevant identifiers
3. **Monitor production only**: Use environment variables to disable in development
4. **Set sampling appropriately**: Balance cost vs. visibility
5. **Review alerts regularly**: Ensure alert rules match your incident response process
6. **Sanitize sensitive data**: Never include passwords, keys, or PII in custom fields

## Integration with Logger

The logger module automatically sends error-level logs to Sentry:

```javascript
const { log } = require('./lib/logger');

// This automatically sends to Sentry in production
log('error', 'Payment processing failed', {
  order_id: '12345',
  reason: 'insufficient_balance'
});
```

## References

- [Sentry Documentation](https://docs.sentry.io/)
- [Sentry Node.js Integration](https://docs.sentry.io/platforms/node/)
- [Performance Monitoring](https://docs.sentry.io/platforms/node/performance/)
- [Profiling Guide](https://docs.sentry.io/product/profiling/)
