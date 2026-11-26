import { describe, it, expect } from 'vitest';
import { calculateOverallUptime, generateMockUptimeData } from '../components/UptimeHistory';

describe('Uptime Calculations', () => {
  it('calculates 100% uptime when all days are operational', () => {
    const data = [
      { date: '2024-01-01', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 100 },
      { date: '2024-01-02', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 100 },
      { date: '2024-01-03', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 100 },
    ];
    expect(calculateOverallUptime(data)).toBe(100);
  });

  it('calculates average uptime correctly with mixed days', () => {
    const data = [
      { date: '2024-01-01', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 100 },
      { date: '2024-01-02', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 50 },
      { date: '2024-01-03', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 0 },
    ];
    expect(calculateOverallUptime(data)).toBe(50);
  });

  it('handles empty array', () => {
    expect(calculateOverallUptime([])).toBe(100);
  });

  it('calculates correct uptime for 90 days of perfect operational data', () => {
    const data = generateMockUptimeData().map((d) => ({ ...d, uptimePercent: 100 }));
    expect(calculateOverallUptime(data)).toBe(100);
  });

  it('generates 90 days of mock data', () => {
    const data = generateMockUptimeData();
    expect(data.length).toBe(90);
    expect(data[0].date).toBeDefined();
    expect(data[89].date).toBeDefined();
  });

  it('generates data with valid status values', () => {
    const data = generateMockUptimeData();
    const validStatuses = ['operational', 'degraded', 'outage'];
    data.forEach((day) => {
      expect(validStatuses).toContain(day.api);
      expect(validStatuses).toContain(day.horizon);
      expect(validStatuses).toContain(day.cardIssuance);
      expect(day.uptimePercent).toBeGreaterThanOrEqual(0);
      expect(day.uptimePercent).toBeLessThanOrEqual(100);
    });
  });

  it('calculates 99.9% uptime correctly with one minor incident', () => {
    const data = Array.from({ length: 90 }, (_, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, '0')}`,
      api: 'operational' as const,
      horizon: 'operational' as const,
      cardIssuance: 'operational' as const,
      uptimePercent: i === 0 ? 95 : 100,
    }));
    const result = calculateOverallUptime(data);
    expect(result).toBeCloseTo(99.94, 1);
  });

  it('calculates uptime with decimal precision', () => {
    const data = [
      { date: '2024-01-01', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 99.5 },
      { date: '2024-01-02', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 99.9 },
      { date: '2024-01-03', api: 'operational', horizon: 'operational', cardIssuance: 'operational', uptimePercent: 100 },
    ];
    expect(calculateOverallUptime(data)).toBeCloseTo(99.8, 1);
  });
});