'use strict';

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { CurlRpcProvider } from './CurlRpcProvider';

const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

export interface PoolReserves {
  reserve0: string;
  reserve1: string;
  timestamp: number;
  token0: string;  // Actual token0 from the pool contract
  token1: string;  // Actual token1 from the pool contract
}

export class ReserveFetcher {
  private provider: ethers.Provider | CurlRpcProvider;
  private iface: ethers.Interface;

  constructor(provider: ethers.Provider | CurlRpcProvider) {
    this.provider = provider;
    this.iface = new ethers.Interface(UNISWAP_V2_PAIR_ABI);
  }

  /**
   * Fetch reserves for a single pool
   */
  async fetchReserves(poolAddress: string): Promise<PoolReserves | null> {
    try {
      // Check if we're using CurlRpcProvider
      if (this.provider instanceof CurlRpcProvider) {
        return await this.fetchReservesWithCurl(poolAddress);
      } else {
        return await this.fetchReservesWithEthers(poolAddress);
      }
    } catch (error) {
      logger.debug(`Failed to fetch reserves for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Fetch reserves using curl-based RPC provider
   */
  private async fetchReservesWithCurl(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const curlProvider = this.provider as CurlRpcProvider;

      // Encode function calls
      const getReservesData = this.iface.encodeFunctionData('getReserves', []);
      const token0Data = this.iface.encodeFunctionData('token0', []);
      const token1Data = this.iface.encodeFunctionData('token1', []);

      // Make batch RPC call
      const results = await curlProvider.batchCall([
        { method: 'eth_call', params: [{ to: poolAddress, data: getReservesData }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: token0Data }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: token1Data }, 'latest'] },
      ]);

      // Decode results
      const [reserve0, reserve1, timestamp] = this.iface.decodeFunctionResult('getReserves', results[0]);
      const [token0] = this.iface.decodeFunctionResult('token0', results[1]);
      const [token1] = this.iface.decodeFunctionResult('token1', results[2]);

      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        timestamp: Number(timestamp),
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
      };
    } catch (error) {
      logger.debug(`Failed to fetch reserves with curl for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Fetch reserves using ethers.js provider (fallback)
   */
  private async fetchReservesWithEthers(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const ethersProvider = this.provider as ethers.Provider;
      const contract = new ethers.Contract(
        poolAddress,
        UNISWAP_V2_PAIR_ABI,
        ethersProvider
      );

      // Fetch reserves and token addresses from the pool contract
      const [[reserve0, reserve1, timestamp], token0, token1] = await Promise.all([
        contract.getReserves(),
        contract.token0(),
        contract.token1(),
      ]);

      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        timestamp: Number(timestamp),
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
      };
    } catch (error) {
      logger.debug(`Failed to fetch reserves with ethers for ${poolAddress}: ${error}`);
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
