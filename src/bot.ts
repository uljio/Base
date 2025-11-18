import { ethers } from 'ethers';
import { APIServer, ServerConfig } from './api/server';
import { FlashLoanExecutor, FlashLoanParams } from './services/arbitrage/FlashLoanExecutor';
import { statusController } from './api/routes/status';
import { opportunitiesController } from './api/routes/opportunities';
import { configController } from './api/routes/config';
import { logger } from './services/utils/Logger';
import sqlite from './database/sqlite';
import { GeckoTerminal } from './services/discovery/GeckoTerminal';
import { ReserveFetcher } from './services/blockchain/ReserveFetcher';
import { TokenInfo } from './services/blockchain/TokenInfo';
import { OpportunityDetector } from './services/arbitrage/OpportunityDetector';
import { Pool } from './database/models/Pool';
import { Opportunity } from './database/models/Opportunity';
import { getConfig } from './config/environment';
import { getCurrentChain } from './config/chains';
import { CurlRpcProvider } from './services/blockchain/CurlRpcProvider';

export interface BotOptions {
  rpcUrl: string;
  privateKey: string;
  contractAddress: string;
  contractAbi: any;
  apiPort?: number;
  apiHost?: string;
  dryRunMode?: boolean;
  useCurlRpc?: boolean; // Use curl-based RPC provider (default: true)
}

export class ArbitrageBot {
  // logger imported from utils
  private provider: ethers.JsonRpcProvider;
  private curlProvider: CurlRpcProvider | null = null;
  private wallet: ethers.Wallet;
  private contract: ethers.Contract;
  private executor: FlashLoanExecutor;
  private apiServer: APIServer;
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private startTime: number = 0;
  private options: BotOptions;
  private geckoTerminal: GeckoTerminal;
  private reserveFetcher: ReserveFetcher;
  private tokenInfo: TokenInfo;
  private opportunityDetector: OpportunityDetector;
  private lastPoolDiscovery: number = 0;
  private poolDiscoveryIntervalMs: number = 3600000; // 1 hour
  private config = getConfig();
  private chain = getCurrentChain();

