'use strict';

import { logger } from '../../services/utils/Logger';
import { Opportunity, OpportunityData } from '../../database/models/Opportunity';
import { Pool } from '../../database/models/Pool';

/**
 * Opportunity Detector Service
 * Detects arbitrage opportunities by comparing prices across different pools and DEXs
 */
export interface SwapRoute {
  pools: string[]; // Pool IDs
  tokenIn: string;
  tokenOut: string;
  amounts: string[];
  path: string[]; // Token addresses in order
}

export interface DetectedOpportunity {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutPredicted: string;
  profitUsd: number;
  profitPercentage: number;
  route: SwapRoute;
  confidence: number; // 0-1
}

export class OpportunityDetector {
private readonly chainId: number;
  private readonly minProfitUsd: number;
  private readonly minProfitPercentage: number;
  private readonly opportunityTtlMs: number;

  constructor(
    chainId: number,
    minProfitUsd: number = 10,
    minProfitPercentage: number = 0.1,
    opportunityTtlMs: number = 60000
  ) {
    this.chainId = chainId;
    this.minProfitUsd = minProfitUsd;
    this.minProfitPercentage = minProfitPercentage;
    this.opportunityTtlMs = opportunityTtlMs;
  }

  /**
   * Scan for arbitrage opportunities
   * Compares prices across different token pairs and pools
   */
  public async scanOpportunities(
    tokens: string[],
    poolPrices: Map<string, number>
  ): Promise<DetectedOpportunity[]> {
    try {
      const opportunities: DetectedOpportunity[] = [];

      // Get all pools for the chain
      const pools = await Pool.findByChain(this.chainId, 10000);

      // Check for triangular arbitrage opportunities
      for (let i = 0; i < tokens.length; i++) {
        for (let j = 0; j < tokens.length; j++) {
          if (i === j) continue;

          const tokenIn = tokens[i];
          const tokenOut = tokens[j];

          // Find direct path
          const directOpportunity = await this.findDirectArbitrage(
            tokenIn,
            tokenOut,
            pools,
            poolPrices
          );

          if (directOpportunity) {
            opportunities.push(directOpportunity);
          }

          // Find 3-hop paths for triangular arbitrage
          for (let k = 0; k < tokens.length; k++) {
            if (k === i || k === j) continue;

            const middleToken = tokens[k];
            const triangularOpp = await this.findTriangularArbitrage(
              tokenIn,
              middleToken,
              tokenOut,
              pools,
              poolPrices
            );

            if (triangularOpp) {
              opportunities.push(triangularOpp);
            }
          }
        }
      }

      // Filter by profitability threshold
      const profitable = opportunities.filter(
        opp =>
          opp.profitUsd >= this.minProfitUsd &&
          opp.profitPercentage >= this.minProfitPercentage
      );

      logger.info(
        `Found ${profitable.length} profitable opportunities out of ${opportunities.length}`
      );

      return profitable.sort((a, b) => b.profitUsd - a.profitUsd);
    } catch (error) {
      logger.error(`Failed to scan opportunities: ${error}`);
      throw new Error(`Opportunity scanning failed: ${error}`);
    }
  }

