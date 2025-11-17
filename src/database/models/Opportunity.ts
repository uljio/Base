'use strict';

import { randomUUID } from 'crypto';
import sqlite from '../sqlite';
import { logger } from '../../services/utils/Logger';

/**
 * Opportunity Model with CRUD operations
 * Manages arbitrage opportunities in the database
 */
export interface OpportunityData {
  id?: string;
  chain_id: number;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out_predicted: string;
  profit_usd: number;
  profit_percentage: number;
  route: string; // JSON stringified route
  status?: 'pending' | 'executing' | 'executed' | 'failed' | 'expired';
  created_at?: number;
  expires_at: number;
  executed_at?: number | null;
  updated_at?: number;
}

export class Opportunity {
private static readonly TABLE = 'opportunities';

  /**
   * Create a new opportunity record
   */
  public static async create(data: Omit<OpportunityData, 'id' | 'created_at' | 'updated_at'>): Promise<OpportunityData> {
    try {
      const id = randomUUID();
      const now = Date.now();
      const status = data.status || 'pending';

      const stmt = sqlite.prepare(`
        INSERT INTO ${this.TABLE} (
          id, chain_id, token_in, token_out, amount_in, amount_out_predicted,
          profit_usd, profit_percentage, route, status, created_at, expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        data.chain_id,
        data.token_in,
        data.token_out,
        data.amount_in,
        data.amount_out_predicted,
        data.profit_usd,
        data.profit_percentage,
        data.route,
        status,
        now,
        data.expires_at,
        now
      );

      logger.info(`Created opportunity ${id} with profit ${data.profit_usd} USD`);

      return {
        id,
        ...data,
        status: status as any,
        created_at: now,
        updated_at: now,
        executed_at: null,
      };
    } catch (error) {
      logger.error(`Failed to create opportunity: ${error}`);
      throw new Error(`Opportunity creation failed: ${error}`);
    }
  }

  /**
   * Find opportunity by ID
   */
  public static async findById(id: string): Promise<OpportunityData | null> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE} WHERE id = ?
      `);

      const row = stmt.get(id) as OpportunityData | undefined;
      return row || null;
    } catch (error) {
      logger.error(`Failed to find opportunity ${id}: ${error}`);
      throw new Error(`Opportunity lookup failed: ${error}`);
    }
  }

  /**
   * Find all pending opportunities
   */
  public static async findPending(limit: number = 100): Promise<OpportunityData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE status = 'pending' AND expires_at > ?
        ORDER BY profit_usd DESC
        LIMIT ?
      `);

      const rows = stmt.all(Date.now(), limit) as OpportunityData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find pending opportunities: ${error}`);
      throw new Error(`Pending opportunities lookup failed: ${error}`);
    }
  }

  /**
   * Find opportunities by chain ID and status
   */
  public static async findByChainAndStatus(
    chainId: number,
    status: string,
    limit: number = 100
  ): Promise<OpportunityData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE chain_id = ? AND status = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(chainId, status, limit) as OpportunityData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find opportunities by chain/status: ${error}`);
      throw new Error(`Chain/status lookup failed: ${error}`);
    }
  }

  /**
   * Update opportunity status
   */
  public static async updateStatus(
    id: string,
    status: string,
    executedAt?: number
  ): Promise<OpportunityData> {
    try {
      const now = Date.now();
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET status = ?, updated_at = ?, executed_at = COALESCE(?, executed_at)
        WHERE id = ?
      `);

      stmt.run(status, now, executedAt || null, id);

      const updated = await this.findById(id);
      if (!updated) {
        throw new Error(`Opportunity ${id} not found after update`);
      }

      logger.info(`Updated opportunity ${id} status to ${status}`);
      return updated;
    } catch (error) {
      logger.error(`Failed to update opportunity status: ${error}`);
      throw new Error(`Status update failed: ${error}`);
    }
  }

  /**
   * Update profit information
   */
  public static async updateProfit(
    id: string,
    profitUsd: number,
    profitPercentage: number
  ): Promise<void> {
    try {
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET profit_usd = ?, profit_percentage = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(profitUsd, profitPercentage, Date.now(), id);
      logger.info(`Updated opportunity ${id} profit to ${profitUsd} USD`);
    } catch (error) {
      logger.error(`Failed to update profit: ${error}`);
      throw new Error(`Profit update failed: ${error}`);
    }
  }

  /**
   * Delete opportunity by ID
   */
  public static async delete(id: string): Promise<boolean> {
    try {
      const stmt = sqlite.prepare(`DELETE FROM ${this.TABLE} WHERE id = ?`);
      const result = stmt.run(id);
      const deleted = (result.changes || 0) > 0;

      if (deleted) {
        logger.info(`Deleted opportunity ${id}`);
      }

      return deleted;
    } catch (error) {
      logger.error(`Failed to delete opportunity: ${error}`);
      throw new Error(`Opportunity deletion failed: ${error}`);
    }
  }

  /**
   * Get opportunities statistics
   */
  public static async getStats(): Promise<{
    total: number;
    pending: number;
    executed: number;
    failed: number;
    avgProfit: number;
  }> {
    try {
      const stmt = sqlite.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'executed' THEN 1 ELSE 0 END) as executed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          AVG(profit_usd) as avg_profit
        FROM ${this.TABLE}
      `);

      const row = stmt.get() as any;

      return {
        total: row.total || 0,
        pending: row.pending || 0,
        executed: row.executed || 0,
        failed: row.failed || 0,
        avgProfit: row.avg_profit || 0,
      };
    } catch (error) {
      logger.error(`Failed to get statistics: ${error}`);
      throw new Error(`Statistics retrieval failed: ${error}`);
    }
  }

  /**
   * Clean up expired opportunities
   */
  public static async cleanupExpired(): Promise<number> {
    try {
      const stmt = sqlite.prepare(`
        DELETE FROM ${this.TABLE}
        WHERE expires_at < ? AND status != 'executed'
      `);

      const result = stmt.run(Date.now());
      const deleted = result.changes || 0;

      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} expired opportunities`);
      }

      return deleted;
    } catch (error) {
      logger.error(`Failed to cleanup expired opportunities: ${error}`);
      throw new Error(`Cleanup failed: ${error}`);
    }
  }
}

export default Opportunity;
