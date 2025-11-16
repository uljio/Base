/**
 * Pool analyzer for scoring arbitrage potential
 */

import { PoolInfo } from '../../types/dex.types';
import { logger } from '../utils/Logger';

export interface PoolScore {
  pool: PoolInfo;
  score: number;
  metrics: {
    volumeToLiquidityRatio: number;
    activityScore: number;
    sizeScore: number;
    volatilityScore: number;
  };
}

export class PoolAnalyzer {
  /**
   * Analyze and score pools for arbitrage potential
   */
  analyzePools(pools: PoolInfo[]): PoolScore[] {
    const scored = pools.map((pool) => this.scorePool(pool));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    logger.info('Pool analysis complete', {
      totalPools: pools.length,
      avgScore: this.calculateAverageScore(scored),
      topScore: scored[0]?.score || 0,
    });

    return scored;
  }

  /**
   * Score individual pool
   */
  private scorePool(pool: PoolInfo): PoolScore {
    const metrics = {
      volumeToLiquidityRatio: this.calculateVolumeToLiquidityRatio(pool),
      activityScore: this.calculateActivityScore(pool),
      sizeScore: this.calculateSizeScore(pool),
      volatilityScore: this.calculateVolatilityScore(pool),
    };

    // Weighted scoring
    const score =
      metrics.volumeToLiquidityRatio * 0.4 +
      metrics.activityScore * 0.3 +
      metrics.sizeScore * 0.2 +
      metrics.volatilityScore * 0.1;

    return {
      pool,
      score,
      metrics,
    };
  }

  /**
   * Calculate volume to liquidity ratio
   * Higher ratio = more trading activity relative to pool size
   */
  private calculateVolumeToLiquidityRatio(pool: PoolInfo): number {
    if (pool.liquidityUSD === 0) return 0;

    const ratio = pool.volume24hUSD / pool.liquidityUSD;

    // Normalize to 0-100 scale
    // Ratios above 2.0 are considered excellent
    return Math.min(100, (ratio / 2.0) * 100);
  }

  /**
   * Calculate activity score based on absolute volume
   */
  private calculateActivityScore(pool: PoolInfo): number {
    const volume = pool.volume24hUSD;

    // Score thresholds
    if (volume >= 10_000_000) return 100; // $10M+
    if (volume >= 5_000_000) return 90; // $5M+
    if (volume >= 1_000_000) return 80; // $1M+
    if (volume >= 500_000) return 70; // $500K+
    if (volume >= 100_000) return 60; // $100K+
    if (volume >= 50_000) return 50; // $50K+

    // Linear scale for lower volumes
    return (volume / 50_000) * 50;
  }

  /**
   * Calculate size score based on liquidity
   */
  private calculateSizeScore(pool: PoolInfo): number {
    const liquidity = pool.liquidityUSD;

    // Larger pools can handle bigger trades without slippage
    if (liquidity >= 10_000_000) return 100;
    if (liquidity >= 5_000_000) return 90;
    if (liquidity >= 1_000_000) return 80;
    if (liquidity >= 500_000) return 70;
    if (liquidity >= 100_000) return 60;
    if (liquidity >= 50_000) return 50;

    return (liquidity / 50_000) * 50;
  }

  /**
   * Calculate volatility score
   * Higher volume relative to liquidity suggests price volatility
   */
  private calculateVolatilityScore(pool: PoolInfo): number {
    if (pool.liquidityUSD === 0) return 0;

    const ratio = pool.volume24hUSD / pool.liquidityUSD;

    // Volatility scoring
    if (ratio >= 3.0) return 100; // Very high volatility
    if (ratio >= 2.0) return 80;
    if (ratio >= 1.0) return 60;
    if (ratio >= 0.5) return 40;

    return ratio * 80; // Linear for lower ratios
  }

  /**
   * Filter high-potential pools
   */
  filterHighPotential(scores: PoolScore[], minScore: number = 60): PoolScore[] {
    return scores.filter((s) => s.score >= minScore);
  }

  /**
   * Group pools by token pair
   */
  groupByPair(pools: PoolInfo[]): Map<string, PoolInfo[]> {
    const grouped = new Map<string, PoolInfo[]>();

    for (const pool of pools) {
      const pairKey = this.getPairKey(pool.token0.address, pool.token1.address);

      if (!grouped.has(pairKey)) {
        grouped.set(pairKey, []);
      }

      grouped.get(pairKey)!.push(pool);
    }

    return grouped;
  }

  /**
   * Find arbitrage pairs (same pair on different DEXs)
   */
  findArbitragePairs(pools: PoolInfo[]): Map<string, PoolInfo[]> {
    const grouped = this.groupByPair(pools);
    const arbitragePairs = new Map<string, PoolInfo[]>();

    for (const [pairKey, poolList] of grouped.entries()) {
      // Only interested in pairs that exist on multiple DEXs
      if (poolList.length >= 2) {
        arbitragePairs.set(pairKey, poolList);
      }
    }

    logger.info('Arbitrage pairs found', {
      totalPairs: grouped.size,
      arbitragePairs: arbitragePairs.size,
    });

    return arbitragePairs;
  }

  /**
   * Get normalized pair key (sorted addresses)
   */
  private getPairKey(token0: string, token1: string): string {
    const [t0, t1] = [token0.toLowerCase(), token1.toLowerCase()].sort();
    return `${t0}-${t1}`;
  }

  /**
   * Calculate average score
   */
  private calculateAverageScore(scores: PoolScore[]): number {
    if (scores.length === 0) return 0;
    const sum = scores.reduce((acc, s) => acc + s.score, 0);
    return sum / scores.length;
  }

  /**
   * Get top pools by score
   */
  getTopPools(scores: PoolScore[], limit: number): PoolScore[] {
    return scores.slice(0, limit);
  }

  /**
   * Print pool analysis summary
   */
  printSummary(scores: PoolScore[], topN: number = 10): void {
    const topPools = this.getTopPools(scores, topN);

    logger.info(`\n========== Top ${topN} Pools ==========`);

    for (let i = 0; i < topPools.length; i++) {
      const { pool, score, metrics } = topPools[i];

      logger.info(`\n${i + 1}. ${pool.token0.symbol}/${pool.token1.symbol} on ${pool.dex}`, {
        score: score.toFixed(2),
        liquidity: `$${pool.liquidityUSD.toLocaleString()}`,
        volume24h: `$${pool.volume24hUSD.toLocaleString()}`,
        volumeRatio: metrics.volumeToLiquidityRatio.toFixed(2),
        address: pool.address,
      });
    }

    logger.info('\n=======================================\n');
  }
}
