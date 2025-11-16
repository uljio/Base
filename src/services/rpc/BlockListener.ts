/**
 * Block listener service for monitoring new blocks
 */

import { Block } from 'ethers';
import { AlchemyProvider } from './AlchemyProvider';
import { logger, logBlock, logServiceStart, logServiceError } from '../utils/Logger';
import { asyncErrorHandler } from '../utils/ErrorHandler';
import EventEmitter from 'events';

export interface BlockInfo {
  number: number;
  hash: string;
  timestamp: number;
  parentHash: string;
  transactionCount: number;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
}

export class BlockListener extends EventEmitter {
  private alchemyProvider: AlchemyProvider;
  private isListening: boolean = false;
  private blockHistory: BlockInfo[] = [];
  private maxHistorySize: number = 100;
  private processingTimes: number[] = [];

  constructor(alchemyProvider: AlchemyProvider) {
    super();
    this.alchemyProvider = alchemyProvider;
  }

  /**
   * Start listening for new blocks
   */
  async start(): Promise<void> {
    if (this.isListening) {
      logger.warn('BlockListener already running');
      return;
    }

    const provider = this.alchemyProvider.getProvider();

    // Subscribe to new blocks
    provider.on(
      'block',
      asyncErrorHandler(async (blockNumber: number) => {
        await this.handleNewBlock(blockNumber);
      }, 'BlockListener.handleNewBlock')
    );

    this.isListening = true;
    logServiceStart('BlockListener');

    // Get current block to verify
    const currentBlock = await provider.getBlockNumber();
    logger.info('Block listener started', { currentBlock });
  }

  /**
   * Handle new block event
   */
  private async handleNewBlock(blockNumber: number): Promise<void> {
    const startTime = Date.now();

    try {
      const provider = this.alchemyProvider.getProvider();
      const block = await provider.getBlock(blockNumber);

      if (!block) {
        logger.warn('Block not found', { blockNumber });
        return;
      }

      // Check for reorg (block exists but different parent)
      if (this.blockHistory.length > 0) {
        const lastBlock = this.blockHistory[this.blockHistory.length - 1];
        if (block.number <= lastBlock.number) {
          logger.warn('Potential reorg detected', {
            newBlock: block.number,
            lastBlock: lastBlock.number,
          });
          this.emit('reorg', { newBlock: block, lastBlock });
        }
      }

      const blockInfo: BlockInfo = {
        number: block.number,
        hash: block.hash || '',
        timestamp: block.timestamp,
        parentHash: block.parentHash,
        transactionCount: block.transactions.length,
        gasUsed: block.gasUsed,
        gasLimit: block.gasLimit,
        baseFeePerGas: block.baseFeePerGas,
      };

      // Add to history
      this.addToHistory(blockInfo);

      const processingTime = Date.now() - startTime;
      this.processingTimes.push(processingTime);

      // Keep only last 100 processing times
      if (this.processingTimes.length > 100) {
        this.processingTimes.shift();
      }

      logBlock(blockNumber, processingTime);

      // Emit block event
      this.emit('block', blockInfo);

      // Emit gas price update
      if (blockInfo.baseFeePerGas) {
        this.emit('gasPriceUpdate', blockInfo.baseFeePerGas);
      }
    } catch (error) {
      logServiceError('BlockListener', error as Error, { blockNumber });
    }
  }

  /**
   * Add block to history
   */
  private addToHistory(block: BlockInfo): void {
    this.blockHistory.push(block);

    // Keep only last N blocks
    if (this.blockHistory.length > this.maxHistorySize) {
      this.blockHistory.shift();
    }
  }

  /**
   * Get block history
   */
  getBlockHistory(): BlockInfo[] {
    return [...this.blockHistory];
  }

  /**
   * Get latest block
   */
  getLatestBlock(): BlockInfo | null {
    if (this.blockHistory.length === 0) {
      return null;
    }
    return this.blockHistory[this.blockHistory.length - 1];
  }

  /**
   * Get average block processing time
   */
  getAverageProcessingTime(): number {
    if (this.processingTimes.length === 0) return 0;

    const sum = this.processingTimes.reduce((a, b) => a + b, 0);
    return sum / this.processingTimes.length;
  }

  /**
   * Get block statistics
   */
  getStatistics() {
    const avgProcessingTime = this.getAverageProcessingTime();
    const latestBlock = this.getLatestBlock();

    return {
      blocksProcessed: this.blockHistory.length,
      averageProcessingTimeMs: avgProcessingTime.toFixed(2),
      latestBlock: latestBlock?.number || 0,
      latestBlockTime: latestBlock?.timestamp || 0,
    };
  }

  /**
   * Stop listening for blocks
   */
  async stop(): Promise<void> {
    if (!this.isListening) {
      return;
    }

    const provider = this.alchemyProvider.getProvider();
    provider.off('block');

    this.isListening = false;
    logger.info('BlockListener stopped');
  }

  /**
   * Check if listening
   */
  isActive(): boolean {
    return this.isListening;
  }
}
