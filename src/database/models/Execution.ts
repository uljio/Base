'use strict';

import { v4 as uuidv4 } from 'uuid';
import sqlite from '../sqlite';
import { logger } from '../../services/utils/Logger';

/**
 * Execution Model with CRUD operations
 * Manages transaction executions for arbitrage opportunities
 */
export interface ExecutionData {
  id?: string;
  opportunity_id: string;
  chain_id: number;
  tx_hash?: string | null;
  status?: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'reverted';
  gas_used?: string | null;
  gas_price?: string | null;
  actual_profit_usd?: number | null;
  error_message?: string | null;
  created_at?: number;
  updated_at?: number;
}

export class Execution {
private static readonly TABLE = 'executions';

  /**
   * Create a new execution record
   */
  public static async create(data: Omit<ExecutionData, 'id' | 'created_at' | 'updated_at'>): Promise<ExecutionData> {
    try {
      const id = uuidv4();
      const now = Date.now();
      const status = data.status || 'pending';

      const stmt = sqlite.prepare(`
        INSERT INTO ${this.TABLE} (
          id, opportunity_id, chain_id, tx_hash, status,
          gas_used, gas_price, actual_profit_usd, error_message,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        data.opportunity_id,
        data.chain_id,
        data.tx_hash || null,
        status,
        data.gas_used || null,
        data.gas_price || null,
        data.actual_profit_usd || null,
        data.error_message || null,
        now,
        now
      );

      logger.info(`Created execution ${id} for opportunity ${data.opportunity_id}`);

      return {
        id,
        ...data,
        status: status as any,
        created_at: now,
        updated_at: now,
        tx_hash: data.tx_hash || null,
        gas_used: data.gas_used || null,
        gas_price: data.gas_price || null,
        actual_profit_usd: data.actual_profit_usd || null,
        error_message: data.error_message || null,
      };
    } catch (error) {
      logger.error(`Failed to create execution: ${error}`);
      throw new Error(`Execution creation failed: ${error}`);
    }
  }

  /**
   * Find execution by ID
   */
  public static async findById(id: string): Promise<ExecutionData | null> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE} WHERE id = ?
      `);

      const row = stmt.get(id) as ExecutionData | undefined;
      return row || null;
    } catch (error) {
      logger.error(`Failed to find execution ${id}: ${error}`);
      throw new Error(`Execution lookup failed: ${error}`);
    }
  }

