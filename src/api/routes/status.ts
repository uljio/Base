import { Router, Request, Response } from 'express';
import { logger } from '../../services/utils/Logger';

export interface BotStats {
  isRunning: boolean;
  uptime: number;
  opportunitiesFound: number;
  successfulTrades: number;
  failedTrades: number;
  totalProfit: string;
  averageProfit: string;
  lastTradeTime?: string;
  lastError?: string;
}

class StatusController {
  // logger imported from utils
  private stats: BotStats;

  constructor() {
this.stats = {
      isRunning: true,
      uptime: 0,
      opportunitiesFound: 0,
      successfulTrades: 0,
      failedTrades: 0,
      totalProfit: '0',
      averageProfit: '0',
    };
  }

  /**
   * GET /api/status
   * Returns current bot statistics and status
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Fetching bot status');

      const response = {
        success: true,
        data: {
          ...this.stats,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get status: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Update bot statistics
   */
  updateStats(updates: Partial<BotStats>): void {
    this.stats = { ...this.stats, ...updates };
  }

  /**
   * Get current stats
   */
  getStats(): BotStats {
    return this.stats;
  }

  /**
   * Increment opportunities found counter
   */
  incrementOpportunitiesFound(count: number = 1): void {
    this.stats.opportunitiesFound += count;
  }

  /**
   * Increment successful trades counter
   */
  incrementSuccessfulTrades(profit: string = '0'): void {
    this.stats.successfulTrades += 1;
    this.stats.lastTradeTime = new Date().toISOString();
    // Update total profit
    const current = BigInt(this.stats.totalProfit);
    const profitBig = BigInt(profit);
    this.stats.totalProfit = (current + profitBig).toString();
    // Update average profit
    if (this.stats.successfulTrades > 0) {
      const avg = BigInt(this.stats.totalProfit) / BigInt(this.stats.successfulTrades);
      this.stats.averageProfit = avg.toString();
    }
  }

  /**
   * Increment failed trades counter
   */
  incrementFailedTrades(error: string = ''): void {
    this.stats.failedTrades += 1;
    if (error) {
      this.stats.lastError = error;
    }
  }

  /**
   * Set uptime
   */
  setUptime(ms: number): void {
    this.stats.uptime = ms;
  }

  /**
   * Set running status
   */
  setRunning(running: boolean): void {
    this.stats.isRunning = running;
  }
}

// Create a singleton instance
const statusController = new StatusController();

const router = Router();

/**
 * GET /api/status
 */
router.get('/', (req: Request, res: Response) => {
  statusController.getStatus(req, res);
});

export default router;
export { statusController };
