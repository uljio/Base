'use strict';

import { logger } from '../utils/Logger';

/**
 * Swap Calculator Service
 * Calculates swap outputs using constant product formula (Uniswap V2/V3)
 */
export interface SwapHop {
  reserveIn: bigint;
  reserveOut: bigint;
  fee: number; // Fee in percentage (e.g., 0.3 for 0.3%)
}

export class SwapCalculator {
  /**
   * Calculate swap output using constant product formula
   * Formula: amountOut = (reserveOut * amountIn * (10000 - fee)) / (reserveIn * 10000 + amountIn * (10000 - fee))
   */
  static calculateSwapOutput(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feePercent: number = 0.3
  ): bigint {
    try {
      if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
        return 0n;
      }

      // Convert fee percentage to basis points (0.3% = 30 bps)
      const feeBps = BigInt(Math.floor(feePercent * 100));
      const amountInWithFee = amountIn * (10000n - feeBps);

      const numerator = amountInWithFee * reserveOut;
      const denominator = (reserveIn * 10000n) + amountInWithFee;

      return numerator / denominator;
    } catch (error) {
      logger.error(`Failed to calculate swap output: ${error}`);
      return 0n;
    }
  }

  /**
   * Calculate price impact percentage
   */
  static calculatePriceImpact(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint
  ): number {
    try {
      if (reserveIn <= 0n || reserveOut <= 0n) {
        return 100; // 100% impact if no reserves
      }

      // Spot price before swap
      const spotPrice = Number(reserveOut * BigInt(1e8) / reserveIn) / 1e8;

      // Amount out with 0 fee to get execution price
      const amountOut = this.calculateSwapOutput(amountIn, reserveIn, reserveOut, 0);
      if (amountOut === 0n) return 100;

      const executionPrice = Number(amountOut * BigInt(1e8) / amountIn) / 1e8;

      // Price impact = (spotPrice - executionPrice) / spotPrice * 100
      return ((spotPrice - executionPrice) / spotPrice) * 100;
    } catch (error) {
      logger.error(`Failed to calculate price impact: ${error}`);
      return 100;
    }
  }

  /**
   * Calculate output through multiple swap hops
   */
  static calculateMultiHopOutput(
    amountIn: bigint,
    path: SwapHop[]
  ): bigint {
    try {
      let currentAmount = amountIn;

      for (const hop of path) {
        currentAmount = this.calculateSwapOutput(
          currentAmount,
          hop.reserveIn,
          hop.reserveOut,
          hop.fee
        );

        if (currentAmount === 0n) {
          return 0n;
        }
      }

      return currentAmount;
    } catch (error) {
      logger.error(`Failed to calculate multi-hop output: ${error}`);
      return 0n;
    }
  }

  /**
   * Calculate total price impact across path
   */
  static calculatePathPriceImpact(
    amountIn: bigint,
    path: SwapHop[]
  ): number {
    try {
      let totalImpact = 0;
      let currentAmount = amountIn;

      for (const hop of path) {
        const impact = this.calculatePriceImpact(
          currentAmount,
          hop.reserveIn,
          hop.reserveOut
        );
        totalImpact += impact;

        currentAmount = this.calculateSwapOutput(
          currentAmount,
          hop.reserveIn,
          hop.reserveOut,
          hop.fee
        );

        if (currentAmount === 0n) break;
      }

      return totalImpact;
    } catch (error) {
      logger.error(`Failed to calculate path price impact: ${error}`);
      return 100;
    }
  }
}

export default SwapCalculator;
