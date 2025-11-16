/**
 * Real-time price monitoring and caching
 */

import { PriceInfo, SwapEvent } from '../../types/dex.types';
import { logger, logPriceUpdate } from '../utils/Logger';
import { getConfig } from '../../config/environment';
import EventEmitter from 'events';

interface CachedPrice {
  price: bigint;
  blockNumber: number;
  timestamp: number;
  dex: string;
  poolAddress: string;
}

export class PriceMonitor extends EventEmitter {
  // Map<tokenPairKey, Map<dex, CachedPrice>>
  private priceCache: Map<string, Map<string, CachedPrice>> = new Map();
  private config = getConfig();

  constructor() {
    super();
  }

  /**
   * Update price from swap event
   */
  updatePrice(swapEvent: SwapEvent): void {
    const pairKey = this.getPairKey(swapEvent.token0, swapEvent.token1);

    if (!this.priceCache.has(pairKey)) {
      this.priceCache.set(pairKey, new Map());
    }

    const dexPrices = this.priceCache.get(pairKey)!;

    const cachedPrice: CachedPrice = {
      price: swapEvent.price,
      blockNumber: swapEvent.blockNumber,
      timestamp: swapEvent.timestamp,
      dex: swapEvent.dex,
      poolAddress: swapEvent.poolAddress,
    };

    dexPrices.set(swapEvent.dex, cachedPrice);

    logPriceUpdate(
      swapEvent.dex,
      swapEvent.token0,
      swapEvent.token1,
      swapEvent.price.toString(),
      swapEvent.blockNumber
    );

    // Emit price update event
    this.emit('priceUpdate', {
      token0: swapEvent.token0,
      token1: swapEvent.token1,
      dex: swapEvent.dex,
      price: swapEvent.price,
      blockNumber: swapEvent.blockNumber,
    });

    // Check for stale prices and emit alerts
    this.checkStalePrices(pairKey);
  }

  /**
   * Get price for specific token pair and DEX
   */
  getPrice(token0: string, token1: string, dex: string): PriceInfo | null {
    const pairKey = this.getPairKey(token0, token1);
    const dexPrices = this.priceCache.get(pairKey);

    if (!dexPrices) {
      return null;
    }

    const cached = dexPrices.get(dex);

    if (!cached) {
      return null;
    }

    return {
      price: cached.price,
      blockNumber: cached.blockNumber,
      timestamp: cached.timestamp,
      poolAddress: cached.poolAddress,
      dex: cached.dex,
    };
  }

  /**
   * Get price with freshness check
   */
  getPriceWithFreshness(
    token0: string,
    token1: string,
    dex: string,
    maxAgeSeconds?: number
  ): PriceInfo | null {
    const price = this.getPrice(token0, token1, dex);

    if (!price) {
      return null;
    }

    const maxAge = maxAgeSeconds || this.config.PRICE_FRESHNESS_SECONDS;
    const age = (Date.now() - price.timestamp) / 1000;

    if (age > maxAge) {
      logger.warn('Price is stale', {
        token0,
        token1,
        dex,
        ageSeconds: age.toFixed(2),
        maxAge,
      });
      return null;
    }

    return price;
  }

  /**
   * Get all prices for a token pair across all DEXs
   */
  getAllPrices(token0: string, token1: string): Map<string, PriceInfo> {
    const pairKey = this.getPairKey(token0, token1);
    const dexPrices = this.priceCache.get(pairKey);
    const result = new Map<string, PriceInfo>();

    if (!dexPrices) {
      return result;
    }

    for (const [dex, cached] of dexPrices.entries()) {
      result.set(dex, {
        price: cached.price,
        blockNumber: cached.blockNumber,
        timestamp: cached.timestamp,
        poolAddress: cached.poolAddress,
        dex: cached.dex,
      });
    }

    return result;
  }

  /**
   * Get price spread between DEXs
   */
  getPriceSpread(
    token0: string,
    token1: string
  ): { highDex: string; lowDex: string; spread: number; spreadPercent: number } | null {
    const prices = this.getAllPrices(token0, token1);

    if (prices.size < 2) {
      return null;
    }

    let highPrice = 0n;
    let lowPrice = BigInt(Number.MAX_SAFE_INTEGER);
    let highDex = '';
    let lowDex = '';

    for (const [dex, priceInfo] of prices.entries()) {
      if (priceInfo.price > highPrice) {
        highPrice = priceInfo.price;
        highDex = dex;
      }
      if (priceInfo.price < lowPrice) {
        lowPrice = priceInfo.price;
        lowDex = dex;
      }
    }

    if (lowPrice === 0n) {
      return null;
    }

    const spread = highPrice - lowPrice;
    const spreadPercent = (Number(spread) / Number(lowPrice)) * 100;

    return {
      highDex,
      lowDex,
      spread: Number(spread),
      spreadPercent,
    };
  }

  /**
   * Check for stale prices
   */
  private checkStalePrices(pairKey: string): void {
    const dexPrices = this.priceCache.get(pairKey);

    if (!dexPrices) {
      return;
    }

    const now = Date.now();
    const maxAge = this.config.PRICE_FRESHNESS_SECONDS * 1000;

    for (const [dex, cached] of dexPrices.entries()) {
      const age = now - cached.timestamp;

      if (age > maxAge) {
        this.emit('stalePrice', {
          pairKey,
          dex,
          ageMs: age,
        });
      }
    }
  }

  /**
   * Get normalized pair key (sorted addresses)
   */
  private getPairKey(token0: string, token1: string): string {
    const [t0, t1] = [token0.toLowerCase(), token1.toLowerCase()].sort();
    return `${t0}-${t1}`;
  }

  /**
   * Clear all cached prices
   */
  clearCache(): void {
    this.priceCache.clear();
    logger.info('Price cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStatistics() {
    let totalPrices = 0;
    let stalePrices = 0;

    const now = Date.now();
    const maxAge = this.config.PRICE_FRESHNESS_SECONDS * 1000;

    for (const [pairKey, dexPrices] of this.priceCache.entries()) {
      for (const [dex, cached] of dexPrices.entries()) {
        totalPrices++;
        const age = now - cached.timestamp;
        if (age > maxAge) {
          stalePrices++;
        }
      }
    }

    return {
      totalPairs: this.priceCache.size,
      totalPrices,
      stalePrices,
      freshPrices: totalPrices - stalePrices,
    };
  }
}
