/**
 * Pool Cache Service
 * Manages cached pool data in SQLite to avoid repeated factory scans
 */

import sqlite from '../../database/sqlite';
import { logger } from '../utils/Logger';
import { PoolInfo } from '../../types/dex.types';
import { CachedPool } from './FactoryScanner';

export interface PoolCacheEntry {
  address: string;
  dex: string;
  dex_type: string;
  token0: string;
  token1: string;
  fee: number;
  discovered_at: number;
  last_scanned: number;
  is_active: boolean;
}

export class PoolCache {
  private static readonly TABLE = 'pool_cache';

  /**
   * Initialize pool cache table (already done in sqlite.ts migrations)
   */
  static initialize(): void {
    logger.info('Pool cache table already initialized via migrations');
  }

  /**
   * Save discovered pools to cache
   */
  static savePoolsToCache(pools: CachedPool[]): number {
    let saved = 0;

    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO ${this.TABLE}
      (address, dex, dex_type, token0, token1, fee, discovered_at, last_scanned, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (const pool of pools) {
      try {
        stmt.run(
          pool.address.toLowerCase(),
          pool.dex,
          pool.dexType,
          pool.token0.toLowerCase(),
          pool.token1.toLowerCase(),
          pool.fee,
          pool.discoveredAt,
          Date.now()
        );
        saved++;
      } catch (error) {
        logger.debug(`Failed to cache pool ${pool.address}:`, error);
      }
    }

    logger.info(`Saved ${saved}/${pools.length} pools to cache`);
    return saved;
  }

  /**
   * Get all active pools from cache
   */
  static getAllCachedPools(): PoolCacheEntry[] {
    const stmt = sqlite.prepare(`
      SELECT * FROM ${this.TABLE}
      WHERE is_active = 1
      ORDER BY discovered_at DESC
    `);

    return stmt.all() as PoolCacheEntry[];
  }

  /**
   * Get pools by DEX
   */
  static getPoolsByDex(dexName: string): PoolCacheEntry[] {
    const stmt = sqlite.prepare(`
      SELECT * FROM ${this.TABLE}
      WHERE dex = ? AND is_active = 1
      ORDER BY discovered_at DESC
    `);

    return stmt.all(dexName) as PoolCacheEntry[];
  }

  /**
   * Get pools for specific token pair
   */
  static getPoolsForTokenPair(token0: string, token1: string): PoolCacheEntry[] {
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();

    const stmt = sqlite.prepare(`
      SELECT * FROM ${this.TABLE}
      WHERE is_active = 1
        AND ((token0 = ? AND token1 = ?) OR (token0 = ? AND token1 = ?))
      ORDER BY fee ASC
    `);

    return stmt.all(t0, t1, t1, t0) as PoolCacheEntry[];
  }

  /**
   * Mark pool as inactive (if it no longer exists)
   */
  static markPoolInactive(address: string): void {
    const stmt = sqlite.prepare(`
      UPDATE ${this.TABLE}
      SET is_active = 0
      WHERE address = ?
    `);

    stmt.run(address.toLowerCase());
  }

  /**
   * Update last scanned timestamp
   */
  static updateLastScanned(address: string): void {
    const stmt = sqlite.prepare(`
      UPDATE ${this.TABLE}
      SET last_scanned = ?
      WHERE address = ?
    `);

    stmt.run(Date.now(), address.toLowerCase());
  }

  /**
   * Get cache statistics
   */
  static getStats(): {
    total: number;
    active: number;
    inactive: number;
    byDex: { dex: string; count: number }[];
  } {
    const total = sqlite.prepare(`SELECT COUNT(*) as count FROM ${this.TABLE}`).get() as { count: number };
    const active = sqlite.prepare(`SELECT COUNT(*) as count FROM ${this.TABLE} WHERE is_active = 1`).get() as { count: number };
    const byDex = sqlite.prepare(`
      SELECT dex, COUNT(*) as count
      FROM ${this.TABLE}
      WHERE is_active = 1
      GROUP BY dex
      ORDER BY count DESC
    `).all() as { dex: string; count: number }[];

    return {
      total: total.count,
      active: active.count,
      inactive: total.count - active.count,
      byDex,
    };
  }

  /**
   * Check if cache needs refresh (older than X hours)
   */
  static needsRefresh(maxAgeHours: number = 24): boolean {
    const stmt = sqlite.prepare(`
      SELECT MIN(discovered_at) as oldest
      FROM ${this.TABLE}
      WHERE is_active = 1
    `);

    const result = stmt.get() as { oldest: number | null };

    if (!result.oldest) {
      return true; // No pools cached
    }

    const ageMs = Date.now() - result.oldest;
    const ageHours = ageMs / (1000 * 60 * 60);

    return ageHours > maxAgeHours;
  }

  /**
   * Clear all cached pools
   */
  static clearCache(): void {
    const stmt = sqlite.prepare(`DELETE FROM ${this.TABLE}`);
    stmt.run();
    logger.info('Pool cache cleared');
  }

  /**
   * Export cache to PoolInfo format for arbitrage detection
   */
  static exportToPoolInfo(): PoolInfo[] {
    const cached = this.getAllCachedPools();

    return cached.map(entry => ({
      address: entry.address,
      dex: entry.dex,
      dexType: entry.dex_type as any,
      token0: {
        address: entry.token0,
        symbol: '',  // Will be fetched later if needed
        name: '',
        decimals: 18,
      },
      token1: {
        address: entry.token1,
        symbol: '',
        name: '',
        decimals: 18,
      },
      fee: entry.fee,
      liquidityUSD: 0, // Will be calculated from reserves
      volume24hUSD: 0,
      lastUpdate: entry.last_scanned || entry.discovered_at,
    }));
  }
}

export default PoolCache;
