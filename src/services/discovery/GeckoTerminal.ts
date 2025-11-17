/**
 * Pool discovery using GeckoTerminal API
 */

import axios, { AxiosInstance } from 'axios';
import { PoolInfo, DexType, TokenInfo } from '../../types/dex.types';
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

      // Fetch multiple pages with different sort strategies
      const allPools = await this.fetchMultiplePages(this.config.GECKO_PAGES_TO_FETCH);

      logger.info(`Fetched ${allPools.length} pools from ${this.config.GECKO_PAGES_TO_FETCH} pages`);

      // Filter pools based on configuration
      const filteredPools = allPools.filter(
        (pool) => pool.liquidityUSD >= this.config.MIN_LIQUIDITY_USD
      );

      // Build token connectivity map
      const tokenConnectivity = this.buildTokenConnectivity(filteredPools);

      // Score pools
      const scoredPools = filteredPools.map(pool => ({
        pool,
        score: this.scorePool(pool, tokenConnectivity)
      }));

      // Sort by score and take top N
      const topPools = scoredPools
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.MAX_POOLS_TO_MONITOR)
        .map(sp => sp.pool);

      logger.info('Pools discovered', {
        total: allPools.length,
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
   * Fetch multiple pages with different sorting strategies
   */
  private async fetchMultiplePages(pageCount: number): Promise<PoolInfo[]> {
    const poolMap = new Map<string, PoolInfo>();

    // Strategy 1: High volume (pages 1-15)
    const volumePages = Math.min(15, pageCount);
    for (let page = 1; page <= volumePages; page++) {
      const pools = await this.fetchPage(page, 'h24_volume_usd_desc');
      pools.forEach(pool => poolMap.set(pool.address.toLowerCase(), pool));
    }

    // Strategy 2: High liquidity (pages 1-7)
    const liquidityPages = Math.min(7, Math.max(0, pageCount - volumePages));
    if (liquidityPages > 0) {
      for (let page = 1; page <= liquidityPages; page++) {
        const pools = await this.fetchPage(page, 'liquidity_usd_desc');
        pools.forEach(pool => poolMap.set(pool.address.toLowerCase(), pool));
      }
    }

    // Strategy 3: High tx count (pages 1-3)
    const txPages = Math.min(3, Math.max(0, pageCount - volumePages - liquidityPages));
    if (txPages > 0) {
      for (let page = 1; page <= txPages; page++) {
        const pools = await this.fetchPage(page, 'h24_tx_count_desc');
        pools.forEach(pool => poolMap.set(pool.address.toLowerCase(), pool));
      }
    }

    return Array.from(poolMap.values());
  }

  /**
   * Fetch a single page with specified sorting
   */
  private async fetchPage(page: number, sort: string): Promise<PoolInfo[]> {
    try {
      await this.rateLimiter.acquire();

      const pools = await withRetry(
        async () => {
          const response = await this.client.get<GeckoResponse>(
            '/networks/base/pools',
            {
              params: { sort, page },
            }
          );

          return this.parsePools(response.data);
        },
        {
          maxAttempts: 3,
          delayMs: 2000,
        },
        `GeckoTerminal API request (page ${page}, sort ${sort})`
      );

      logger.debug(`Fetched page ${page} with sort=${sort}`, {
        count: pools.length
      });

      return pools;
    } catch (error) {
      logger.warn(`Failed to fetch page ${page}: ${error}`);
      return [];
    }
  }

  /**
   * Build token connectivity map (how many pools each token appears in)
   */
  private buildTokenConnectivity(pools: PoolInfo[]): Map<string, number> {
    const connectivity = new Map<string, number>();

    pools.forEach(pool => {
      const token0 = pool.token0.address.toLowerCase();
      const token1 = pool.token1.address.toLowerCase();

      connectivity.set(token0, (connectivity.get(token0) || 0) + 1);
      connectivity.set(token1, (connectivity.get(token1) || 0) + 1);
    });

    return connectivity;
  }

  /**
   * Score pool based on multiple factors
   */
  private scorePool(
    pool: PoolInfo,
    tokenConnectivity: Map<string, number>
  ): number {
    const BASE_TOKENS = [
      '0x4200000000000000000000000000000000000006', // WETH
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
      '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', // cbBTC
    ];

    let score = 0;

    // 1. Liquidity score (30 points)
    if (pool.liquidityUSD >= 500000) score += 30;
    else if (pool.liquidityUSD >= 100000) score += 25;
    else if (pool.liquidityUSD >= 50000) score += 20;
    else if (pool.liquidityUSD >= 25000) score += 15;

    // 2. Volume/Liquidity ratio (20 points)
    const ratio = pool.volume24hUSD / Math.max(pool.liquidityUSD, 1);
    if (ratio >= 0.5) score += 20;
    else if (ratio >= 0.1) score += 15;
    else if (ratio >= 0.05) score += 10;
    else score += 5;

    // 3. Token connectivity (30 points)
    const token0Conn = tokenConnectivity.get(pool.token0.address.toLowerCase()) || 0;
    const token1Conn = tokenConnectivity.get(pool.token1.address.toLowerCase()) || 0;
    const avgConn = (token0Conn + token1Conn) / 2;
    score += Math.min(30, avgConn * 3);

    // 4. Base token bonus (20 points)
    const hasBaseToken = BASE_TOKENS.some(
      base => base.toLowerCase() === pool.token0.address.toLowerCase() ||
              base.toLowerCase() === pool.token1.address.toLowerCase()
    );
    if (hasBaseToken) score += 20;

    return score;
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
      logger.debug('Missing token addresses', {
        poolAddress: address,
        token0Address,
        token1Address,
        baseTokenId: pool.relationships.base_token?.data?.id,
        quoteTokenId: pool.relationships.quote_token?.data?.id,
        includedCount: included?.length || 0,
      });
      return null;
    }

    // Try to get token from whitelist first
    let token0 = getTokenByAddress(token0Address);
    let token1 = getTokenByAddress(token1Address);

    // If ACCEPT_ALL_TOKENS is enabled, create tokens dynamically from API data when not in whitelist
    if (this.config.ACCEPT_ALL_TOKENS) {
      if (!token0) {
        token0 = this.createTokenInfo(
          token0Address,
          pool.relationships.base_token,
          included
        );
      }

      if (!token1) {
        token1 = this.createTokenInfo(
          token1Address,
          pool.relationships.quote_token,
          included
        );
      }
    }

    // Skip pool if tokens not found
    if (!token0 || !token1) {
      if (this.config.ACCEPT_ALL_TOKENS) {
        logger.debug('Could not create token info for pool', { token0Address, token1Address });
      } else {
        logger.debug('Skipping pool with non-whitelisted tokens', { token0Address, token1Address });
      }
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
   * Create TokenInfo from GeckoTerminal API data
   */
  private createTokenInfo(
    address: string,
    tokenRef: any,
    included?: any[]
  ): TokenInfo | undefined {
    try {
      // Try to find token details in included data
      const tokenId = tokenRef?.data?.id;
      let tokenData = null;

      if (included && tokenId) {
        tokenData = included.find(
          (item) => item.type === 'token' && item.id === tokenId
        );
      }

      // Extract token info
      const symbol = tokenData?.attributes?.symbol || this.extractSymbolFromAddress(address);
      const name = tokenData?.attributes?.name || symbol;
      const decimals = tokenData?.attributes?.decimals || 18; // Default to 18 if unknown

      return {
        address: address.toLowerCase(),
        symbol,
        name,
        decimals,
      };
    } catch (error) {
      logger.debug('Failed to create token info', { address, error });
      return undefined;
    }
  }

  /**
   * Extract a simple symbol from token address when no metadata available
   */
  private extractSymbolFromAddress(address: string): string {
    // Return shortened address as symbol fallback
    return `TOKEN_${address.substring(2, 8).toUpperCase()}`;
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
   * Find token address from token reference
   * Token IDs have format: {network}_{address}
   * Example: base_0x4200000000000000000000000000000000000006
   */
  private findTokenAddress(tokenRef: any, included?: any[]): string | null {
    if (!tokenRef?.data?.id) {
      return null;
    }

    const tokenId = tokenRef.data.id;

    // First try to extract address from token ID (format: network_address)
    const parts = tokenId.split('_');
    if (parts.length >= 2) {
      const address = parts.slice(1).join('_'); // Handle addresses with underscores
      if (address.startsWith('0x') && address.length === 42) {
        return address.toLowerCase();
      }
    }

    // Fallback: Try to find token in included data
    if (included && included.length > 0) {
      const tokenData = included.find(
        (item) => item.type === 'token' && item.id === tokenId
      );

      if (tokenData?.attributes?.address) {
        return tokenData.attributes.address.toLowerCase();
      }
    }

    logger.debug('Could not extract token address', {
      tokenId,
      hasIncluded: !!included,
    });

    return null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('GeckoTerminal cache cleared');
  }
}
