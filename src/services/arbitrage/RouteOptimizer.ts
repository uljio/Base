'use strict';

import { logger } from '../../services/utils/Logger';
import { Pool } from '../../database/models/Pool';

/**
 * Route Optimizer Service
 * Finds optimal swap routes between tokens considering liquidity and fees
 */
export interface RouteHop {
  poolId: string;
  tokenIn: string;
  tokenOut: string;
  fee: number; // Fee in basis points (e.g., 3000 = 0.3%)
  reserve0: string;
  reserve1: string;
  price: number;
}

export interface OptimalRoute {
  hops: RouteHop[];
  expectedOutput: string;
  priceImpact: number; // As percentage
  totalFees: number; // In basis points
  liquidity: string;
  efficiency: number; // 0-1, higher is better
}

export class RouteOptimizer {
private readonly chainId: number;
  private readonly maxHops: number = 3;

  constructor(chainId: number, maxHops: number = 3) {
    this.chainId = chainId;
  }

  /**
   * Find optimal route between two tokens
   */
  public async findOptimalRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<OptimalRoute> {
    try {
      // Direct 1-hop route
      const directRoute = await this.findDirectRoute(tokenIn, tokenOut, amountIn);

      if (directRoute) {
        return directRoute;
      }

      // Try 2-hop routes
      const twoHopRoute = await this.findMultiHopRoute(
        tokenIn,
        tokenOut,
        amountIn,
        2
      );

      if (twoHopRoute) {
        return twoHopRoute;
      }

      // Try 3-hop routes
      const threeHopRoute = await this.findMultiHopRoute(
        tokenIn,
        tokenOut,
        amountIn,
        3
      );

      if (threeHopRoute) {
        return threeHopRoute;
      }

      throw new Error(`No route found between ${tokenIn} and ${tokenOut}`);
    } catch (error) {
      logger.error(`Failed to find optimal route: ${error}`);
      throw new Error(`Route optimization failed: ${error}`);
    }
  }

  /**
   * Find direct 1-hop route
   */
  private async findDirectRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<OptimalRoute | null> {
    try {
      const pools = await Pool.findBetweenTokens(this.chainId, tokenIn, tokenOut);

      if (pools.length === 0) {
        return null;
      }

      // Find pool with best price
      let bestPool = pools[0];
      let bestOutput = this.calculateOutputAmount(amountIn, bestPool.price);
      let bestPriceImpact = this.calculatePriceImpact(amountIn, bestPool);

      for (const pool of pools) {
        const output = this.calculateOutputAmount(amountIn, pool.price);
        const impact = this.calculatePriceImpact(amountIn, pool);

        // Prefer higher output with lower price impact
        if (output > bestOutput && impact < bestPriceImpact) {
          bestPool = pool;
          bestOutput = output;
          bestPriceImpact = impact;
        } else if (output > bestOutput) {
          bestPool = pool;
          bestOutput = output;
        }
      }

      // Determine token order
      const isReversed = bestPool.token1.toLowerCase() === tokenIn.toLowerCase();
      const actualTokenIn = isReversed ? bestPool.token1 : bestPool.token0;
      const actualTokenOut = isReversed ? bestPool.token0 : bestPool.token1;

      return {
        hops: [
          {
            poolId: bestPool.id || '',
            tokenIn: actualTokenIn,
            tokenOut: actualTokenOut,
            fee: bestPool.fee,
            reserve0: bestPool.reserve0,
            reserve1: bestPool.reserve1,
            price: bestPool.price,
          },
        ],
        expectedOutput: bestOutput,
        priceImpact: bestPriceImpact,
        totalFees: bestPool.fee,
        liquidity: bestPool.liquidity,
        efficiency: Math.max(0, 1 - bestPriceImpact / 100),
      };
    } catch (error) {
      logger.debug(`Direct route not found: ${error}`);
      return null;
    }
  }

