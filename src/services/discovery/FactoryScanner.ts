/**
 * Factory Scanner - Direct blockchain pool discovery
 * Scans DEX factory contracts to discover all liquidity pools
 * Eliminates dependency on external APIs like GeckoTerminal
 */

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { MultiProviderManager } from '../rpc/MultiProviderManager';
import { ALL_DEXES } from '../../config/dexes';
import { DexType, DexConfig, PoolInfo, TokenInfo } from '../../types/dex.types';
import { getConfig } from '../../config/environment';
import { TokenInfo as BlockchainTokenInfo } from '../blockchain/TokenInfo';
import { ReserveFetcher } from '../blockchain/ReserveFetcher';

const UNISWAP_V2_FACTORY_ABI = [
  'function allPairsLength() external view returns (uint)',
  'function allPairs(uint) external view returns (address)',
  'function getPair(address tokenA, address tokenB) external view returns (address)',
];

const UNISWAP_V3_FACTORY_ABI = [
  'function poolLength() external view returns (uint)',
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
];

export interface CachedPool {
  address: string;
  dex: string;
  dexType: DexType;
  token0: string;
  token1: string;
  fee: number;
  discoveredAt: number;
}

export class FactoryScanner {
  private providerManager: MultiProviderManager;
  private config = getConfig();
  private tokenInfoService: BlockchainTokenInfo;
  private reserveFetcher: ReserveFetcher;

  constructor(providerManager: MultiProviderManager) {
    this.providerManager = providerManager;
    const provider = providerManager.getNextProvider();
    this.tokenInfoService = new BlockchainTokenInfo(provider);
    this.reserveFetcher = new ReserveFetcher(provider);
    logger.info('FactoryScanner initialized for direct blockchain pool discovery');
  }

  /**
   * Scan all DEX factories for pools
   */
  async scanAllFactories(): Promise<PoolInfo[]> {
    logger.info(`Scanning ${ALL_DEXES.length} DEX factories for pools...`);

    const allPools: PoolInfo[] = [];

    for (const dex of ALL_DEXES) {
      try {
        logger.info(`Scanning ${dex.name} factory at ${dex.factoryAddress}`);

        const pools = dex.type === DexType.UNISWAP_V3
          ? await this.scanV3Factory(dex)
          : await this.scanV2Factory(dex);

        logger.info(`Found ${pools.length} pools on ${dex.name}`);
        allPools.push(...pools);

        // Small delay between factories to avoid overwhelming RPCs
        await this.sleep(2000);
      } catch (error) {
        logger.error(`Failed to scan ${dex.name} factory:`, error);
      }
    }

    logger.info(`Total pools discovered: ${allPools.length}`);
    return allPools;
  }

  /**
   * Scan Uniswap V2-style factory
   */
  private async scanV2Factory(dex: DexConfig): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    try {
      const result = await this.providerManager.executeWithRetry(async (provider) => {
        const factory = new ethers.Contract(
          dex.factoryAddress,
          UNISWAP_V2_FACTORY_ABI,
          provider as ethers.Provider
        );

        // Get total number of pairs
        const pairCount = await factory.allPairsLength();
        logger.info(`${dex.name} has ${pairCount} total pairs`);

        const poolAddresses: string[] = [];

        // Fetch pool addresses in batches
        const BATCH_SIZE = 50;
        for (let i = 0; i < Number(pairCount); i += BATCH_SIZE) {
          const batchPromises: Promise<string>[] = [];

          for (let j = 0; j < BATCH_SIZE && i + j < Number(pairCount); j++) {
            batchPromises.push(factory.allPairs(i + j));
          }

          const batchResults = await Promise.all(batchPromises);
          poolAddresses.push(...batchResults);

          logger.debug(`Fetched ${poolAddresses.length}/${pairCount} pool addresses from ${dex.name}`);

          // Small delay between batches
          if (i + BATCH_SIZE < Number(pairCount)) {
            await this.sleep(500);
          }
        }

        return poolAddresses;
      });

      // Now fetch reserves and token info for each pool
      logger.info(`Fetching reserves for ${result.length} pools...`);

      const RESERVE_BATCH_SIZE = 10;
      for (let i = 0; i < result.length; i += RESERVE_BATCH_SIZE) {
        const batch = result.slice(i, i + RESERVE_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(address => this.fetchPoolInfo(address, dex))
        );

        pools.push(...batchResults.filter(p => p !== null) as PoolInfo[]);

        logger.info(`Processed ${Math.min(i + RESERVE_BATCH_SIZE, result.length)}/${result.length} pools`);

        // Delay between batches to avoid rate limits
        if (i + RESERVE_BATCH_SIZE < result.length) {
          await this.sleep(1000);
        }
      }
    } catch (error) {
      logger.error(`Error scanning V2 factory ${dex.name}:`, error);
    }

