'use strict';

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';

const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

export interface PoolReserves {
  reserve0: string;
  reserve1: string;
  timestamp: number;
}

export class ReserveFetcher {
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  /**
   * Fetch reserves for a single pool
   */
  async fetchReserves(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const contract = new ethers.Contract(
        poolAddress,
        UNISWAP_V2_PAIR_ABI,
        this.provider
      );

      const [reserve0, reserve1, timestamp] = await contract.getReserves();

      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        timestamp: Number(timestamp),
      };
    } catch (error) {
      logger.debug(`Failed to fetch reserves for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Batch fetch reserves for multiple pools
   * Fetches in parallel with concurrency limit to avoid RPC rate limits
   */
  async batchFetchReserves(
    poolAddresses: string[]
  ): Promise<Map<string, PoolReserves>> {
    const results = new Map<string, PoolReserves>();

    // Fetch in parallel with concurrency limit
    const BATCH_SIZE = 10;
    for (let i = 0; i < poolAddresses.length; i += BATCH_SIZE) {
      const batch = poolAddresses.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (address) => {
        const reserves = await this.fetchReserves(address);
        if (reserves) {
          results.set(address.toLowerCase(), reserves);
        }
      });

      await Promise.all(promises);

      // Small delay to avoid RPC rate limits
      if (i + BATCH_SIZE < poolAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info(`Fetched reserves for ${results.size}/${poolAddresses.length} pools`);

    return results;
  }

  /**
   * Verify pool exists by checking if it has valid reserves
   */
  async verifyPool(poolAddress: string): Promise<boolean> {
    try {
      const reserves = await this.fetchReserves(poolAddress);
      return reserves !== null &&
             BigInt(reserves.reserve0) > 0n &&
             BigInt(reserves.reserve1) > 0n;
    } catch (error) {
      return false;
    }
  }
}

export default ReserveFetcher;
