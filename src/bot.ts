import { ethers } from 'ethers';
import { APIServer, ServerConfig } from './api/server';
import { FlashLoanExecutor, FlashLoanParams } from './services/arbitrage/FlashLoanExecutor';
import { statusController } from './api/routes/status';
import { opportunitiesController } from './api/routes/opportunities';
import { configController } from './api/routes/config';
import { Logger } from './utils/logger';

export interface BotOptions {
  rpcUrl: string;
  privateKey: string;
  contractAddress: string;
  contractAbi: any;
  apiPort?: number;
  apiHost?: string;
  dryRunMode?: boolean;
}

export class ArbitrageBot {
  private logger: Logger;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private executor: FlashLoanExecutor;
  private apiServer: APIServer;
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private options: BotOptions;

  constructor(options: BotOptions) {
    this.logger = new Logger('ArbitrageBot');
    this.options = options;

    // Initialize provider
    this.provider = new ethers.JsonRpcProvider(options.rpcUrl);

    // Initialize wallet
    this.wallet = new ethers.Wallet(options.privateKey, this.provider);

    // Initialize contract
    this.contract = new ethers.Contract(
      options.contractAddress,
      options.contractAbi,
      this.wallet
    );

    // Initialize flash loan executor
    this.executor = new FlashLoanExecutor(
      this.contract,
      this.wallet,
      options.dryRunMode ?? false
    );

    // Initialize API server
    const serverConfig: ServerConfig = {
      port: options.apiPort ?? 3000,
      host: options.apiHost ?? '0.0.0.0',
    };
    this.apiServer = new APIServer(serverConfig);

    this.logger.info('ArbitrageBot initialized');
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      if (this.isRunning) {
        this.logger.warn('Bot is already running');
        return;
      }

      this.logger.info('Starting ArbitrageBot...');
      this.startTime = Date.now();
      this.isRunning = true;

      // Update status
      statusController.setRunning(true);
      statusController.setUptime(0);

      // Start API server
      await this.apiServer.start();

      // Start opportunity checker
      this.startOpportunityChecker();

      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();

      this.logger.info('ArbitrageBot started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start bot: ${errorMessage}`);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    try {
      this.logger.info('Stopping ArbitrageBot...');

      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }

      this.isRunning = false;
      statusController.setRunning(false);

      await this.apiServer.stop();

      this.logger.info('ArbitrageBot stopped');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error stopping bot: ${errorMessage}`);
    }
  }

  /**
   * Start checking for arbitrage opportunities
   */
  private startOpportunityChecker(): void {
    const config = configController.getConfiguration();

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      await this.checkOpportunities();
    }, config.checkIntervalMs);

    this.logger.info(`Opportunity checker started (interval: ${config.checkIntervalMs}ms)`);
  }

  /**
   * Check for arbitrage opportunities
   */
  private async checkOpportunities(): Promise<void> {
    try {
      const config = configController.getConfiguration();

      if (!config.enabled) {
        return;
      }

      // Update uptime
      const uptime = Date.now() - this.startTime;
      statusController.setUptime(uptime);

      // TODO: Implement actual opportunity detection logic
      // This would involve:
      // 1. Fetching prices from multiple DEXes
      // 2. Calculating profit margins
      // 3. Finding profitable arbitrage opportunities
      // 4. Storing them in opportunitiesController

      this.logger.debug('Opportunity check cycle completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error during opportunity check: ${errorMessage}`);
      statusController.incrementFailedTrades(errorMessage);
    }
  }

  /**
   * Execute an arbitrage opportunity
   */
  async executeArbitrage(params: FlashLoanParams): Promise<void> {
    try {
      const config = configController.getConfiguration();

      if (!config.enabled) {
        this.logger.warn('Bot is not enabled, skipping execution');
        return;
      }

      this.logger.info(`Executing arbitrage with params: ${JSON.stringify(params)}`);

      const result = await this.executor.executeFlashLoan(params);

      if (result.success) {
        statusController.incrementSuccessfulTrades(result.profit);
        this.logger.info(`Arbitrage executed successfully: ${result.txHash}`);
      } else {
        statusController.incrementFailedTrades(result.error);
        this.logger.error(`Arbitrage execution failed: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error executing arbitrage: ${errorMessage}`);
      statusController.incrementFailedTrades(errorMessage);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error(`Uncaught exception: ${error.message}`);
      this.stop().then(() => process.exit(1));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      this.logger.error(`Unhandled rejection: ${reason}`);
      this.stop().then(() => process.exit(1));
    });
  }

  /**
   * Get bot status
   */
  isStarted(): boolean {
    return this.isRunning;
  }

  /**
   * Get flash loan executor
   */
  getExecutor(): FlashLoanExecutor {
    return this.executor;
  }

  /**
   * Get API server
   */
  getApiServer(): APIServer {
    return this.apiServer;
  }

  /**
   * Get contract instance
   */
  getContract(): ethers.Contract {
    return this.contract;
  }

  /**
   * Get wallet instance
   */
  getWallet(): ethers.Wallet {
    return this.wallet;
  }

  /**
   * Get provider instance
   */
  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }
}
