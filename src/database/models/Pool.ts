'use strict';

import { v4 as uuidv4 } from 'uuid';
import sqlite from '../sqlite';
import { logger } from '../../services/utils/Logger';

/**
 * Pool Model with CRUD operations
 * Manages liquidity pool data for price tracking
 */
export interface PoolData {
  id?: string;
  chain_id: number;
  token0: string;
  token1: string;
  reserve0: string;
  reserve1: string;
  fee: number;
  liquidity: string;
  price: number;
  last_updated?: number;
}

export class Pool {
private static readonly TABLE = 'pools';

  /**
   * Create or update pool record (upsert)
   */
  public static async upsert(data: Omit<PoolData, 'id' | 'last_updated'>): Promise<PoolData> {
    try {
      const id = this.generatePoolId(data.chain_id, data.token0, data.token1, data.fee);
      const now = Date.now();

      // Check if pool exists
      const existing = await this.findById(id);

      if (existing) {
        // Update existing pool
        const stmt = sqlite.prepare(`
          UPDATE ${this.TABLE}
          SET reserve0 = ?, reserve1 = ?, liquidity = ?, price = ?, last_updated = ?
          WHERE id = ?
        `);

        stmt.run(
          data.reserve0,
          data.reserve1,
          data.liquidity,
          data.price,
          now,
          id
        );

        logger.debug(`Updated pool ${id}`);
      } else {
        // Create new pool
        const stmt = sqlite.prepare(`
          INSERT INTO ${this.TABLE} (
            id, chain_id, token0, token1, reserve0, reserve1, fee, liquidity, price, last_updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          id,
          data.chain_id,
          data.token0,
          data.token1,
          data.reserve0,
          data.reserve1,
          data.fee,
          data.liquidity,
          data.price,
          now
        );

        logger.info(`Created pool ${id}`);
      }

      return {
        id,
        ...data,
        last_updated: now,
      };
    } catch (error) {
      logger.error(`Failed to upsert pool: ${error}`);
      throw new Error(`Pool upsert failed: ${error}`);
    }
  }

  /**
   * Find pool by ID
   */
  public static async findById(id: string): Promise<PoolData | null> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE} WHERE id = ?
      `);

      const row = stmt.get(id) as PoolData | undefined;
      return row || null;
    } catch (error) {
      logger.error(`Failed to find pool ${id}: ${error}`);
      throw new Error(`Pool lookup failed: ${error}`);
    }
  }

  /**
   * Find pool by tokens and chain
   */
  public static async findByTokens(
    chainId: number,
    token0: string,
    token1: string,
    fee: number
  ): Promise<PoolData | null> {
    try {
      const id = this.generatePoolId(chainId, token0, token1, fee);
      return this.findById(id);
    } catch (error) {
      logger.error(`Failed to find pool by tokens: ${error}`);
      throw new Error(`Token pool lookup failed: ${error}`);
    }
  }

  /**
   * Find all pools for a chain
   */
  public static async findByChain(chainId: number, limit: number = 1000): Promise<PoolData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE chain_id = ?
        ORDER BY liquidity DESC
        LIMIT ?
      `);

      const rows = stmt.all(chainId, limit) as PoolData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find pools by chain: ${error}`);
      throw new Error(`Chain pools lookup failed: ${error}`);
    }
  }

  /**
   * Find pools containing a specific token
   */
  public static async findByToken(
    chainId: number,
    tokenAddress: string,
    limit: number = 100
  ): Promise<PoolData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE chain_id = ? AND (token0 = ? OR token1 = ?)
        ORDER BY liquidity DESC
        LIMIT ?
      `);

      const rows = stmt.all(chainId, tokenAddress, tokenAddress, limit) as PoolData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find pools by token: ${error}`);
      throw new Error(`Token pools lookup failed: ${error}`);
    }
  }

  /**
   * Find pools between two tokens
   */
  public static async findBetweenTokens(
    chainId: number,
    token0: string,
    token1: string
  ): Promise<PoolData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE chain_id = ? AND (
          (token0 = ? AND token1 = ?) OR
          (token0 = ? AND token1 = ?)
        )
        ORDER BY liquidity DESC
      `);

      const rows = stmt.all(chainId, token0, token1, token1, token0) as PoolData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find pools between tokens: ${error}`);
      throw new Error(`Token pair pools lookup failed: ${error}`);
    }
  }

  /**
   * Get pools that need updating (stale data)
   */
  public static async findStale(chainId: number, maxAgeMs: number = 60000): Promise<PoolData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE chain_id = ? AND (last_updated IS NULL OR last_updated < ?)
        ORDER BY last_updated ASC
        LIMIT 100
      `);

      const rows = stmt.all(chainId, Date.now() - maxAgeMs) as PoolData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find stale pools: ${error}`);
      throw new Error(`Stale pools lookup failed: ${error}`);
    }
  }

  /**
   * Update pool reserves and price
   */
  public static async updateReserves(
    id: string,
    reserve0: string,
    reserve1: string,
    price: number
  ): Promise<void> {
    try {
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET reserve0 = ?, reserve1 = ?, price = ?, last_updated = ?
        WHERE id = ?
      `);

      stmt.run(reserve0, reserve1, price, Date.now(), id);
      logger.debug(`Updated reserves for pool ${id}`);
    } catch (error) {
      logger.error(`Failed to update reserves: ${error}`);
      throw new Error(`Reserve update failed: ${error}`);
    }
  }

  /**
   * Update pool liquidity
   */
  public static async updateLiquidity(id: string, liquidity: string): Promise<void> {
    try {
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET liquidity = ?, last_updated = ?
        WHERE id = ?
      `);

      stmt.run(liquidity, Date.now(), id);
    } catch (error) {
      logger.error(`Failed to update liquidity: ${error}`);
      throw new Error(`Liquidity update failed: ${error}`);
    }
  }

  /**
   * Delete pool by ID
   */
  public static async delete(id: string): Promise<boolean> {
    try {
      const stmt = sqlite.prepare(`DELETE FROM ${this.TABLE} WHERE id = ?`);
      const result = stmt.run(id);
      const deleted = (result.changes || 0) > 0;

      if (deleted) {
        logger.info(`Deleted pool ${id}`);
      }

      return deleted;
    } catch (error) {
      logger.error(`Failed to delete pool: ${error}`);
      throw new Error(`Pool deletion failed: ${error}`);
    }
  }

  /**
   * Get pool statistics
   */
  public static async getStats(chainId?: number): Promise<{
    total: number;
    totalLiquidity: number;
    avgPrice: number;
  }> {
    try {
      let query = `
        SELECT
          COUNT(*) as total,
          SUM(CAST(liquidity AS NUMERIC)) as total_liquidity,
          AVG(price) as avg_price
        FROM ${this.TABLE}
      `;

      const params: any[] = [];

      if (chainId !== undefined) {
        query += ` WHERE chain_id = ?`;
        params.push(chainId);
      }

      const stmt = sqlite.prepare(query);
      const row = stmt.get(...params) as any;

      return {
        total: row.total || 0,
        totalLiquidity: parseFloat(row.total_liquidity || 0),
        avgPrice: row.avg_price || 0,
      };
    } catch (error) {
      logger.error(`Failed to get statistics: ${error}`);
      throw new Error(`Statistics retrieval failed: ${error}`);
    }
  }

  /**
   * Clean up old pool records
   */
  public static async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const stmt = sqlite.prepare(`
        DELETE FROM ${this.TABLE}
        WHERE last_updated IS NOT NULL AND last_updated < ?
      `);

      const result = stmt.run(Date.now() - maxAgeMs);
      const deleted = result.changes || 0;

      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old pool records`);
      }

      return deleted;
    } catch (error) {
      logger.error(`Failed to cleanup pools: ${error}`);
      throw new Error(`Pool cleanup failed: ${error}`);
    }
  }

  /**
   * Generate unique pool ID
   */
  private static generatePoolId(chainId: number, token0: string, token1: string, fee: number): string {
    const normalized0 = token0.toLowerCase();
    const normalized1 = token1.toLowerCase();
    return `${chainId}-${normalized0}-${normalized1}-${fee}`;
  }

  /**
   * Calculate price from reserves
   */
  public static calculatePrice(reserve0: string, reserve1: string): number {
    try {
      const r0 = parseFloat(reserve0);
      const r1 = parseFloat(reserve1);

      if (r0 === 0 || r1 === 0) {
        return 0;
      }

      return r1 / r0;
    } catch {
      return 0;
    }
  }
}

export default Pool;
