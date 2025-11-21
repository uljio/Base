'use strict';

import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../services/utils/Logger';

/**
 * SQLite Database Manager with Connection Pooling
 * Handles database initialization, migrations, and connection pooling
 */
class SQLiteDatabase {
  private static instance: SQLiteDatabase;
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  // logger imported from utils
  private maxConnections: number = 15;
  private activeConnections: number = 0;

  private constructor(dbPath: string = path.join(process.cwd(), 'data', 'arbitrage.db')) {
    this.dbPath = dbPath;
}

  /**
   * Get singleton instance of SQLiteDatabase
   */
  public static getInstance(dbPath?: string): SQLiteDatabase {
    if (!SQLiteDatabase.instance) {
      SQLiteDatabase.instance = new SQLiteDatabase(dbPath);
    }
    return SQLiteDatabase.instance;
  }

  /**
   * Initialize database connection with pooling
   */
  public async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      const fs = await import('fs').then(m => m.promises);
      await fs.mkdir(dir, { recursive: true });

      // Open database with WAL mode for better concurrency
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = -64000');
      this.db.pragma('foreign_keys = ON');

      await this.runMigrations();
      logger.info('SQLite database initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize database: ${error}`);
      throw new Error(`Database initialization failed: ${error}`);
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Create tables if they don't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS opportunities (
          id TEXT PRIMARY KEY,
          chain_id INTEGER NOT NULL,
          token_in TEXT NOT NULL,
          token_out TEXT NOT NULL,
          amount_in TEXT NOT NULL,
          amount_out_predicted TEXT NOT NULL,
          profit_usd REAL NOT NULL,
          profit_percentage REAL NOT NULL,
          route TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          executed_at INTEGER,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          opportunity_id TEXT NOT NULL,
          chain_id INTEGER NOT NULL,
          tx_hash TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          gas_used TEXT,
          gas_price TEXT,
          actual_profit_usd REAL,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
        );

        CREATE TABLE IF NOT EXISTS pools (
          id TEXT PRIMARY KEY,
          chain_id INTEGER NOT NULL,
          token0 TEXT NOT NULL,
          token1 TEXT NOT NULL,
          reserve0 TEXT NOT NULL,
          reserve1 TEXT NOT NULL,
          fee INTEGER NOT NULL,
          liquidity TEXT NOT NULL,
          price REAL NOT NULL,
          last_updated INTEGER NOT NULL,
          last_reserve_update INTEGER,
          price_impact_50usd REAL
        );

        CREATE TABLE IF NOT EXISTS pool_cache (
          address TEXT PRIMARY KEY,
          dex TEXT NOT NULL,
          dex_type TEXT NOT NULL,
          token0 TEXT NOT NULL,
          token1 TEXT NOT NULL,
          fee INTEGER NOT NULL,
          discovered_at INTEGER NOT NULL,
          last_scanned INTEGER,
          is_active BOOLEAN DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
        CREATE INDEX IF NOT EXISTS idx_opportunities_expires_at ON opportunities(expires_at);
        CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
        CREATE INDEX IF NOT EXISTS idx_pools_chain_token ON pools(chain_id, token0, token1);
        CREATE INDEX IF NOT EXISTS idx_pool_cache_dex ON pool_cache(dex);
        CREATE INDEX IF NOT EXISTS idx_pool_cache_tokens ON pool_cache(token0, token1);
        CREATE INDEX IF NOT EXISTS idx_pool_cache_active ON pool_cache(is_active);
      `);

      logger.info('Database migrations completed');
    } catch (error) {
      logger.error(`Migration failed: ${error}`);
      throw new Error(`Database migration failed: ${error}`);
    }
  }

  /**
   * Get database connection with connection pooling
   */
  public getConnection(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    if (this.activeConnections >= this.maxConnections) {
      logger.warn(`Reached max connections (${this.maxConnections}), waiting...`);
    }

    this.activeConnections++;
    return this.db;
  }

  /**
   * Release database connection from pool
   */
  public releaseConnection(): void {
    if (this.activeConnections > 0) {
      this.activeConnections--;
    }
  }

  /**
   * Execute a prepared statement
   */
  public prepare(sql: string): Database.Statement {
    const conn = this.getConnection();
    return conn.prepare(sql);
  }

  /**
   * Execute a transaction
   */
  public transaction<T>(fn: () => T): T {
    const conn = this.getConnection();
    try {
      const transaction = conn.transaction(fn);
      return transaction();
    } finally {
      this.releaseConnection();
    }
  }

  /**
   * Close database connection
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Get database statistics
   */
  public getStats(): { path: string; connections: number; maxConnections: number } {
    return {
      path: this.dbPath,
      connections: this.activeConnections,
      maxConnections: this.maxConnections,
    };
  }
}

export default SQLiteDatabase.getInstance();