  /**
   * Find executions by opportunity ID
   */
  public static async findByOpportunityId(opportunityId: string): Promise<ExecutionData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE opportunity_id = ?
        ORDER BY created_at DESC
      `);

      const rows = stmt.all(opportunityId) as ExecutionData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find executions by opportunity: ${error}`);
      throw new Error(`Opportunity executions lookup failed: ${error}`);
    }
  }

  /**
   * Find execution by transaction hash
   */
  public static async findByTxHash(txHash: string): Promise<ExecutionData | null> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE} WHERE tx_hash = ?
      `);

      const row = stmt.get(txHash) as ExecutionData | undefined;
      return row || null;
    } catch (error) {
      logger.error(`Failed to find execution by tx hash: ${error}`);
      throw new Error(`TX hash lookup failed: ${error}`);
    }
  }

  /**
   * Find pending executions
   */
  public static async findPending(limit: number = 100): Promise<ExecutionData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE status IN ('pending', 'submitted')
        ORDER BY created_at ASC
        LIMIT ?
      `);

      const rows = stmt.all(limit) as ExecutionData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find pending executions: ${error}`);
      throw new Error(`Pending executions lookup failed: ${error}`);
    }
  }

  /**
   * Find executions by chain ID and status
   */
  public static async findByChainAndStatus(
    chainId: number,
    status: string,
    limit: number = 100
  ): Promise<ExecutionData[]> {
    try {
      const stmt = sqlite.prepare(`
        SELECT * FROM ${this.TABLE}
        WHERE chain_id = ? AND status = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);

      const rows = stmt.all(chainId, status, limit) as ExecutionData[];
      return rows;
    } catch (error) {
      logger.error(`Failed to find executions by chain/status: ${error}`);
      throw new Error(`Chain/status lookup failed: ${error}`);
    }
  }

  /**
   * Update execution status
   */
  public static async updateStatus(
    id: string,
    status: string,
    txHash?: string
  ): Promise<ExecutionData> {
    try {
      const now = Date.now();
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET status = ?, updated_at = ?, tx_hash = COALESCE(?, tx_hash)
        WHERE id = ?
      `);

      stmt.run(status, now, txHash || null, id);

      const updated = await this.findById(id);
      if (!updated) {
        throw new Error(`Execution ${id} not found after update`);
      }

      logger.info(`Updated execution ${id} status to ${status}`);
      return updated;
    } catch (error) {
      logger.error(`Failed to update execution status: ${error}`);
      throw new Error(`Status update failed: ${error}`);
    }
  }

  /**
   * Update gas and profit information
   */
  public static async updateGasAndProfit(
    id: string,
    gasUsed: string,
    gasPrice: string,
    actualProfitUsd: number
  ): Promise<void> {
    try {
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET gas_used = ?, gas_price = ?, actual_profit_usd = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(gasUsed, gasPrice, actualProfitUsd, Date.now(), id);
      logger.info(`Updated execution ${id} gas and profit info`);
    } catch (error) {
      logger.error(`Failed to update gas and profit: ${error}`);
      throw new Error(`Gas/profit update failed: ${error}`);
    }
  }

  /**
   * Update error message
   */
  public static async updateError(id: string, errorMessage: string): Promise<void> {
    try {
      const stmt = sqlite.prepare(`
        UPDATE ${this.TABLE}
        SET error_message = ?, status = 'failed', updated_at = ?
        WHERE id = ?
      `);

      stmt.run(errorMessage, Date.now(), id);
      logger.warn(`Marked execution ${id} as failed: ${errorMessage}`);
    } catch (error) {
      logger.error(`Failed to update error message: ${error}`);
      throw new Error(`Error update failed: ${error}`);
    }
  }

  /**
   * Delete execution by ID
   */
  public static async delete(id: string): Promise<boolean> {
    try {
      const stmt = sqlite.prepare(`DELETE FROM ${this.TABLE} WHERE id = ?`);
      const result = stmt.run(id);
      const deleted = (result.changes || 0) > 0;

      if (deleted) {
        logger.info(`Deleted execution ${id}`);
      }

      return deleted;
    } catch (error) {
      logger.error(`Failed to delete execution: ${error}`);
      throw new Error(`Execution deletion failed: ${error}`);
    }
  }

  /**
   * Get execution statistics
   */
  public static async getStats(): Promise<{
    total: number;
    pending: number;
    confirmed: number;
    failed: number;
    totalProfit: number;
    avgProfit: number;
  }> {
    try {
      const stmt = sqlite.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(actual_profit_usd) as total_profit,
          AVG(actual_profit_usd) as avg_profit
        FROM ${this.TABLE}
      `);

      const row = stmt.get() as any;

      return {
        total: row.total || 0,
        pending: row.pending || 0,
        confirmed: row.confirmed || 0,
        failed: row.failed || 0,
        totalProfit: row.total_profit || 0,
        avgProfit: row.avg_profit || 0,
      };
    } catch (error) {
      logger.error(`Failed to get statistics: ${error}`);
      throw new Error(`Statistics retrieval failed: ${error}`);
    }
  }

  /**
   * Get profit breakdown by chain
   */
  public static async getProfitByChain(): Promise<Map<number, number>> {
    try {
      const stmt = sqlite.prepare(`
        SELECT chain_id, SUM(actual_profit_usd) as total_profit
        FROM ${this.TABLE}
        WHERE status = 'confirmed'
        GROUP BY chain_id
      `);

      const rows = stmt.all() as Array<{ chain_id: number; total_profit: number }>;
      const profitMap = new Map<number, number>();

      rows.forEach(row => {
        profitMap.set(row.chain_id, row.total_profit || 0);
      });

      return profitMap;
    } catch (error) {
      logger.error(`Failed to get profit by chain: ${error}`);
      throw new Error(`Profit by chain retrieval failed: ${error}`);
    }
  }
}

export default Execution;
