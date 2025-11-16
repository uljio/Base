/**
 * Subscribe to DEX pool swap events
 */

import { Contract, EventLog } from 'ethers';
import { AlchemyProvider } from '../rpc/AlchemyProvider';
import { PoolInfo, SwapEvent, DexType } from '../../types/dex.types';
import { logger, logServiceError } from '../utils/Logger';
import { asyncErrorHandler } from '../utils/ErrorHandler';
import { calculateV2Price, calculateV3Price } from '../utils/PriceFormatter';
import EventEmitter from 'events';

// Import ABIs
import UniswapV2PoolABI from '../../contracts/abis/UniswapV2Pool.json';
import UniswapV3PoolABI from '../../contracts/abis/UniswapV3Pool.json';

export class PoolSubscriber extends EventEmitter {
  private alchemyProvider: AlchemyProvider;
  private subscriptions: Map<string, Contract> = new Map();
  private eventCache: Set<string> = new Set();
  private cacheSize: number = 1000;

  constructor(alchemyProvider: AlchemyProvider) {
    super();
    this.alchemyProvider = alchemyProvider;
  }

  /**
   * Subscribe to pool events
   */
  async subscribeToPools(pools: PoolInfo[]): Promise<void> {
    logger.info(`Subscribing to ${pools.length} pools...`);

    for (const pool of pools) {
      try {
        await this.subscribeToPool(pool);
      } catch (error) {
        logServiceError('PoolSubscriber', error as Error, {
          pool: pool.address,
        });
      }
    }

    logger.info(`Subscribed to ${this.subscriptions.size} pools`);
  }

  /**
   * Subscribe to single pool
   */
  private async subscribeToPool(pool: PoolInfo): Promise<void> {
    // Skip if already subscribed
    if (this.subscriptions.has(pool.address)) {
      return;
    }

    const provider = this.alchemyProvider.getProvider();
    const abi = pool.dexType === DexType.UNISWAP_V3 ? UniswapV3PoolABI : UniswapV2PoolABI;

    const contract = new Contract(pool.address, abi, provider);

    // Subscribe to Swap events
    contract.on(
      'Swap',
      asyncErrorHandler(
        async (...args: any[]) => {
          await this.handleSwapEvent(pool, args);
        },
        `PoolSubscriber.handleSwapEvent.${pool.address}`
      )
    );

    this.subscriptions.set(pool.address, contract);

    logger.debug('Subscribed to pool', {
      address: pool.address,
      dex: pool.dex,
      pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
    });
  }

  /**
   * Handle swap event
   */
  private async handleSwapEvent(pool: PoolInfo, args: any[]): Promise<void> {
    try {
      // Last argument is always the event object
      const event = args[args.length - 1] as EventLog;

      // Deduplicate events
      const eventId = `${event.transactionHash}-${event.index}`;
      if (this.eventCache.has(eventId)) {
        return;
      }

      this.addToEventCache(eventId);

      const swapEvent = this.parseSwapEvent(pool, args, event);

      if (swapEvent) {
        this.emit('swap', swapEvent);
      }
    } catch (error) {
      logServiceError('PoolSubscriber', error as Error, {
        pool: pool.address,
      });
    }
  }

  /**
   * Parse swap event based on DEX type
   */
  private parseSwapEvent(pool: PoolInfo, args: any[], event: EventLog): SwapEvent | null {
    try {
      if (pool.dexType === DexType.UNISWAP_V3) {
        return this.parseV3SwapEvent(pool, args, event);
      } else {
        return this.parseV2SwapEvent(pool, args, event);
      }
    } catch (error) {
      logger.debug('Failed to parse swap event', {
        pool: pool.address,
        error: (error as Error).message,
      });
      return null;
    }
  }

  /**
   * Parse Uniswap V2 style swap event
   * Event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
   */
  private parseV2SwapEvent(pool: PoolInfo, args: any[], event: EventLog): SwapEvent {
    const [sender, amount0In, amount1In, amount0Out, amount1Out, to] = args.slice(0, -1);

    // Determine which direction the swap went
    const amount0 = amount0In > 0n ? -amount0In : amount0Out;
    const amount1 = amount1In > 0n ? -amount1In : amount1Out;

    // Calculate price (simplified)
    const price =
      amount0 !== 0n
        ? (amount1 * BigInt(10 ** pool.token0.decimals)) / amount0
        : 0n;

    return {
      poolAddress: pool.address,
      dex: pool.dex,
      token0: pool.token0.address,
      token1: pool.token1.address,
      amount0,
      amount1,
      price,
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: Date.now(),
    };
  }

  /**
   * Parse Uniswap V3 swap event
   * Event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
   */
  private parseV3SwapEvent(pool: PoolInfo, args: any[], event: EventLog): SwapEvent {
    const [sender, recipient, amount0, amount1, sqrtPriceX96, liquidity, tick] = args.slice(0, -1);

    // Calculate price from sqrtPriceX96
    const price = BigInt(
      Math.floor(
        calculateV3Price(
          sqrtPriceX96,
          pool.token0.decimals,
          pool.token1.decimals
        ) * 10 ** pool.token0.decimals
      )
    );

    return {
      poolAddress: pool.address,
      dex: pool.dex,
      token0: pool.token0.address,
      token1: pool.token1.address,
      amount0: BigInt(amount0),
      amount1: BigInt(amount1),
      price,
      blockNumber: event.blockNumber,
      txHash: event.transactionHash,
      timestamp: Date.now(),
    };
  }

  /**
   * Add event ID to cache for deduplication
   */
  private addToEventCache(eventId: string): void {
    this.eventCache.add(eventId);

    // Limit cache size
    if (this.eventCache.size > this.cacheSize) {
      const firstItem = this.eventCache.values().next().value;
      this.eventCache.delete(firstItem);
    }
  }

  /**
   * Unsubscribe from pool
   */
  async unsubscribeFromPool(poolAddress: string): Promise<void> {
    const contract = this.subscriptions.get(poolAddress);

    if (contract) {
      await contract.removeAllListeners('Swap');
      this.subscriptions.delete(poolAddress);

      logger.debug('Unsubscribed from pool', { poolAddress });
    }
  }

  /**
   * Unsubscribe from all pools
   */
  async unsubscribeAll(): Promise<void> {
    for (const [address, contract] of this.subscriptions.entries()) {
      await contract.removeAllListeners('Swap');
    }

    this.subscriptions.clear();
    logger.info('Unsubscribed from all pools');
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Check if subscribed to pool
   */
  isSubscribed(poolAddress: string): boolean {
    return this.subscriptions.has(poolAddress);
  }
}
