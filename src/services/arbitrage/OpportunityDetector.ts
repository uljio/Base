'use strict';

import { logger } from '../../services/utils/Logger';
import { Opportunity, OpportunityData } from '../../database/models/Opportunity';
import { Pool } from '../../database/models/Pool';
import { SwapCalculator, SwapHop } from './SwapCalculator';
import { getConfig } from '../../config/environment';

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
  private readonly tradeSizeUsd: number;
  private readonly config = getConfig();

  constructor(
    chainId: number,
    minProfitUsd: number = 1.00,
    minProfitPercentage: number = 0.1,
    opportunityTtlMs: number = 60000
  ) {
    this.chainId = chainId;
    this.minProfitUsd = minProfitUsd;
    this.minProfitPercentage = minProfitPercentage;
    this.opportunityTtlMs = opportunityTtlMs;
    this.tradeSizeUsd = this.config.FLASH_LOAN_SIZE_USD || 50;
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

      // Skip if pools don't have valid reserves
      const validPools = connectingPools.filter(
        pool => pool.reserve0 && pool.reserve1 &&
                pool.reserve0 !== '0' && pool.reserve1 !== '0'
      );

      if (validPools.length < 2) {
        return null;
      }

      // Calculate profit for each pool pair
      for (let i = 0; i < validPools.length; i++) {
        for (let j = i + 1; j < validPools.length; j++) {
          const pool1 = validPools[i];
          const pool2 = validPools[j];

          // Try arbitrage: buy from pool1, sell to pool2
          const opportunity = this.calculateDirectProfit(
            tokenIn,
            tokenOut,
            pool1,
            pool2
          );

          if (opportunity && opportunity.profitUsd >= this.minProfitUsd) {
            return opportunity;
          }

          // Try reverse: buy from pool2, sell to pool1
          const reverseOpportunity = this.calculateDirectProfit(
            tokenIn,
            tokenOut,
            pool2,
            pool1
          );

          if (reverseOpportunity && reverseOpportunity.profitUsd >= this.minProfitUsd) {
            return reverseOpportunity;
          }
        }
      }

      return null;
    } catch (error) {
      logger.debug(`Direct arbitrage check failed: ${error}`);
      return null;
    }
  }

  /**
   * Calculate profit for direct arbitrage between two pools
   */
  private calculateDirectProfit(
    tokenIn: string,
    tokenOut: string,
    buyPool: any,
    sellPool: any
  ): DetectedOpportunity | null {
    try {
      // Trade size in wei (assume 18 decimals for stablecoin)
      const amountIn = BigInt(Math.floor(this.tradeSizeUsd * 1e18));

      // Determine reserve order for buy pool
      const buyIsToken0 = buyPool.token0.toLowerCase() === tokenIn.toLowerCase();
      const buyReserveIn = BigInt(buyIsToken0 ? buyPool.reserve0 : buyPool.reserve1);
      const buyReserveOut = BigInt(buyIsToken0 ? buyPool.reserve1 : buyPool.reserve0);

      // Calculate output from buy pool
      const amountOut = SwapCalculator.calculateSwapOutput(
        amountIn,
        buyReserveIn,
        buyReserveOut,
        this.config.DEX_FEE_PERCENTAGE
      );

      if (amountOut === 0n) return null;

      // Determine reserve order for sell pool
      const sellIsToken0 = sellPool.token1.toLowerCase() === tokenIn.toLowerCase();
      const sellReserveIn = BigInt(sellIsToken0 ? sellPool.reserve0 : sellPool.reserve1);
      const sellReserveOut = BigInt(sellIsToken0 ? sellPool.reserve1 : sellPool.reserve0);

      // Calculate final output from sell pool
      const amountFinal = SwapCalculator.calculateSwapOutput(
        amountOut,
        sellReserveIn,
        sellReserveOut,
        this.config.DEX_FEE_PERCENTAGE
      );

      if (amountFinal === 0n) return null;

      // Calculate profit
      const grossProfit = amountFinal - amountIn;
      const flashloanFee = amountIn * BigInt(Math.floor(this.config.FLASHLOAN_FEE_PERCENTAGE * 100)) / 10000n;
      const gasCostWei = BigInt(Math.floor(this.config.ESTIMATED_GAS_COST_USD * 1e18));
      const netProfit = grossProfit - flashloanFee - gasCostWei;
      const netProfitUsd = Number(netProfit) / 1e18;

      if (netProfitUsd < this.minProfitUsd) {
        return null;
      }

      const profitPercentage = (Number(grossProfit) / Number(amountIn)) * 100;

      return {
        tokenIn,
        tokenOut: tokenIn, // Circular
        amountIn: amountIn.toString(),
        amountOutPredicted: amountFinal.toString(),
        profitUsd: netProfitUsd,
        profitPercentage,
        route: {
          pools: [buyPool.id, sellPool.id],
          tokenIn,
          tokenOut: tokenIn,
          amounts: [amountIn.toString(), amountOut.toString(), amountFinal.toString()],
          path: [tokenIn, tokenOut, tokenIn],
        },
        confidence: Math.min(1, Math.abs(profitPercentage) / 2),
      };
    } catch (error) {
      logger.debug(`Failed to calculate direct profit: ${error}`);
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
          ((p.token0.toLowerCase() === tokenA.toLowerCase() &&
            p.token1.toLowerCase() === tokenB.toLowerCase()) ||
          (p.token0.toLowerCase() === tokenB.toLowerCase() &&
            p.token1.toLowerCase() === tokenA.toLowerCase())) &&
          p.reserve0 && p.reserve1 && p.reserve0 !== '0' && p.reserve1 !== '0'
      );

      const poolBC = pools.find(
        p =>
          ((p.token0.toLowerCase() === tokenB.toLowerCase() &&
            p.token1.toLowerCase() === tokenC.toLowerCase()) ||
          (p.token0.toLowerCase() === tokenC.toLowerCase() &&
            p.token1.toLowerCase() === tokenB.toLowerCase())) &&
          p.reserve0 && p.reserve1 && p.reserve0 !== '0' && p.reserve1 !== '0'
      );

      const poolCA = pools.find(
        p =>
          ((p.token0.toLowerCase() === tokenC.toLowerCase() &&
            p.token1.toLowerCase() === tokenA.toLowerCase()) ||
          (p.token0.toLowerCase() === tokenA.toLowerCase() &&
            p.token1.toLowerCase() === tokenC.toLowerCase())) &&
          p.reserve0 && p.reserve1 && p.reserve0 !== '0' && p.reserve1 !== '0'
      );

      if (!poolAB || !poolBC || !poolCA) {
        return null;
      }

      // Trade size in wei (assume 18 decimals)
      const startAmount = BigInt(Math.floor(this.tradeSizeUsd * 1e18));

      // Leg 1: A -> B
      const isAToken0_AB = poolAB.token0.toLowerCase() === tokenA.toLowerCase();
      const reserveIn_AB = BigInt(isAToken0_AB ? poolAB.reserve0 : poolAB.reserve1);
      const reserveOut_AB = BigInt(isAToken0_AB ? poolAB.reserve1 : poolAB.reserve0);
      const afterAB = SwapCalculator.calculateSwapOutput(
        startAmount,
        reserveIn_AB,
        reserveOut_AB,
        this.config.DEX_FEE_PERCENTAGE
      );

      if (afterAB === 0n) return null;

      // Leg 2: B -> C
      const isBToken0_BC = poolBC.token0.toLowerCase() === tokenB.toLowerCase();
      const reserveIn_BC = BigInt(isBToken0_BC ? poolBC.reserve0 : poolBC.reserve1);
      const reserveOut_BC = BigInt(isBToken0_BC ? poolBC.reserve1 : poolBC.reserve0);
      const afterBC = SwapCalculator.calculateSwapOutput(
        afterAB,
        reserveIn_BC,
        reserveOut_BC,
        this.config.DEX_FEE_PERCENTAGE
      );

      if (afterBC === 0n) return null;

      // Leg 3: C -> A
      const isCToken0_CA = poolCA.token0.toLowerCase() === tokenC.toLowerCase();
      const reserveIn_CA = BigInt(isCToken0_CA ? poolCA.reserve0 : poolCA.reserve1);
      const reserveOut_CA = BigInt(isCToken0_CA ? poolCA.reserve1 : poolCA.reserve0);
      const afterCA = SwapCalculator.calculateSwapOutput(
        afterBC,
        reserveIn_CA,
        reserveOut_CA,
        this.config.DEX_FEE_PERCENTAGE
      );

      if (afterCA === 0n) return null;

      // Calculate profit
      const grossProfit = afterCA - startAmount;
      const flashloanFee = startAmount * BigInt(Math.floor(this.config.FLASHLOAN_FEE_PERCENTAGE * 100)) / 10000n;
      const gasCostWei = BigInt(Math.floor(this.config.ESTIMATED_GAS_COST_USD * 1e18));
      const netProfit = grossProfit - flashloanFee - gasCostWei;
      const netProfitUsd = Number(netProfit) / 1e18;

      if (netProfitUsd < this.minProfitUsd) {
        return null;
      }

      const profitPercentage = (Number(grossProfit) / Number(startAmount)) * 100;

      return {
        tokenIn: tokenA,
        tokenOut: tokenA,
        amountIn: startAmount.toString(),
        amountOutPredicted: afterCA.toString(),
        profitUsd: netProfitUsd,
        profitPercentage,
        route: {
          pools: [poolAB.id, poolBC.id, poolCA.id],
          tokenIn: tokenA,
          tokenOut: tokenA,
          amounts: [startAmount.toString(), afterAB.toString(), afterBC.toString(), afterCA.toString()],
          path: [tokenA, tokenB, tokenC, tokenA],
        },
        confidence: Math.min(1, profitPercentage / 5),
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