    return pools;
  }

  /**
   * Scan Uniswap V3-style factory using event logs
   */
  private async scanV3Factory(dex: DexConfig): Promise<PoolInfo[]> {
    const pools: PoolInfo[] = [];

    try {
      const result = await this.providerManager.executeWithRetry(async (provider) => {
        const factory = new ethers.Contract(
          dex.factoryAddress,
          UNISWAP_V3_FACTORY_ABI,
          provider as ethers.Provider
        );

        // V3 pools are discovered via PoolCreated events
        // Query events in chunks to avoid RPC limits
        const currentBlock = await (provider as ethers.Provider).getBlockNumber();
        const BLOCK_CHUNK = 10000; // Process 10k blocks at a time
        const fromBlock = currentBlock - 1000000; // Last ~1M blocks (~30 days on Base)

        logger.info(`Scanning V3 PoolCreated events from block ${fromBlock} to ${currentBlock}`);

        const allEvents: ethers.EventLog[] = [];

        for (let start = fromBlock; start < currentBlock; start += BLOCK_CHUNK) {
          const end = Math.min(start + BLOCK_CHUNK - 1, currentBlock);

          try {
            const events = await factory.queryFilter(
              factory.filters.PoolCreated(),
              start,
              end
            );

            allEvents.push(...(events as ethers.EventLog[]));
            logger.debug(`Found ${events.length} pools in blocks ${start}-${end}`);

            // Delay between chunks
            await this.sleep(1000);
          } catch (error) {
            logger.warn(`Failed to query blocks ${start}-${end}:`, error);
          }
        }

        return allEvents;
      });

      logger.info(`Found ${result.length} V3 PoolCreated events for ${dex.name}`);

      // Extract pool addresses and fetch info
      const RESERVE_BATCH_SIZE = 10;
      for (let i = 0; i < result.length; i += RESERVE_BATCH_SIZE) {
        const batch = result.slice(i, i + RESERVE_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(event => {
            const poolAddress = event.args?.pool;
            const fee = event.args?.fee || dex.defaultFee;
            return this.fetchPoolInfo(poolAddress, { ...dex, defaultFee: Number(fee) });
          })
        );

        pools.push(...batchResults.filter(p => p !== null) as PoolInfo[]);

        logger.info(`Processed ${Math.min(i + RESERVE_BATCH_SIZE, result.length)}/${result.length} V3 pools`);

        if (i + RESERVE_BATCH_SIZE < result.length) {
          await this.sleep(1000);
        }
      }
    } catch (error) {
      logger.error(`Error scanning V3 factory ${dex.name}:`, error);
    }

    return pools;
  }

  /**
   * Fetch pool information including reserves and tokens
   */
  private async fetchPoolInfo(poolAddress: string, dex: DexConfig): Promise<PoolInfo | null> {
    try {
      // Use rotating provider for reserve fetching
      const provider = this.providerManager.getNextProvider();
      const reserveFetcher = new ReserveFetcher(provider);

      const reserves = await reserveFetcher.fetchReserves(poolAddress);
      if (!reserves) {
        logger.debug(`No reserves for pool ${poolAddress}`);
        return null;
      }

      // Filter by minimum liquidity (rough estimate)
      const reserve0Num = Number(reserves.reserve0);
      const reserve1Num = Number(reserves.reserve1);

      if (reserve0Num < 1000 || reserve1Num < 1000) {
        // Skip pools with tiny reserves
        return null;
      }

      // Fetch token information
      const tokenInfoService = new BlockchainTokenInfo(provider);
      const [token0Info, token1Info] = await Promise.all([
        tokenInfoService.getMetadata(reserves.token0),
        tokenInfoService.getMetadata(reserves.token1),
      ]);

      if (!token0Info || !token1Info) {
        logger.debug(`Failed to fetch token info for pool ${poolAddress}`);
        return null;
      }

      // Estimate liquidity in USD (rough calculation)
      const liquidityUSD = this.estimateLiquidityUSD(
        reserve0Num,
        reserve1Num,
        token0Info,
        token1Info
      );

      // Filter by minimum liquidity
      if (liquidityUSD < this.config.MIN_LIQUIDITY_USD) {
        return null;
      }

      const token0: TokenInfo = {
        address: reserves.token0,
        symbol: token0Info.symbol,
        name: token0Info.name,
        decimals: token0Info.decimals,
      };

      const token1: TokenInfo = {
        address: reserves.token1,
        symbol: token1Info.symbol,
        name: token1Info.name,
        decimals: token1Info.decimals,
      };

      return {
        address: poolAddress,
        dex: dex.name,
        dexType: dex.type,
        token0,
        token1,
        fee: dex.defaultFee,
        liquidityUSD,
        volume24hUSD: 0, // We don't have volume data from on-chain
        lastUpdate: Date.now(),
      };
    } catch (error) {
      logger.debug(`Error fetching pool info for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Estimate liquidity in USD (very rough approximation)
   */
  private estimateLiquidityUSD(
    reserve0: number,
    reserve1: number,
    token0: any,
    token1: any
  ): number {
    // If one token is a known stablecoin, use it as USD reference
    const stablecoins = [
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
      '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC on Base
    ];

    const token0IsStable = stablecoins.includes(token0.address?.toLowerCase());
    const token1IsStable = stablecoins.includes(token1.address?.toLowerCase());

    if (token0IsStable) {
      // reserve0 is in USD (with decimals)
      return (reserve0 / Math.pow(10, token0.decimals)) * 2;
    }

    if (token1IsStable) {
      // reserve1 is in USD (with decimals)
      return (reserve1 / Math.pow(10, token1.decimals)) * 2;
    }

    // If neither is stablecoin, use geometric mean as rough estimate
    const r0 = reserve0 / Math.pow(10, token0.decimals);
    const r1 = reserve1 / Math.pow(10, token1.decimals);
    return Math.sqrt(r0 * r1) * 100; // Very rough estimate
  }

  /**
   * Quick scan - only get pool addresses without reserves (fast)
   */
  async quickScanFactories(): Promise<CachedPool[]> {
    logger.info('Quick scanning factories for pool addresses only...');

    const allPools: CachedPool[] = [];

    for (const dex of ALL_DEXES) {
      try {
        if (dex.type === DexType.UNISWAP_V2) {
          const pools = await this.quickScanV2Factory(dex);
          allPools.push(...pools);
        }
      } catch (error) {
        logger.error(`Failed to quick scan ${dex.name}:`, error);
      }
    }

    logger.info(`Quick scan complete: ${allPools.length} pool addresses discovered`);
    return allPools;
  }

  /**
   * Quick scan V2 factory - just get addresses
   */
  private async quickScanV2Factory(dex: DexConfig): Promise<CachedPool[]> {
    const pools: CachedPool[] = [];

    try {
      const poolAddresses = await this.providerManager.executeWithRetry(async (provider) => {
        const factory = new ethers.Contract(
          dex.factoryAddress,
          UNISWAP_V2_FACTORY_ABI,
          provider as ethers.Provider
        );

        const pairCount = await factory.allPairsLength();
        const addresses: string[] = [];

        const BATCH_SIZE = 100;
        for (let i = 0; i < Number(pairCount); i += BATCH_SIZE) {
          const batchPromises: Promise<string>[] = [];

          for (let j = 0; j < BATCH_SIZE && i + j < Number(pairCount); j++) {
            batchPromises.push(factory.allPairs(i + j));
          }

          const batchResults = await Promise.all(batchPromises);
          addresses.push(...batchResults);

          await this.sleep(500);
        }

        return addresses;
      });

      for (const address of poolAddresses) {
        pools.push({
          address,
          dex: dex.name,
          dexType: dex.type,
          token0: '', // Will be fetched later
          token1: '',
          fee: dex.defaultFee,
          discoveredAt: Date.now(),
        });
      }
    } catch (error) {
      logger.error(`Error in quick scan for ${dex.name}:`, error);
    }

    return pools;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default FactoryScanner;
