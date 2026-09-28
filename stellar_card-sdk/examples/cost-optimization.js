#!/usr/bin/env node
/**
 * Cost optimization example.
 *
 * Demonstrates:
 * - Finding optimal payment asset (XLM vs USDC)
 * - Batch operations to reduce per-card overhead
 * - Timing purchases to optimize Stellar network fees
 * - Monitoring and reporting on costs
 * - Budget forecasting
 *
 * Run with:
 *   CARDS402_API_KEY='stellar_card_...' node examples/cost-optimization.js
 */

import { getOWSBalance, purchaseCardOWS, Stellar_CardClient } from 'stellar_card';

class CostOptimizer {
  constructor(apiKey, walletName) {
    this.apiKey = apiKey;
    this.walletName = walletName;
    this.client = new Stellar_CardClient({ apiKey });
  }

  async analyzeAssetCosts() {
    const balance = await getOWSBalance(this.walletName);

    // Rough estimates based on Stellar network
    const estimates = {
      xlm: {
        baseFeeMicroXLM: 100,
        perOperationMicroXLM: 100,
        xlmPrice: 0.10, // Approximate, would fetch real-time in production
      },
      usdc: {
        baseFeeMicroXLM: 100,
        perOperationMicroXLM: 100,
        xlmPrice: 0.10,
      },
    };

    const xlmBalance = parseFloat(balance.xlm);
    const usdcBalance = parseFloat(balance.usdc);

    return {
      xlm: {
        available: xlmBalance,
        estimatedCostXlm: (estimates.xlm.baseFeeMicroXLM + estimates.xlm.perOperationMicroXLM) / 1e7,
        estimatedCostUsd: ((estimates.xlm.baseFeeMicroXLM + estimates.xlm.perOperationMicroXLM) / 1e7) *
          estimates.xlm.xlmPrice,
      },
      usdc: {
        available: usdcBalance,
        estimatedCostXlm: (estimates.usdc.baseFeeMicroXLM + estimates.usdc.perOperationMicroXLM) / 1e7,
        estimatedCostUsd: ((estimates.usdc.baseFeeMicroXLM + estimates.usdc.perOperationMicroXLM) / 1e7) *
          estimates.usdc.xlmPrice,
      },
      recommendations: this.recommendAsset(xlmBalance, usdcBalance),
    };
  }

  recommendAsset(xlmBalance, usdcBalance) {
    const recommendations = [];

    if (usdcBalance >= 50) {
      recommendations.push({
        asset: 'USDC',
        reason: 'Good USDC balance, direct settlement',
        priority: 'high',
      });
    } else if (xlmBalance >= 10) {
      recommendations.push({
        asset: 'XLM',
        reason: 'Native asset, may have lower fees',
        priority: 'high',
      });
    } else if (xlmBalance >= 2 && usdcBalance >= 5) {
      recommendations.push({
        asset: 'auto',
        reason: 'Let SDK choose optimal asset',
        priority: 'medium',
      });
    } else {
      recommendations.push({
        asset: 'USDC',
        reason: 'Low XLM, preserve for fees',
        priority: 'low',
      });
    }

    return recommendations;
  }

  async forecastBudget(dailySpend, daysAhead = 30) {
    const orders = await this.client.listOrders({ limit: 100 });
    const completedOrders = orders.filter((o) => o.status === 'completed');

    if (completedOrders.length === 0) {
      return {
        forecastDays: daysAhead,
        assumedDailySpend: dailySpend,
        projectedTotalSpend: (dailySpend * daysAhead).toFixed(2),
      };
    }

    // Calculate historical daily average
    const timespan = Date.now() - new Date(completedOrders[0].created_at).getTime();
    const daysOfData = timespan / (1000 * 60 * 60 * 24);
    const totalSpend = completedOrders.reduce((sum, o) => sum + parseFloat(o.amount_usdc), 0);
    const historicalDaily = totalSpend / daysOfData;

    return {
      historicalDailyAverage: historicalDaily.toFixed(2),
      forecastDays: daysAhead,
      projectedTotalSpend: (historicalDaily * daysAhead).toFixed(2),
      dataPoints: completedOrders.length,
      historicalSpan: daysOfData.toFixed(1),
    };
  }

