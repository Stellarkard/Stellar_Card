require('../helpers/env');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');
const express = require('express');
const { createOrderCreateLimiter } = require('../../src/api/orders');

describe('Order Creation Rate Limiter (Part 4)', () => {
  it('allows requests within limit and blocks requests exceeding limit with 429 rate_limit_exceeded', async () => {
    const limiter = createOrderCreateLimiter({
      windowMs: 60 * 1000,
      limit: () => 2, // low limit for test
    });

    const app = express();
    app.use((req, res, next) => {
      req.apiKey = { id: 'key_test_123', rate_limit_rpm: 2 };
      next();
    });
    app.post('/orders', limiter, (req, res) => res.status(201).json({ ok: true }));

    // Request 1: success
    const res1 = await supertest(app).post('/orders');
    assert.equal(res1.status, 201);

    // Request 2: success
    const res2 = await supertest(app).post('/orders');
    assert.equal(res2.status, 201);

    // Request 3: blocked with 429
    const res3 = await supertest(app).post('/orders');
    assert.equal(res3.status, 429);
    assert.equal(res3.body.error, 'rate_limit_exceeded');
    assert.match(res3.body.message, /Too many orders created/);
  });

  it('calculates hourly limit based on apiKey.rate_limit_rpm', async () => {
    const limiter = createOrderCreateLimiter({
      windowMs: 60 * 1000,
    });

    let currentLimit = 0;
    const testApp = express();
    testApp.use((req, res, next) => {
      req.apiKey = { id: 'key_rpm_test', rate_limit_rpm: 5 };
      next();
    });
    testApp.post('/orders', limiter, (req, res) => {
      // @ts-ignore
      currentLimit = req.rateLimit.limit;
      res.status(200).json({ ok: true });
    });

    await supertest(testApp).post('/orders');
    // rate_limit_rpm = 5 -> converted limit is 5 * 60 = 300
    assert.equal(currentLimit, 300);
  });
});
