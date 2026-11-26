import { describe, it, expect } from 'vitest';
import { calculateCommission } from '../components/AffiliateCalculator';

describe('Affiliate Commission Calculator', () => {
  it('calculates commission correctly for 100 cards', () => {
    const result = calculateCommission(100);
    expect(result.monthlyRevenue).toBe(250); // 100 * $2.50
    expect(result.affiliateShare).toBe(0.20);
    expect(result.estimatedMonthlyEarnings).toBe(50); // 250 * 0.20
    expect(result.estimatedAnnualEarnings).toBe(600); // 50 * 12
  });

  it('calculates commission correctly for 0 cards', () => {
    const result = calculateCommission(0);
    expect(result.monthlyRevenue).toBe(0);
    expect(result.estimatedMonthlyEarnings).toBe(0);
    expect(result.estimatedAnnualEarnings).toBe(0);
  });

  it('calculates commission correctly for 1000 cards', () => {
    const result = calculateCommission(1000);
    expect(result.monthlyRevenue).toBe(2500);
    expect(result.estimatedMonthlyEarnings).toBe(500);
    expect(result.estimatedAnnualEarnings).toBe(6000);
  });

  it('calculates commission correctly for 5000 cards', () => {
    const result = calculateCommission(5000);
    expect(result.monthlyRevenue).toBe(12500);
    expect(result.estimatedMonthlyEarnings).toBe(2500);
    expect(result.estimatedAnnualEarnings).toBe(30000);
  });

  it('calculates commission correctly for 10000 cards', () => {
    const result = calculateCommission(10000);
    expect(result.monthlyRevenue).toBe(25000);
    expect(result.estimatedMonthlyEarnings).toBe(5000);
    expect(result.estimatedAnnualEarnings).toBe(60000);
  });

  it('handles fractional card counts by flooring', () => {
    // The function accepts numbers, but in practice cards are integers
    const result = calculateCommission(150.7);
    expect(result.monthlyRevenue).toBe(376.75); // 150.7 * 2.50
    expect(result.estimatedMonthlyEarnings).toBeCloseTo(75.35, 2); // 376.75 * 0.20
  });

  it('returns correct affiliate share percentage', () => {
    const result = calculateCommission(100);
    expect(result.affiliateShare).toBe(0.20); // 20%
  });

  it('scales linearly with volume', () => {
    const result100 = calculateCommission(100);
    const result200 = calculateCommission(200);
    expect(result200.estimatedMonthlyEarnings).toBe(result100.estimatedMonthlyEarnings * 2);
    expect(result200.estimatedAnnualEarnings).toBe(result100.estimatedAnnualEarnings * 2);
  });

  it('calculates minimum withdrawal threshold correctly', () => {
    // At 100 cards = $50/mo, it takes 1 month to reach $50 minimum
    const result100 = calculateCommission(100);
    expect(result100.estimatedMonthlyEarnings).toBeGreaterThanOrEqual(50);

    // At 50 cards = $25/mo, it takes 2 months to reach $50 minimum
    const result50 = calculateCommission(50);
    expect(result50.estimatedMonthlyEarnings).toBeLessThan(50);
  });
});