  async optimizeBatchSize(targetCardValue) {
    // Analyze cost per card by batch size
    const batchSizes = [1, 5, 10, 25, 50];
    const analysis = [];

    // Rough estimates
    const fixedCostPerBatch = 0.01; // Setup, validation
    const costPerCard = 0.01; // Soroban invocation

    for (const batchSize of batchSizes) {
      const totalCost = fixedCostPerBatch + costPerCard * batchSize;
      const costPerCard_Calculated = (totalCost / batchSize).toFixed(4);

      analysis.push({
        batchSize,
        totalCost: totalCost.toFixed(2),
        costPerCard: costPerCard_Calculated,
        cardValue: targetCardValue,
        feePercentage: ((totalCost / (targetCardValue * batchSize)) * 100).toFixed(2),
      });
    }

    return {
      analysis,
      recommendation: analysis.reduce((best, current) =>
        parseFloat(current.costPerCard) < parseFloat(best.costPerCard) ? current : best,
      ),
    };
  }
}

async function main() {
  const apiKey = process.env.CARDS402_API_KEY;
  if (!apiKey) {
    console.error('Error: CARDS402_API_KEY environment variable not set');
    process.exit(1);
  }

  try {
    console.log('=== Cost Optimization Analysis ===\n');

    const optimizer = new CostOptimizer(apiKey, 'cost-wallet');

    // Asset cost analysis
    console.log('1. Asset Cost Analysis:');
    const assetAnalysis = await optimizer.analyzeAssetCosts();
    console.log(`   XLM Available: ${assetAnalysis.xlm.available}`);
    console.log(`   XLM Est. Cost: $${assetAnalysis.xlm.estimatedCostUsd}`);
    console.log(`   USDC Available: ${assetAnalysis.usdc.available}`);
    console.log(`   USDC Est. Cost: $${assetAnalysis.usdc.estimatedCostUsd}`);
    console.log('\n   Recommendations:');
    assetAnalysis.recommendations.forEach((rec) => {
      console.log(`   • ${rec.asset}: ${rec.reason} (${rec.priority})`);
    });

    // Batch size optimization
    console.log('\n2. Batch Size Optimization (for $10 cards):');
    const batchAnalysis = await optimizer.optimizeBatchSize(10);
    console.log('   Batch Size | Cost/Card | Fee %');
    console.log('   -----------+-----------+------');
    batchAnalysis.analysis.forEach((row) => {
      console.log(`   ${row.batchSize.toString().padEnd(10)} | $${row.costPerCard.padEnd(8)} | ${row.feePercentage}%`);
    });
    console.log(`\n   Recommended: Batch size ${batchAnalysis.recommendation.batchSize}`);

    // Budget forecast
    console.log('\n3. Budget Forecast:');
    const forecast = await optimizer.forecastBudget(50, 30);
    if (forecast.historicalDailyAverage) {
      console.log(`   Historical Daily Average: $${forecast.historicalDailyAverage}`);
      console.log(`   Data Points: ${forecast.dataPoints} orders over ${forecast.historicalSpan} days`);
    } else {
      console.log(`   Using assumed daily spend: $${forecast.assumedDailySpend}`);
    }
    console.log(`   30-Day Projection: $${forecast.projectedTotalSpend}`);

    // Cost reduction tips
    console.log('\n4. Cost Reduction Tips:');
    const tips = [
      '• Use batch purchasing to amortize fixed costs',
      '• Prefer USDC payments when balance is sufficient',
      '• Monitor network conditions for optimal fee times',
      '• Consider "auto" asset selection for flexibility',
      '• Review historical spending patterns weekly',
      '• Set daily/weekly spend limits to control costs',
    ];
    tips.forEach((tip) => console.log(`   ${tip}`));
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
