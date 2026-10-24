#!/usr/bin/env node
/**
 * Monitoring and analytics example.
 *
 * Demonstrates:
 * - Collecting purchase metrics
 * - Tracking spending patterns
 * - Monitoring wallet health
 * - Generating analytics reports
 * - Setting up alerts
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/monitoring-and-analytics.js
 */

import { Stellar_CardClient, getOWSBalance, getOWSPublicKey } from 'stellar_card';
import * as fs from 'fs';
import * as path from 'path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class WalletMonitor {
  constructor(apiKey, walletName) {
    this.apiKey = apiKey;
    this.walletName = walletName;
    this.client = new Stellar_CardClient({ apiKey });
    this.metrics = {
      startTime: Date.now(),
      purchases: [],
      balanceHistory: [],
      alerts: [],
    };
  }

  async collectMetrics() {
    try {
      // Get wallet info
      const publicKey = await getOWSPublicKey(this.walletName);
      const balance = await getOWSBalance(this.walletName);

      this.metrics.walletAddress = publicKey;
      this.metrics.balanceHistory.push({
        timestamp: new Date().toISOString(),
        xlm: parseFloat(balance.xlm),
        usdc: parseFloat(balance.usdc),
      });

      // Get recent orders
      const orders = await this.client.listOrders({ limit: 50 });

      for (const order of orders) {
        this.metrics.purchases.push({
          orderId: order.id,
          amount: parseFloat(order.amount_usdc),
          status: order.status,
          createdAt: order.created_at,
          completedAt: order.completed_at,
        });
      }

      return this.metrics;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.metrics.alerts.push({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: `Failed to collect metrics: ${errorMsg}`,
      });
      throw err;
    }
  }

  getAnalytics() {
    const purchases = this.metrics.purchases;
    if (purchases.length === 0) {
      return {
        totalPurchases: 0,
        totalSpent: 0,
        averagePurchase: 0,
        dailyAverage: 0,
        hourlyAverage: 0,
      };
    }

    const totalSpent = purchases.reduce((sum, p) => sum + p.amount, 0);
    const successfulPurchases = purchases.filter((p) => p.status === 'completed');

    const timespan = Date.now() - this.metrics.startTime;
    const daysActive = timespan / (1000 * 60 * 60 * 24);
    const hoursActive = timespan / (1000 * 60 * 60);

    return {
      totalPurchases: purchases.length,
      successfulPurchases: successfulPurchases.length,
      failureRate: ((1 - successfulPurchases.length / purchases.length) * 100).toFixed(1),
      totalSpent: totalSpent.toFixed(2),
      averagePurchase: (totalSpent / purchases.length).toFixed(2),
      dailyAverage: (totalSpent / daysActive).toFixed(2),
      hourlyAverage: (totalSpent / hoursActive).toFixed(4),
    };
  }

  checkHealth(thresholds = {}) {
    const defaults = {
      minXlm: 0.5,
      minUsdc: 5,
      maxDailySpend: 1000,
    };
    const cfg = { ...defaults, ...thresholds };

    const alerts = [];
    const latest = this.metrics.balanceHistory[this.metrics.balanceHistory.length - 1];

    if (!latest) return alerts;

    if (latest.xlm < cfg.minXlm) {
      alerts.push({
        level: 'warning',
        message: `Low XLM balance: ${latest.xlm} (threshold: ${cfg.minXlm})`,
      });
    }

    if (latest.usdc < cfg.minUsdc) {
      alerts.push({
        level: 'warning',
        message: `Low USDC balance: ${latest.usdc} (threshold: ${cfg.minUsdc})`,
      });
    }

    const today = new Date().toDateString();
    const todaySpend = this.metrics.purchases
      .filter((p) => new Date(p.createdAt).toDateString() === today && p.status === 'completed')
      .reduce((sum, p) => sum + p.amount, 0);

    if (todaySpend > cfg.maxDailySpend) {
      alerts.push({
        level: 'alert',
        message: `High daily spend: $${todaySpend.toFixed(2)} (limit: $${cfg.maxDailySpend})`,
      });
    }

    return alerts;
  }

  generateReport() {
    const analytics = this.getAnalytics();
    const healthAlerts = this.checkHealth();
    const latest = this.metrics.balanceHistory[this.metrics.balanceHistory.length - 1];

    return {
      timestamp: new Date().toISOString(),
      wallet: this.walletName,
      currentBalance: latest ? { xlm: latest.xlm, usdc: latest.usdc } : null,
      analytics,
      alerts: [...this.metrics.alerts, ...healthAlerts],
    };
  }

  saveReport(filename) {
    const report = this.generateReport();
    const dir = path.join(process.env.HOME || '/tmp', '.stellar-card', 'reports');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2), { mode: 0o600 });
    return filepath;
  }
}

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY environment variable not set');
    process.exit(1);
  }

  try {
    console.log('=== Wallet Monitoring and Analytics ===\n');

    const monitor = new WalletMonitor(apiKey, 'analytics-wallet');

    console.log('Collecting metrics...');
    await monitor.collectMetrics();
    await sleep(1000);

    console.log('Generating report...\n');
    const report = monitor.generateReport();

    console.log('CURRENT BALANCE:');
    if (report.currentBalance) {
      console.log(`  XLM: ${report.currentBalance.xlm}`);
      console.log(`  USDC: ${report.currentBalance.usdc}`);
    }

    console.log('\nANALYTICS:');
    console.log(`  Total Purchases: ${report.analytics.totalPurchases}`);
    console.log(`  Successful: ${report.analytics.successfulPurchases}`);
    console.log(`  Failure Rate: ${report.analytics.failureRate}%`);
    console.log(`  Total Spent: $${report.analytics.totalSpent}`);
    console.log(`  Average Purchase: $${report.analytics.averagePurchase}`);
    console.log(`  Daily Average: $${report.analytics.dailyAverage}`);
    console.log(`  Hourly Average: $${report.analytics.hourlyAverage}`);

    if (report.alerts.length > 0) {
      console.log('\nALERTS:');
      report.alerts.forEach((alert) => {
        const icon = alert.level === 'error' ? '✗' : alert.level === 'alert' ? '⚠' : 'ℹ';
        console.log(`  ${icon} [${alert.level.toUpperCase()}] ${alert.message}`);
      });
    } else {
      console.log('\n✓ No alerts');
    }

    const reportPath = monitor.saveReport(`wallet-report-${Date.now()}.json`);
    console.log(`\nReport saved to: ${reportPath}`);
  } catch (err) {
    console.error('Error:');
    if (err instanceof Error) {
      console.error(`  ${err.message}`);
    } else {
      console.error(`  ${String(err)}`);
    }
    process.exit(1);
  }
}

main();
