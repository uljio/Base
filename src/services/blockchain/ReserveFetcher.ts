'use strict';

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { CurlRpcProvider } from './CurlRpcProvider';

const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

const UNISWAP_V3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
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
  private v2Iface: ethers.Interface;
  private v3Iface: ethers.Interface;

  constructor(provider: ethers.Provider | CurlRpcProvider) {
    this.provider = provider;
    this.v2Iface = new ethers.Interface(UNISWAP_V2_PAIR_ABI);
    this.v3Iface = new ethers.Interface(UNISWAP_V3_POOL_ABI);
  }

  /**
   * Fetch reserves for a single pool
   * Tries V3 first, then falls back to V2
   */
  async fetchReserves(poolAddress: string): Promise<PoolReserves | null> {
    try {
      // Check if we're using CurlRpcProvider
      if (this.provider instanceof CurlRpcProvider) {
        // Try V3 first
        const v3Reserves = await this.fetchV3ReservesWithCurl(poolAddress);
        if (v3Reserves) return v3Reserves;

        // Fallback to V2
        return await this.fetchV2ReservesWithCurl(poolAddress);
      } else {
        // Try V3 first
        const v3Reserves = await this.fetchV3ReservesWithEthers(poolAddress);
        if (v3Reserves) return v3Reserves;

        // Fallback to V2
        return await this.fetchV2ReservesWithEthers(poolAddress);
      }
    } catch (error) {
      logger.debug(`Failed to fetch reserves for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Fetch V3 reserves using curl-based RPC provider
   */
  private async fetchV3ReservesWithCurl(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const curlProvider = this.provider as CurlRpcProvider;

      // Encode function calls for V3
      const slot0Data = this.v3Iface.encodeFunctionData('slot0', []);
      const liquidityData = this.v3Iface.encodeFunctionData('liquidity', []);
      const token0Data = this.v3Iface.encodeFunctionData('token0', []);
      const token1Data = this.v3Iface.encodeFunctionData('token1', []);

      // Make batch RPC call
      const results = await curlProvider.batchCall([
        { method: 'eth_call', params: [{ to: poolAddress, data: slot0Data }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: liquidityData }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: token0Data }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: token1Data }, 'latest'] },
      ]);

      // Decode results
      const slot0Result = this.v3Iface.decodeFunctionResult('slot0', results[0]);
      const sqrtPriceX96 = slot0Result[0];
      const [liquidity] = this.v3Iface.decodeFunctionResult('liquidity', results[1]);
      const [token0] = this.v3Iface.decodeFunctionResult('token0', results[2]);
      const [token1] = this.v3Iface.decodeFunctionResult('token1', results[3]);

      // Convert V3 liquidity to V2-style reserves
      // For V3, we approximate reserves from liquidity and sqrtPriceX96
      const reserves = this.v3ToV2Reserves(sqrtPriceX96, liquidity);

      return {
        reserve0: reserves.reserve0,
        reserve1: reserves.reserve1,
        timestamp: Math.floor(Date.now() / 1000),
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
      };
    } catch (error) {
      logger.debug(`Failed to fetch V3 reserves with curl for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Fetch V2 reserves using curl-based RPC provider
   */
  private async fetchV2ReservesWithCurl(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const curlProvider = this.provider as CurlRpcProvider;

      // Encode function calls
      const getReservesData = this.v2Iface.encodeFunctionData('getReserves', []);
      const token0Data = this.v2Iface.encodeFunctionData('token0', []);
      const token1Data = this.v2Iface.encodeFunctionData('token1', []);

      // Make batch RPC call
      const results = await curlProvider.batchCall([
        { method: 'eth_call', params: [{ to: poolAddress, data: getReservesData }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: token0Data }, 'latest'] },
        { method: 'eth_call', params: [{ to: poolAddress, data: token1Data }, 'latest'] },
      ]);

      // Decode results
      const [reserve0, reserve1, timestamp] = this.v2Iface.decodeFunctionResult('getReserves', results[0]);
      const [token0] = this.v2Iface.decodeFunctionResult('token0', results[1]);
      const [token1] = this.v2Iface.decodeFunctionResult('token1', results[2]);

      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        timestamp: Number(timestamp),
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
      };
    } catch (error) {
      logger.debug(`Failed to fetch V2 reserves with curl for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Convert V3 liquidity to V2-style reserves
   */
  private v3ToV2Reserves(sqrtPriceX96: bigint, liquidity: bigint): { reserve0: string; reserve1: string } {
    try {
      // sqrtPriceX96 = sqrt(price) * 2^96
      // price = (sqrtPriceX96 / 2^96)^2 = reserve1 / reserve0

      // Calculate price from sqrtPriceX96
      const Q96 = BigInt(2) ** BigInt(96);
      const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
      const price = sqrtPrice * sqrtPrice;

      // Approximate reserves from liquidity
      // L = sqrt(reserve0 * reserve1)
      // reserve0 = L / sqrt(price)
      // reserve1 = L * sqrt(price)

      const liquidityNum = Number(liquidity);
      const reserve0 = BigInt(Math.floor(liquidityNum / sqrtPrice));
      const reserve1 = BigInt(Math.floor(liquidityNum * sqrtPrice));

      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
      };
    } catch (error) {
      logger.debug(`Failed to convert V3 to V2 reserves: ${error}`);
      // Return minimal reserves on error
      return {
        reserve0: '1000000000000000000',
        reserve1: '1000000000000000000',
      };
    }
  }

  /**
   * Fetch V3 reserves using ethers.js provider
   */
  private async fetchV3ReservesWithEthers(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const ethersProvider = this.provider as ethers.Provider;
      const contract = new ethers.Contract(
        poolAddress,
        UNISWAP_V3_POOL_ABI,
        ethersProvider
      );

      // Fetch V3 pool data
      const [slot0, liquidity, token0, token1] = await Promise.all([
        contract.slot0(),
        contract.liquidity(),
        contract.token0(),
        contract.token1(),
      ]);

      const sqrtPriceX96 = slot0.sqrtPriceX96;

      // Convert V3 liquidity to V2-style reserves
      const reserves = this.v3ToV2Reserves(sqrtPriceX96, liquidity);

      return {
        reserve0: reserves.reserve0,
        reserve1: reserves.reserve1,
        timestamp: Math.floor(Date.now() / 1000),
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
      };
    } catch (error) {
      logger.debug(`Failed to fetch V3 reserves with ethers for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Fetch V2 reserves using ethers.js provider (fallback)
   */
  private async fetchV2ReservesWithEthers(poolAddress: string): Promise<PoolReserves | null> {
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
      logger.debug(`Failed to fetch V2 reserves with ethers for ${poolAddress}: ${error}`);
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