  /**
   * Find multi-hop route
   */
  private async findMultiHopRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    hops: number
  ): Promise<OptimalRoute | null> {
    try {
      if (hops === 1) {
        return this.findDirectRoute(tokenIn, tokenOut, amountIn);
      }

      // Get intermediate tokens
      const intermediateTokens = await this.getIntermediateTokens(tokenIn, tokenOut);

      if (intermediateTokens.length === 0) {
        return null;
      }

      let bestRoute: OptimalRoute | null = null;
      let bestOutput = '0';

      for (const intermediate of intermediateTokens) {
        try {
          // Find route from tokenIn to intermediate
          const firstHop = await this.findDirectRoute(tokenIn, intermediate, amountIn);

          if (!firstHop) continue;

          // Find route from intermediate to tokenOut
          const secondHop = await this.findDirectRoute(
            intermediate,
            tokenOut,
            firstHop.expectedOutput
          );

          if (!secondHop) continue;

          const routeHops = [...firstHop.hops, ...secondHop.hops];
          const totalOutput = secondHop.expectedOutput;
          const totalFees = firstHop.totalFees + secondHop.totalFees;
          const totalPriceImpact = firstHop.priceImpact + secondHop.priceImpact;

          if (totalOutput > bestOutput) {
            bestOutput = totalOutput;
            bestRoute = {
              hops: routeHops,
              expectedOutput: totalOutput,
              priceImpact: totalPriceImpact,
              totalFees,
              liquidity: '0', // Combined liquidity
              efficiency: Math.max(0, 1 - totalPriceImpact / 100),
            };
          }
        } catch {
          // Continue with next intermediate token
        }
      }

      return bestRoute;
    } catch (error) {
      logger.debug(`Multi-hop route not found: ${error}`);
      return null;
    }
  }

  /**
   * Get intermediate tokens that connect two tokens
   */
  private async getIntermediateTokens(tokenIn: string, tokenOut: string): Promise<string[]> {
    try {
      const pools = await Pool.findByChain(this.chainId, 1000);

      // Find tokens that connect to both tokenIn and tokenOut
      const connectToIn = new Set<string>();
      const connectToOut = new Set<string>();

      for (const pool of pools) {
        if (pool.token0.toLowerCase() === tokenIn.toLowerCase()) {
          connectToIn.add(pool.token1.toLowerCase());
        }
        if (pool.token1.toLowerCase() === tokenIn.toLowerCase()) {
          connectToIn.add(pool.token0.toLowerCase());
        }

        if (pool.token0.toLowerCase() === tokenOut.toLowerCase()) {
          connectToOut.add(pool.token1.toLowerCase());
        }
        if (pool.token1.toLowerCase() === tokenOut.toLowerCase()) {
          connectToOut.add(pool.token0.toLowerCase());
        }
      }

      // Find intersection
      const intermediate = Array.from(connectToIn).filter(token =>
        connectToOut.has(token)
      );

      return intermediate;
    } catch (error) {
      logger.debug(`Failed to get intermediate tokens: ${error}`);
      return [];
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
   * Calculate price impact from swap
   */
  private calculatePriceImpact(inputAmount: string, pool: any): number {
    try {
      const input = parseFloat(inputAmount);
      const reserve0 = parseFloat(pool.reserve0);
      const reserve1 = parseFloat(pool.reserve1);

      if (reserve0 === 0 || reserve1 === 0) {
        return 100; // Maximum impact
      }

      // Spot price
      const spotPrice = reserve1 / reserve0;

      // Execution price (constant product)
      const outputAmount = (reserve1 * input) / (reserve0 + input);
      const executionPrice = outputAmount / input;

      // Price impact percentage
      const impact = ((spotPrice - executionPrice) / spotPrice) * 100;

      return Math.max(0, impact);
    } catch (error) {
      logger.error(`Failed to calculate price impact: ${error}`);
      return 0;
    }
  }

  /**
   * Validate route is executable
   */
  public validateRoute(route: OptimalRoute): boolean {
    try {
      // Check route has hops
      if (!route.hops || route.hops.length === 0) {
        return false;
      }

      // Check max hops
      if (route.hops.length > this.maxHops) {
        return false;
      }

      // Check price impact is reasonable (< 50%)
      if (route.priceImpact > 50) {
        return false;
      }

      // Check efficiency
      if (route.efficiency < 0.1) {
        return false;
      }

      // Check consecutive hops connect properly
      for (let i = 0; i < route.hops.length - 1; i++) {
        const currentOut = route.hops[i].tokenOut;
        const nextIn = route.hops[i + 1].tokenIn;

        if (currentOut.toLowerCase() !== nextIn.toLowerCase()) {
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error(`Failed to validate route: ${error}`);
      return false;
    }
  }

  /**
   * Estimate execution order for route
   */
  public estimateExecutionOrder(route: OptimalRoute): number[] {
    try {
      // For linear routes, execution order is 0, 1, 2, etc.
      return Array.from({ length: route.hops.length }, (_, i) => i);
    } catch (error) {
      logger.error(`Failed to estimate execution order: ${error}`);
      return [];
    }
  }
}

export default RouteOptimizer;
