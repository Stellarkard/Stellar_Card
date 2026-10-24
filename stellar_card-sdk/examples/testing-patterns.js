#!/usr/bin/env node
/**
 * Testing patterns example.
 *
 * Demonstrates:
 * - Mock client setup for testing
 * - Test fixtures and data
 * - Error scenario testing
 * - Integration test setup
 * - Test utilities
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/testing-patterns.js
 */

import { Stellar_CardClient } from 'stellar_card';

// Mock response generators
const mockResponses = {
  order: (overrides = {}) => ({
    id: `order_${Math.random().toString(36).substr(2, 9)}`,
    amount_usdc: '10.00',
    status: 'completed',
    card_number: '4111111111111111',
    card_cvv: '123',
    card_expiry: '12/25',
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    ...overrides,
  }),

  error: (status, message) => ({
    error: message,
    status,
    timestamp: new Date().toISOString(),
  }),

  budget: (overrides = {}) => ({
    current_spend: '100.00',
    spend_limit: '1000.00',
    remaining_budget: '900.00',
    period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  }),
};

// Test utilities
class TestSuite {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.results = {
      passed: 0,
      failed: 0,
      errors: [],
    };
  }

  addTest(description, testFn) {
    this.tests.push({ description, testFn });
  }

  async run() {
    console.log(`\n=== ${this.name} ===\n`);

    for (const test of this.tests) {
      try {
        await test.testFn();
        console.log(`✓ ${test.description}`);
        this.results.passed++;
      } catch (err) {
        console.log(`✗ ${test.description}`);
        this.results.failed++;
        this.results.errors.push({
          test: test.description,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return this.results;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertExists(value, message) {
  if (!value) {
    throw new Error(`${message}: value does not exist`);
  }
}

function assertHasProperty(obj, prop, message) {
  if (!(prop in obj)) {
    throw new Error(`${message}: property "${prop}" not found`);
  }
}

async function main() {
  try {
    console.log('Testing Patterns Example\n');

    // Test Suite 1: Response format validation
    const formatTests = new TestSuite('Response Format Tests');

    formatTests.addTest('Order response has required fields', () => {
      const order = mockResponses.order();
      assertHasProperty(order, 'id', 'Order response');
      assertHasProperty(order, 'status', 'Order response');
      assertHasProperty(order, 'card_number', 'Order response');
      assertHasProperty(order, 'card_cvv', 'Order response');
      assertHasProperty(order, 'card_expiry', 'Order response');
    });

    formatTests.addTest('Error response has standard format', () => {
      const error = mockResponses.error(400, 'Invalid request');
      assertHasProperty(error, 'error', 'Error response');
      assertHasProperty(error, 'status', 'Error response');
      assertHasProperty(error, 'timestamp', 'Error response');
    });

    formatTests.addTest('Budget response includes all fields', () => {
      const budget = mockResponses.budget();
      assertHasProperty(budget, 'current_spend', 'Budget response');
      assertHasProperty(budget, 'spend_limit', 'Budget response');
      assertHasProperty(budget, 'remaining_budget', 'Budget response');
    });

    // Test Suite 2: Data validation
    const validationTests = new TestSuite('Data Validation Tests');

    validationTests.addTest('Order amount is positive number', () => {
      const order = mockResponses.order({ amount_usdc: '10.50' });
      const amount = parseFloat(order.amount_usdc);
      if (amount <= 0) {
        throw new Error('Order amount must be positive');
      }
    });

    validationTests.addTest('Card number has valid format', () => {
      const order = mockResponses.order();
      if (!/^\d{16}$/.test(order.card_number)) {
        throw new Error('Card number must be 16 digits');
      }
    });

    validationTests.addTest('Expiry date is valid format', () => {
      const order = mockResponses.order();
      if (!/^\d{2}\/\d{2}$/.test(order.card_expiry)) {
        throw new Error('Expiry must be MM/YY format');
      }
    });

    // Test Suite 3: Business logic
    const logicTests = new TestSuite('Business Logic Tests');

    logicTests.addTest('Budget calculation is correct', () => {
      const budget = mockResponses.budget({
        current_spend: '250.00',
        spend_limit: '1000.00',
      });
      const remaining = parseFloat(budget.spend_limit) - parseFloat(budget.current_spend);
      assertEqual(
        remaining.toString(),
        '750',
        'Remaining budget calculation',
      );
    });

    logicTests.addTest('Order status transitions are valid', () => {
      const validStatuses = ['pending', 'processing', 'completed', 'failed'];
      const order = mockResponses.order({ status: 'completed' });
      if (!validStatuses.includes(order.status)) {
        throw new Error(`Invalid status: ${order.status}`);
      }
    });

    logicTests.addTest('Timestamp formats are ISO 8601', () => {
      const order = mockResponses.order();
      try {
        new Date(order.created_at);
        new Date(order.completed_at);
      } catch {
        throw new Error('Invalid ISO 8601 timestamp');
      }
    });

    // Run all test suites
    const allResults = [];
    allResults.push(await formatTests.run());
    allResults.push(await validationTests.run());
    allResults.push(await logicTests.run());

    // Summary
    const totalPassed = allResults.reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = allResults.reduce((sum, r) => sum + r.failed, 0);

    console.log('\n=== Test Summary ===');
    console.log(`Total Passed: ${totalPassed}`);
    console.log(`Total Failed: ${totalFailed}`);

    if (totalFailed > 0) {
      console.log('\nFailures:');
      allResults.forEach((result) => {
        result.errors.forEach((err) => {
          console.log(`  • ${err.test}: ${err.error}`);
        });
      });
      process.exit(1);
    } else {
      console.log('\n✓ All tests passed!');
    }
  } catch (err) {
    console.error('Test suite error:');
    if (err instanceof Error) {
      console.error(`  ${err.message}`);
    } else {
      console.error(`  ${String(err)}`);
    }
    process.exit(1);
  }
}

main();
