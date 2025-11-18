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
    poolPrices: Map<string, number>,
    tokenDecimals: Map<string, number> = new Map()
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
            poolPrices,
            tokenDecimals
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
              poolPrices,
              tokenDecimals
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
    poolPrices: Map<string, number>,
    tokenDecimals: Map<string, number>
  ): Promise<DetectedOpportunity | null> {
    try {
      logger.debug(`\n🔍 findDirectArbitrage: ${tokenIn.slice(0,10)}... → ${tokenOut.slice(0,10)}...`);

      // Find all pools connecting these tokens
      const connectingPools = pools.filter(
        pool =>
          (pool.token0.toLowerCase() === tokenIn.toLowerCase() &&
            pool.token1.toLowerCase() === tokenOut.toLowerCase()) ||
          (pool.token0.toLowerCase() === tokenOut.toLowerCase() &&
            pool.token1.toLowerCase() === tokenIn.toLowerCase())
      );

      logger.debug(`  Found ${connectingPools.length} connecting pools`);

      if (connectingPools.length < 2) {
        logger.debug(`  ❌ Not enough pools (need 2)`);
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
            pool2,
            tokenDecimals
          );

          if (opportunity && opportunity.profitUsd >= this.minProfitUsd) {
            return opportunity;
          }

          // Try reverse: buy from pool2, sell to pool1
          const reverseOpportunity = this.calculateDirectProfit(
            tokenIn,
            tokenOut,
            pool2,
            pool1,
            tokenDecimals
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
    sellPool: any,
    tokenDecimals: Map<string, number>
  ): DetectedOpportunity | null {
    try {
      // Get token decimals (default to 18 if not found)
      const decimals = tokenDecimals.get(tokenIn.toLowerCase()) || 18;
      const decimalMultiplier = Math.pow(10, decimals);

      // Calculate trade size based on pool price
      // For USDC (stablecoin): $50 = 50 USDC
      // For WETH at $3000: $50 = 0.0167 WETH
      let amountIn: bigint;

      // Estimate token price from buy pool reserves
      const buyIsToken0 = buyPool.token0.toLowerCase() === tokenIn.toLowerCase();
      const reserveTokenIn = buyIsToken0 ? BigInt(buyPool.reserve0) : BigInt(buyPool.reserve1);
      const reserveTokenOut = buyIsToken0 ? BigInt(buyPool.reserve1) : BigInt(buyPool.reserve0);

      // Get decimals for both tokens
      const decimalsOut = tokenDecimals.get(tokenOut.toLowerCase()) || 18;
      logger.debug(`  Decimals: tokenIn=${decimals}, tokenOut=${decimalsOut}`)
      logger.debug(`  Addresses: tokenIn=${tokenIn.toLowerCase()}, tokenOut=${tokenOut.toLowerCase()}`);

      // Estimate price: how much tokenOut per 1 tokenIn
      // price = reserveOut / reserveIn (adjusted for decimals)
      const priceRatio = Number(reserveTokenOut) / Number(reserveTokenIn);
      const decimalAdjustment = Math.pow(10, decimals - decimalsOut);
      const tokenInPriceInTokenOut = priceRatio * decimalAdjustment;

      // If tokenOut looks like a stablecoin (6-8 decimals), use it as USD proxy
      if (decimalsOut >= 6 && decimalsOut <= 8) {
        // tokenOut is likely a stablecoin, so price is in USD
        const tokenInPriceUsd = tokenInPriceInTokenOut;
        const tokenAmount = this.tradeSizeUsd / tokenInPriceUsd;
        amountIn = BigInt(Math.floor(tokenAmount * decimalMultiplier));
        logger.debug(`✅ Using price-based calc: tokenIn price = $${tokenInPriceUsd}, amount = ${tokenAmount} tokens = ${amountIn} wei`);
      } else {
        // Can't determine USD price, assume tokenIn is the stablecoin
        amountIn = BigInt(Math.floor(this.tradeSizeUsd * decimalMultiplier));
        logger.debug(`⚠️  Using fallback calc (decimalsOut=${decimalsOut}): $${this.tradeSizeUsd} * 10^${decimals} = ${amountIn} wei`);
      }

      // Use already calculated reserve values
      const buyReserveIn = reserveTokenIn;
      const buyReserveOut = reserveTokenOut;

      // Validate reserves aren't suspiciously small (likely bad data)
      const minReserve = BigInt(1000); // Minimum 1000 wei
      if (buyReserveIn < minReserve || buyReserveOut < minReserve) {
        logger.debug(`Buy pool ${buyPool.id} has tiny reserves: ${buyReserveIn}, ${buyReserveOut}`);
        return null;
      }

      // Calculate output from buy pool
      logger.debug(`💱 Calculating swap: ${amountIn} wei → ?`);
      logger.debug(`  buyReserveIn: ${buyReserveIn}, buyReserveOut: ${buyReserveOut}`);
      logger.debug(`  fee: ${this.config.DEX_FEE_PERCENTAGE}%`);

      const amountOut = SwapCalculator.calculateSwapOutput(
        amountIn,
        buyReserveIn,
        buyReserveOut,
        this.config.DEX_FEE_PERCENTAGE
      );

      logger.debug(`  amountOut: ${amountOut}`);

      if (amountOut === 0n) {
        logger.debug(`  ❌ amountOut is 0, returning null`);
        return null;
      }

      // Determine reserve order for sell pool
      // In sell phase: we're swapping tokenOut back to tokenIn
      // So we need: reserveIn = tokenOut reserve, reserveOut = tokenIn reserve
      const sellTokenOutIsToken0 = sellPool.token0.toLowerCase() === tokenOut.toLowerCase();
      const sellReserveIn = BigInt(sellTokenOutIsToken0 ? sellPool.reserve0 : sellPool.reserve1);
      const sellReserveOut = BigInt(sellTokenOutIsToken0 ? sellPool.reserve1 : sellPool.reserve0);

      // Validate sell pool reserves
      if (sellReserveIn < minReserve || sellReserveOut < minReserve) {
        logger.debug(`Sell pool ${sellPool.id} has tiny reserves: ${sellReserveIn}, ${sellReserveOut}`);
        return null;
      }

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

      // Gas cost in same token decimals
      const gasCostWei = BigInt(Math.floor(this.config.ESTIMATED_GAS_COST_USD * decimalMultiplier));
      const netProfit = grossProfit - flashloanFee - gasCostWei;

      // Convert to USD using correct decimals
      const netProfitUsd = Number(netProfit) / decimalMultiplier;

      // Log calculation details for profitable opportunities
      if (netProfitUsd >= this.minProfitUsd) {
        logger.info(`💰 Profitable opportunity found:`);
        logger.info(`   ${tokenIn} → ${tokenOut} → ${tokenIn}`);
        logger.info(`   Amount in: ${amountIn} (${this.tradeSizeUsd} USD, ${decimals} decimals)`);
        logger.info(`   Amount after buy: ${amountOut}`);
        logger.info(`   Amount final: ${amountFinal}`);
        logger.info(`   Buy pool: ${buyPool.id}`);
        logger.info(`     token0=${buyPool.token0}, token1=${buyPool.token1}`);
        logger.info(`     reserve0=${buyPool.reserve0}, reserve1=${buyPool.reserve1}`);
        logger.info(`     Mapped: Reserve in (${tokenIn}): ${buyReserveIn}, Reserve out (${tokenOut}): ${buyReserveOut}`);
        logger.info(`   Sell pool: ${sellPool.id}`);
        logger.info(`     token0=${sellPool.token0}, token1=${sellPool.token1}`);
        logger.info(`     reserve0=${sellPool.reserve0}, reserve1=${sellPool.reserve1}`);
        logger.info(`     Mapped: Reserve in (${tokenOut}): ${sellReserveIn}, Reserve out (${tokenIn}): ${sellReserveOut}`);
        logger.info(`   Gross profit: ${grossProfit} (${Number(grossProfit) / decimalMultiplier} USD)`);
        logger.info(`   Net profit: ${netProfit} (${netProfitUsd.toFixed(2)} USD)`);
      }

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
    poolPrices: Map<string, number>,
    tokenDecimals: Map<string, number>
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

      // Get token decimals (default to 18 if not found)
      const decimals = tokenDecimals.get(tokenA.toLowerCase()) || 18;
      const decimalMultiplier = Math.pow(10, decimals);

      // Trade size in token wei (using correct decimals)
      const startAmount = BigInt(Math.floor(this.tradeSizeUsd * decimalMultiplier));

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

      // Gas cost in same token decimals
      const gasCostWei = BigInt(Math.floor(this.config.ESTIMATED_GAS_COST_USD * decimalMultiplier));
      const netProfit = grossProfit - flashloanFee - gasCostWei;

      // Convert to USD using correct decimals
      const netProfitUsd = Number(netProfit) / decimalMultiplier;

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