  /**
   * Find direct arbitrage path between two tokens
   */
  private async findDirectArbitrage(
    tokenIn: string,
    tokenOut: string,
    pools: any[],
    poolPrices: Map<string, number>
  ): Promise<DetectedOpportunity | null> {
    try {
      // Find all pools connecting these tokens
      const connectingPools = pools.filter(
        pool =>
          (pool.token0.toLowerCase() === tokenIn.toLowerCase() &&
            pool.token1.toLowerCase() === tokenOut.toLowerCase()) ||
          (pool.token0.toLowerCase() === tokenOut.toLowerCase() &&
            pool.token1.toLowerCase() === tokenIn.toLowerCase())
      );

      if (connectingPools.length < 2) {
        return null; // Need at least 2 pools for arbitrage
      }

      // Compare prices across pools
      const prices = connectingPools.map(pool => {
        const priceKey = `${pool.id}`;
        return poolPrices.get(priceKey) || pool.price;
      });

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);

      // Calculate potential profit
      const amountIn = '1000000000000000000'; // 1 unit with 18 decimals
      const amountOut = this.calculateOutputAmount(amountIn, minPrice);
      const profitRatio = (maxPrice - minPrice) / minPrice;
      const profitUsd = parseFloat(amountOut) * maxPrice * profitRatio;

      if (profitUsd < this.minProfitUsd) {
        return null;
      }

      return {
        tokenIn,
        tokenOut,
        amountIn,
        amountOutPredicted: amountOut,
        profitUsd,
        profitPercentage: profitRatio * 100,
        route: {
          pools: [connectingPools[0].id, connectingPools[1].id],
          tokenIn,
          tokenOut,
          amounts: [amountIn, amountOut],
          path: [tokenIn, tokenOut],
        },
        confidence: Math.min(1, Math.abs(profitRatio) / 0.1),
      };
    } catch (error) {
      logger.debug(`Direct arbitrage check failed: ${error}`);
      return null;
    }
  }

  /**
   * Find triangular arbitrage opportunity
   */
  private async findTriangularArbitrage(
    tokenA: string,
    tokenB: string,
    tokenC: string,
    pools: any[],
    poolPrices: Map<string, number>
  ): Promise<DetectedOpportunity | null> {
    try {
      // Find pools for each leg: A->B, B->C, C->A
      const poolAB = pools.find(
        p =>
          (p.token0.toLowerCase() === tokenA.toLowerCase() &&
            p.token1.toLowerCase() === tokenB.toLowerCase()) ||
          (p.token0.toLowerCase() === tokenB.toLowerCase() &&
            p.token1.toLowerCase() === tokenA.toLowerCase())
      );

      const poolBC = pools.find(
        p =>
          (p.token0.toLowerCase() === tokenB.toLowerCase() &&
            p.token1.toLowerCase() === tokenC.toLowerCase()) ||
          (p.token0.toLowerCase() === tokenC.toLowerCase() &&
            p.token1.toLowerCase() === tokenB.toLowerCase())
      );

      const poolCA = pools.find(
        p =>
          (p.token0.toLowerCase() === tokenC.toLowerCase() &&
            p.token1.toLowerCase() === tokenA.toLowerCase()) ||
          (p.token0.toLowerCase() === tokenA.toLowerCase() &&
            p.token1.toLowerCase() === tokenC.toLowerCase())
      );

      if (!poolAB || !poolBC || !poolCA) {
        return null;
      }

      // Calculate amounts through the route
      const startAmount = '1000000000000000000'; // 1 unit
      const afterAB = this.calculateOutputAmount(startAmount, poolAB.price);
      const afterBC = this.calculateOutputAmount(afterAB, poolBC.price);
      const afterCA = this.calculateOutputAmount(afterBC, poolCA.price);

      // Calculate profit
      const endAmount = parseFloat(afterCA);
      const startAmountNum = parseFloat(startAmount);
      const profitRatio = (endAmount - startAmountNum) / startAmountNum;

      if (profitRatio < 0 || profitRatio < this.minProfitPercentage / 100) {
        return null;
      }

      const profitUsd = endAmount * 100 * profitRatio; // Assume $100 price

      if (profitUsd < this.minProfitUsd) {
        return null;
      }

      return {
        tokenIn: tokenA,
        tokenOut: tokenA,
        amountIn: startAmount,
        amountOutPredicted: afterCA,
        profitUsd,
        profitPercentage: profitRatio * 100,
        route: {
          pools: [poolAB.id, poolBC.id, poolCA.id],
          tokenIn: tokenA,
          tokenOut: tokenA,
          amounts: [startAmount, afterAB, afterBC, afterCA],
          path: [tokenA, tokenB, tokenC, tokenA],
        },
        confidence: Math.min(1, profitRatio / 0.05),
      };
    } catch (error) {
      logger.debug(`Triangular arbitrage check failed: ${error}`);
      return null;
    }
  }

  /**
   * Save detected opportunity to database
   */
  public async saveOpportunity(
    detected: DetectedOpportunity
  ): Promise<OpportunityData> {
    try {
      const opportunity = await Opportunity.create({
        chain_id: this.chainId,
        token_in: detected.tokenIn,
        token_out: detected.tokenOut,
        amount_in: detected.amountIn,
        amount_out_predicted: detected.amountOutPredicted,
        profit_usd: detected.profitUsd,
        profit_percentage: detected.profitPercentage,
        route: JSON.stringify(detected.route),
        status: 'pending',
        expires_at: Date.now() + this.opportunityTtlMs,
      });

      return opportunity;
    } catch (error) {
      logger.error(`Failed to save opportunity: ${error}`);
      throw new Error(`Opportunity save failed: ${error}`);
    }
  }

  /**
   * Calculate output amount from swap
   */
  private calculateOutputAmount(inputAmount: string, price: number): string {
    try {
      const input = parseFloat(inputAmount);
      const output = input * price;
      return output.toString();
    } catch (error) {
      logger.error(`Failed to calculate output: ${error}`);
      return '0';
    }
  }

  /**
   * Get detector statistics
   */
  public getStats(): {
    chainId: number;
    minProfitUsd: number;
    minProfitPercentage: number;
    opportunityTtlMs: number;
  } {
    return {
      chainId: this.chainId,
      minProfitUsd: this.minProfitUsd,
      minProfitPercentage: this.minProfitPercentage,
      opportunityTtlMs: this.opportunityTtlMs,
    };
  }
}

export default OpportunityDetector;