  constructor(options: BotOptions) {
    this.options = options;

    // Initialize provider (still needed for wallet and contract operations)
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

    // Initialize discovery and monitoring services
    this.geckoTerminal = new GeckoTerminal();

    // Use curl-based RPC provider by default (works around ethers.js connectivity issues)
    const useCurlRpc = options.useCurlRpc !== false; // Default to true
    if (useCurlRpc) {
      logger.info('Using curl-based RPC provider for data fetching');
      this.curlProvider = new CurlRpcProvider(options.rpcUrl);
      this.reserveFetcher = new ReserveFetcher(this.curlProvider);
      this.tokenInfo = new TokenInfo(this.curlProvider);
    } else {
      logger.info('Using ethers.js RPC provider for data fetching');
      this.reserveFetcher = new ReserveFetcher(this.provider);
      this.tokenInfo = new TokenInfo(this.provider);
    }

    this.opportunityDetector = new OpportunityDetector(
      this.chain.chainId,
      this.config.MIN_PROFIT_USD || 1.0,
      0.1 // Min profit percentage
    );

    logger.info('ArbitrageBot initialized');
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    try {
      if (this.isRunning) {
        logger.warn('Bot is already running');
        return;
      }

      logger.info('Starting ArbitrageBot...');
      this.startTime = Date.now();
      this.isRunning = true;

      // Initialize database
      logger.info('Initializing database...');
      await sqlite.initialize();

      // Discover pools on startup if database is empty
      await this.discoverPoolsIfNeeded();

      // Update status
      statusController.setRunning(true);
      statusController.setUptime(0);

      // Start API server
      await this.apiServer.start();

      // Start opportunity checker
      this.startOpportunityChecker();

      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();

      logger.info('ArbitrageBot started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to start bot: ${errorMessage}`);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping ArbitrageBot...');

      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }

      this.isRunning = false;
      statusController.setRunning(false);

      await this.apiServer.stop();

      logger.info('ArbitrageBot stopped');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error stopping bot: ${errorMessage}`);
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

    logger.info(`Opportunity checker started (interval: ${config.checkIntervalMs}ms)`);
  }

  /**
   * Discover pools from GeckoTerminal if needed
   */
  private async discoverPoolsIfNeeded(): Promise<void> {
    try {
      // Check if we need to rediscover pools
      const now = Date.now();
      const shouldRediscover = now - this.lastPoolDiscovery > this.poolDiscoveryIntervalMs;

      // Check pool count in database
      const poolCount = await Pool.findByChain(this.chain.chainId, 1);

      if (poolCount.length === 0 || shouldRediscover) {
        logger.info('Discovering pools from GeckoTerminal...');
        await this.discoverAndSavePools();
        this.lastPoolDiscovery = now;
      } else {
        logger.info(`Found ${poolCount.length} existing pools in database, skipping discovery`);
      }
    } catch (error) {
      logger.error(`Pool discovery failed: ${error}`);
    }
  }

  /**
   * Discover pools from GeckoTerminal and save to database
   */
  private async discoverAndSavePools(): Promise<void> {
    try {
      // Discover pools (GeckoTerminal.discoverPools uses config.GECKO_PAGES_TO_FETCH internally)
      const pools = await this.geckoTerminal.discoverPools();

      logger.info(`Discovered ${pools.length} pools from GeckoTerminal`);

      // Fetch reserves and decimals
      const poolAddresses = pools.map(p => p.address);
      const reservesMap = await this.reserveFetcher.batchFetchReserves(poolAddresses);

      // Get unique tokens
      const tokens = new Set<string>();
      pools.forEach(pool => {
        const reserves = reservesMap.get(pool.address.toLowerCase());
        if (reserves) {
          tokens.add(reserves.token0);
          tokens.add(reserves.token1);
        }
      });

      // Fetch token decimals
      const decimalsMap = await this.tokenInfo.batchGetDecimals(Array.from(tokens));

      // Save pools to database
      let savedCount = 0;
      for (const pool of pools) {
        const reserves = reservesMap.get(pool.address.toLowerCase());
        if (reserves) {
          const token0Decimals = decimalsMap.get(reserves.token0) || 18;
          const token1Decimals = decimalsMap.get(reserves.token1) || 18;

          const price = parseFloat(reserves.reserve1) / parseFloat(reserves.reserve0);

          await Pool.upsert({
            chain_id: this.chain.chainId,
            token0: reserves.token0,
            token1: reserves.token1,
            reserve0: reserves.reserve0,
            reserve1: reserves.reserve1,
            fee: pool.fee,
            liquidity: pool.liquidityUSD.toString(),
            price: price,
          });
          savedCount++;
        }
      }

      logger.info(`Saved ${savedCount} pools with valid reserves to database`);
    } catch (error) {
      logger.error(`Failed to discover and save pools: ${error}`);
      throw error;
    }
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

      // Periodically rediscover pools
      await this.discoverPoolsIfNeeded();

      // Get all pools from database
      const pools = await Pool.findByChain(this.chain.chainId, 10000);

      if (pools.length === 0) {
        logger.debug('No pools in database, skipping opportunity check');
        return;
      }

      // Note: Pool reserves are refreshed during periodic pool discovery
      // For real-time trading, consider adding pool_address field to enable per-block reserve updates

      // Get unique tokens
      const tokens = new Set<string>();
      pools.forEach(pool => {
        tokens.add(pool.token0);
        tokens.add(pool.token1);
      });

      // Fetch token decimals
      const decimalsMap = await this.tokenInfo.batchGetDecimals(Array.from(tokens));

      // Scan for arbitrage opportunities
      const poolPrices = new Map<string, number>();
      pools.forEach(pool => {
        if (pool.id) {
          poolPrices.set(pool.id, pool.price);
        }
      });

      const opportunities = await this.opportunityDetector.scanOpportunities(
        Array.from(tokens),
        poolPrices,
        decimalsMap
      );

      // Save opportunities to database
      for (const opp of opportunities) {
        await Opportunity.create({
          token_in: opp.tokenIn,
          token_out: opp.tokenOut,
          amount_in: opp.amountIn,
          amount_out_predicted: opp.amountOutPredicted,
          profit_usd: opp.profitUsd,
          profit_percentage: opp.profitPercentage,
          route: JSON.stringify(opp.route),
          chain_id: this.chain.chainId,
          status: 'pending',
          expires_at: Date.now() + 60000, // Expire in 1 minute
        });
      }

      if (opportunities.length > 0) {
        logger.info(`Found ${opportunities.length} profitable opportunities`);
      }

      logger.debug('Opportunity check cycle completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error during opportunity check: ${errorMessage}`);
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
        logger.warn('Bot is not enabled, skipping execution');
        return;
      }

      logger.info(`Executing arbitrage with params: ${JSON.stringify(params)}`);

      const result = await this.executor.executeFlashLoan(params);

      if (result.success) {
        statusController.incrementSuccessfulTrades(result.profit);
        logger.info(`Arbitrage executed successfully: ${result.txHash}`);
      } else {
        statusController.incrementFailedTrades(result.error);
        logger.error(`Arbitrage execution failed: ${result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error executing arbitrage: ${errorMessage}`);
      statusController.incrementFailedTrades(errorMessage);
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught exception: ${error.message}`);
      this.stop().then(() => process.exit(1));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      logger.error(`Unhandled rejection: ${reason}`);
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
