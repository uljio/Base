import { Router, Request, Response } from 'express';
import { Logger } from '../../utils/logger';

export interface BotConfig {
  dryRunMode: boolean;
  minProfitPercentage: number;
  maxGasPrice: string;
  checkIntervalMs: number;
  maxConcurrentTrades: number;
  dexes: string[];
  tokens: string[];
  enabled: boolean;
}

class ConfigController {
  private logger: Logger;
  private config: BotConfig;

  constructor() {
    this.logger = new Logger('ConfigController');
    this.config = {
      dryRunMode: true,
      minProfitPercentage: 0.5,
      maxGasPrice: '100000000000', // 100 gwei
      checkIntervalMs: 5000, // 5 seconds
      maxConcurrentTrades: 3,
      dexes: ['UniswapV2', 'SushiSwap'],
      tokens: [],
      enabled: false,
    };
  }

  /**
   * GET /api/config
   * Returns current bot configuration
   */
  async getConfig(req: Request, res: Response): Promise<void> {
    try {
      this.logger.info('Fetching bot configuration');

      const response = {
        success: true,
        data: this.config,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get config: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * POST /api/config
   * Updates bot configuration
   */
  async updateConfig(req: Request, res: Response): Promise<void> {
    try {
      this.logger.info('Updating bot configuration');

      const updates = req.body;

      // Validate incoming data
      if (typeof updates !== 'object' || updates === null) {
        res.status(400).json({
          success: false,
          error: 'Invalid configuration format',
        });
        return;
      }

      // Merge with existing config
      const updatedConfig = { ...this.config, ...updates };

      // Validate specific fields
      if (updatedConfig.minProfitPercentage < 0) {
        res.status(400).json({
          success: false,
          error: 'minProfitPercentage must be non-negative',
        });
        return;
      }

      if (updatedConfig.checkIntervalMs < 1000) {
        res.status(400).json({
          success: false,
          error: 'checkIntervalMs must be at least 1000ms',
        });
        return;
      }

      if (updatedConfig.maxConcurrentTrades < 1) {
        res.status(400).json({
          success: false,
          error: 'maxConcurrentTrades must be at least 1',
        });
        return;
      }

      this.config = updatedConfig;

      this.logger.info('Configuration updated successfully');

      const response = {
        success: true,
        message: 'Configuration updated successfully',
        data: this.config,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update config: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Get current configuration
   */
  getConfiguration(): BotConfig {
    return this.config;
  }

  /**
   * Update configuration programmatically
   */
  updateConfiguration(updates: Partial<BotConfig>): void {
    this.config = { ...this.config, ...updates };
    this.logger.info('Configuration updated programmatically');
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = {
      dryRunMode: true,
      minProfitPercentage: 0.5,
      maxGasPrice: '100000000000',
      checkIntervalMs: 5000,
      maxConcurrentTrades: 3,
      dexes: ['UniswapV2', 'SushiSwap'],
      tokens: [],
      enabled: false,
    };
    this.logger.info('Configuration reset to defaults');
  }
}

// Create a singleton instance
const configController = new ConfigController();

const router = Router();

/**
 * GET /api/config
 */
router.get('/', (req: Request, res: Response) => {
  configController.getConfig(req, res);
});

/**
 * POST /api/config
 */
router.post('/', (req: Request, res: Response) => {
  configController.updateConfig(req, res);
});

export default router;
export { configController };
