'use strict';

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
];

export interface TokenMetadata {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
}

/**
 * Token information fetcher with caching
 */
export class TokenInfo {
  private provider: ethers.Provider;
  private cache: Map<string, TokenMetadata> = new Map();

  // Known token decimals for Base mainnet
  private static readonly KNOWN_DECIMALS: Record<string, number> = {
    '0x4200000000000000000000000000000000000006': 18, // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8,  // cbBTC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 18, // DAI
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 6,  // USDbC
  };

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  /**
   * Get token decimals with caching
   */
  async getDecimals(tokenAddress: string): Promise<number> {
    const normalized = tokenAddress.toLowerCase();

    // Check cache first
    const cached = this.cache.get(normalized);
    if (cached) {
      return cached.decimals;
    }

    // Check known decimals
    const known = TokenInfo.KNOWN_DECIMALS[normalized];
    if (known !== undefined) {
      return known;
    }

    // Fetch from blockchain
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimals = await contract.decimals();
      return Number(decimals);
    } catch (error) {
      logger.warn(`Failed to fetch decimals for ${tokenAddress}, defaulting to 18: ${error}`);
      return 18; // Default to 18 if fetch fails
    }
  }

  /**
   * Get full token metadata with caching
   */
  async getMetadata(tokenAddress: string): Promise<TokenMetadata> {
    const normalized = tokenAddress.toLowerCase();

    // Check cache first
    const cached = this.cache.get(normalized);
    if (cached) {
      return cached;
    }

    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

      const [decimals, symbol, name] = await Promise.all([
        contract.decimals(),
        contract.symbol(),
        contract.name(),
      ]);

      const metadata: TokenMetadata = {
        address: normalized,
        decimals: Number(decimals),
        symbol,
        name,
      };

      // Cache the result
      this.cache.set(normalized, metadata);

      return metadata;
    } catch (error) {
      logger.warn(`Failed to fetch metadata for ${tokenAddress}: ${error}`);

      // Return default metadata
      const defaultMetadata: TokenMetadata = {
        address: normalized,
        decimals: 18,
        symbol: 'UNKNOWN',
        name: 'Unknown Token',
      };

      return defaultMetadata;
    }
  }

  /**
   * Batch fetch decimals for multiple tokens
   */
  async batchGetDecimals(tokenAddresses: string[]): Promise<Map<string, number>> {
    const results = new Map<string, number>();

    // Process in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
      const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (address) => {
        const decimals = await this.getDecimals(address);
        results.set(address.toLowerCase(), decimals);
      });

      await Promise.all(promises);

      // Small delay to avoid RPC rate limits
      if (i + BATCH_SIZE < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info(`Fetched decimals for ${results.size}/${tokenAddresses.length} tokens`);
    return results;
  }

  /**
   * Convert USD amount to token wei amount using decimals
   */
  static usdToTokenWei(usdAmount: number, decimals: number): bigint {
    return BigInt(Math.floor(usdAmount * Math.pow(10, decimals)));
  }

  /**
   * Convert token wei amount to USD using decimals
   */
  static tokenWeiToUsd(weiAmount: bigint, decimals: number): number {
    return Number(weiAmount) / Math.pow(10, decimals);
  }
}

export default TokenInfo;
