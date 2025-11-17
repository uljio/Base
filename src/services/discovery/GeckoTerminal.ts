/**
 * Pool discovery using GeckoTerminal API
 */

import axios, { AxiosInstance } from 'axios';
import { PoolInfo, DexType } from '../../types/dex.types';
import { getTokenByAddress } from '../../config/tokens';
import { getDexConfig } from '../../config/dexes';
import { getConfig } from '../../config/environment';
import { logger, logServiceStart, logServiceError } from '../utils/Logger';
import { RateLimiter, withRetry } from '../utils/ErrorHandler';

interface GeckoPool {
  id: string;
  type: string;
  attributes: {
    address: string;
    name: string;
    pool_created_at: string;
    token_price_usd: string;
    base_token_price_usd: string;
    quote_token_price_usd: string;
    reserve_in_usd: string;
    volume_usd: {
      h24: string;
    };
    fdv_usd: string;
  };
  relationships: {
    base_token: {
      data: {
        id: string;
        type: string;
      };
    };
    quote_token: {
      data: {
        id: string;
        type: string;
      };
    };
    dex: {
      data: {
        id: string;
        type: string;
      };
    };
  };
}

interface GeckoResponse {
  data: GeckoPool[];
  included?: any[];
}

export class GeckoTerminal {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private cache: Map<string, { data: PoolInfo[]; timestamp: number }> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
  private config = getConfig();

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.geckoterminal.com/api/v2',
      timeout: 10000,
      headers: {
        Accept: 'application/json',
      },
    });

    // GeckoTerminal rate limit: 30 requests per minute
    this.rateLimiter = new RateLimiter(30, 1 / 60); // 30 tokens, refill at 0.5 per second
  }

  /**
   * Discover top pools on Base chain
   */
  async discoverPools(): Promise<PoolInfo[]> {
    const cacheKey = 'base-pools';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug('Returning cached pools', { count: cached.data.length });
      return cached.data;
    }

    try {
      logger.info('Discovering pools from GeckoTerminal...');

      await this.rateLimiter.acquire();

      const pools = await withRetry(
        async () => {
          const response = await this.client.get<GeckoResponse>(
            '/networks/base/pools',
            {
              params: {
                sort: 'h24_volume_usd_desc',
                page: 1,
              },
            }
          );

          return this.parsePools(response.data);
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
        },
        'GeckoTerminal API request'
      );

      // Filter pools based on configuration
      const filteredPools = pools.filter(
        (pool) => pool.liquidityUSD >= this.config.MIN_LIQUIDITY_USD
      );

      // Sort by volume and take top N
      const topPools = filteredPools
        .sort((a, b) => b.volume24hUSD - a.volume24hUSD)
        .slice(0, this.config.MAX_POOLS_TO_MONITOR);

      logger.info('Pools discovered', {
        total: pools.length,
        filtered: filteredPools.length,
        selected: topPools.length,
      });

      // Cache results
      this.cache.set(cacheKey, { data: topPools, timestamp: Date.now() });

      return topPools;
    } catch (error) {
      logServiceError('GeckoTerminal', error as Error);
      throw error;
    }
  }

  /**
   * Get pool details by address
   */
  async getPool(poolAddress: string): Promise<PoolInfo | null> {
    try {
      await this.rateLimiter.acquire();

      const response = await this.client.get<GeckoResponse>(
        `/networks/base/pools/${poolAddress}`
      );

      const pools = this.parsePools(response.data);
      return pools[0] || null;
    } catch (error) {
      logger.warn('Failed to get pool details', {
        poolAddress,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Parse GeckoTerminal API response
   */
  private parsePools(response: GeckoResponse): PoolInfo[] {
    const pools: PoolInfo[] = [];

    for (const pool of response.data) {
      try {
        const poolInfo = this.parsePool(pool, response.included);
        if (poolInfo) {
          pools.push(poolInfo);
        }
      } catch (error) {
        logger.debug('Failed to parse pool', {
          poolAddress: pool.attributes.address,
          error: (error as Error).message,
        });
      }
    }

    return pools;
  }

  /**
   * Parse single pool
   */
  private parsePool(pool: GeckoPool, included?: any[]): PoolInfo | null {
    const address = pool.attributes.address;
    const liquidityUSD = parseFloat(pool.attributes.reserve_in_usd || '0');
    const volume24hUSD = parseFloat(pool.attributes.volume_usd?.h24 || '0');

    // Get DEX name from relationships
    const dexId = pool.relationships.dex?.data?.id || 'unknown';
    const dexName = this.extractDexName(dexId);

    // Get token information
    const token0Address = this.findTokenAddress(pool.relationships.base_token, included);
    const token1Address = this.findTokenAddress(pool.relationships.quote_token, included);

    if (!token0Address || !token1Address) {
      return null;
    }

    const token0 = getTokenByAddress(token0Address);
    const token1 = getTokenByAddress(token1Address);

    if (!token0 || !token1) {
      logger.debug('Unknown tokens in pool', { token0Address, token1Address });
      return null;
    }

    // Determine DEX type and fee
    const dexConfig = getDexConfig(dexName);
    const dexType = dexConfig?.type || DexType.UNISWAP_V2;
    const fee = dexConfig?.defaultFee || 30;

    return {
      address,
      dex: dexName,
      dexType,
      token0,
      token1,
      fee,
      liquidityUSD,
      volume24hUSD,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Extract DEX name from ID
   */
  private extractDexName(dexId: string): string {
    // GeckoTerminal IDs are like "base_uniswap-v3"
    const parts = dexId.split('_');
    if (parts.length > 1) {
      const name = parts[1].replace(/-/g, ' ');
      return name
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    return dexId;
  }

  /**
   * Find token address from included data
   */
  private findTokenAddress(tokenRef: any, included?: any[]): string | null {
    if (!included || !tokenRef?.data?.id) {
      return null;
    }

    const tokenData = included.find(
      (item) => item.type === 'token' && item.id === tokenRef.data.id
    );

    return tokenData?.attributes?.address || null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('GeckoTerminal cache cleared');
  }
}
