# Production Deployment Checklist

This guide covers deploying stellar_card SDK to production.

## Pre-Deployment

### 1. Environment Setup
- [ ] Set `CARDS402_API_KEY` in secure environment (secrets manager, not hardcoded)
- [ ] Set `CARDS402_BASE_URL` to production endpoint (default: https://api.stellar_card.com/v1)
- [ ] Set `NODE_ENV=production` to disable debug logging
- [ ] Configure custom `OWS_VAULT_PATH` if needed (default: ~/.stellar-card/wallets)

### 2. Wallet Configuration
- [ ] Run `stellar_card onboard --claim <code>` once to create wallet
- [ ] Verify wallet address: `stellar_card wallet address`
- [ ] Fund wallet with initial balance (minimum 2 XLM + 10 USDC)
- [ ] Test trustline creation: `stellar_card wallet trustline`
- [ ] Verify configuration persists: `cat ~/.stellar_card/config.json`

### 3. Testing
- [ ] Run unit tests: `npm run test`
- [ ] Test with staging API key first
- [ ] Perform test purchase: `node examples/basic-purchase.js`
- [ ] Verify error handling (insufficient balance, rate limits)
- [ ] Test payment asset selection (USDC vs XLM)

### 4. Security
- [ ] Audit environment variable handling in code
- [ ] Verify no secrets in logs (enable log sanitization)
- [ ] Test passphrase entropy (minimum 12 characters)
- [ ] Rotate API key if exposed during development
- [ ] Enable API rate limiting on backend if available
- [ ] Review and test error messages for info leaks

### 5. Monitoring Setup
- [ ] Configure log aggregation (CloudWatch, Stackdriver, etc.)
- [ ] Set up alerts for:
  - [ ] Failed purchases
  - [ ] Rate limit errors
  - [ ] Wallet balance drops below threshold
  - [ ] Timeout errors
- [ ] Enable metrics collection (purchases/min, latency, errors)
- [ ] Set up periodic health checks

### 6. Performance
- [ ] Profile purchase flow for latency
- [ ] Test batch operations (5, 10, 25+ concurrent)
- [ ] Verify connection pooling is working
- [ ] Check memory usage under load
- [ ] Test with expected QPS (queries per second)

### 7. Disaster Recovery
- [ ] Document wallet recovery procedure
- [ ] Test wallet backup and restore
- [ ] Create runbook for common failure scenarios
- [ ] Set up on-call rotation
- [ ] Document escalation procedures

## Deployment Day

### 1. Final Checks
- [ ] Verify API key is correct for production
- [ ] Check wallet has sufficient balance
- [ ] Verify log level is appropriate (warn/error in prod)
- [ ] Confirm monitoring is active
- [ ] Review recent error logs for anomalies

### 2. Canary Deployment (if applicable)
- [ ] Deploy to 5-10% of traffic first
- [ ] Monitor error rates and latency for 30+ minutes
- [ ] Compare to baseline metrics
- [ ] Gradually increase traffic to 100%

### 3. Post-Deployment
- [ ] Monitor error rate (should be <0.1%)
- [ ] Verify average latency (<5s for most purchases)
- [ ] Check for any new error patterns
- [ ] Confirm alerts are triggering correctly
- [ ] Review first 100 orders for issues

## Ongoing Operations

### Daily
- [ ] Check wallet balance (alert if <$100 remaining)
- [ ] Review error logs for patterns
- [ ] Verify no rate limit errors

### Weekly
- [ ] Generate cost report (see cost-optimization.js)
- [ ] Analyze purchase success rate
- [ ] Review performance metrics
- [ ] Check for SDK version updates

### Monthly
- [ ] Full system capacity test
- [ ] Security audit of environment
- [ ] Update API key if approaching rotation schedule
- [ ] Review and update runbooks

## Troubleshooting

### High Error Rates
1. Check wallet balance
2. Verify API key is correct
3. Check network connectivity
4. Review error logs for specific errors
5. Check Stellar network status

### Slow Purchases
1. Check network latency to stellar_card.com
2. Verify Stellar network is healthy
3. Check for concurrent purchases (might be rate limited)
4. Enable debug logging to see RPC calls

### Rate Limiting
1. Implement exponential backoff (see retry-strategy.js)
2. Reduce concurrent purchase attempts
3. Batch smaller requests into larger ones
4. Contact support for rate limit increase

### Wallet Issues
1. Verify wallet password is correct
2. Check disk space for wallet storage
3. Restore from backup if corrupted
4. Create new wallet if recovery fails

## Rollback Procedure

If critical issue discovered after deployment:

1. Stop accepting new purchases
2. Revert to previous version
3. Investigate root cause
4. Test thoroughly before re-deploying
5. Post-mortem on what went wrong

## Support

- Documentation: https://stellar_card.com/docs
- Status Page: https://status.stellar_card.com
- Support: support@stellar_card.com
- Discord: https://stellar_card.com/discord
