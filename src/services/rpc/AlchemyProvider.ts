/**
 * Alchemy WebSocket provider with auto-reconnect
 */

import { WebSocketProvider, TransactionReceipt } from 'ethers';
import { getCurrentChain } from '../../config/chains';
import { logger, logServiceStart, logServiceError } from '../utils/Logger';
import { withRetry, sleep } from '../utils/ErrorHandler';
import EventEmitter from 'events';

export class AlchemyProvider extends EventEmitter {
  private provider: WebSocketProvider | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000; // Start with 5 seconds
  private isConnecting: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastBlockTime: number = Date.now();

  constructor() {
    super();
  }

  /**
   * Initialize WebSocket connection
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.provider) {
      return;
    }

    this.isConnecting = true;

    try {
      const chain = getCurrentChain();
      const wsUrl = chain.wsRpcUrls[0];

      if (!wsUrl) {
        throw new Error('No WebSocket RPC URL configured');
      }

      logger.info('Connecting to Alchemy WebSocket...', { url: wsUrl.replace(/\/v2\/.*$/, '/v2/***') });

      this.provider = new WebSocketProvider(wsUrl);

      // Set up event listeners
      this.setupEventListeners();

      // Wait for connection to be established
      await this.waitForConnection();

      // Start heartbeat monitoring
      this.startHeartbeat();

      this.reconnectAttempts = 0;
      this.isConnecting = false;

      logServiceStart('AlchemyProvider', {
        network: chain.name,
        chainId: chain.chainId,
      });

      this.emit('connected');
    } catch (error) {
      this.isConnecting = false;
      logServiceError('AlchemyProvider', error as Error);
      throw error;
    }
  }

  /**
   * Wait for WebSocket connection to be established
   */
  private async waitForConnection(): Promise<void> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    // Try to get network info to verify connection
    await withRetry(
      async () => {
        const network = await this.provider!.getNetwork();
        logger.debug('Connected to network', { chainId: network.chainId.toString() });
      },
      {
        maxAttempts: 3,
        delayMs: 1000,
      },
      'WebSocket connection verification'
    );
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupEventListeners(): void {
    if (!this.provider) return;

    const ws = (this.provider as any)._websocket;

    if (ws) {
      ws.on('open', () => {
        logger.info('WebSocket connection opened');
      });

      ws.on('close', (code: number, reason: string) => {
        logger.warn('WebSocket connection closed', { code, reason });
        this.handleDisconnect();
      });

      ws.on('error', (error: Error) => {
        logger.error('WebSocket error', { error: error.message });
      });
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkConnection();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Check if connection is healthy
   */
  private async checkConnection(): Promise<void> {
    try {
      if (!this.provider) {
        throw new Error('Provider is null');
      }

      const blockNumber = await this.provider.getBlockNumber();
      this.lastBlockTime = Date.now();

      logger.debug('Heartbeat check passed', { blockNumber });
    } catch (error) {
      logger.error('Heartbeat check failed', { error: (error as Error).message });
      this.handleDisconnect();
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  private async handleDisconnect(): Promise<void> {
    this.stopHeartbeat();
    this.provider = null;
    this.emit('disconnected');

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

      logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

      await sleep(delay);

      try {
        await this.connect();
      } catch (error) {
        logger.error('Reconnection failed', { error: (error as Error).message });
      }
    } else {
      logger.error('Max reconnection attempts reached. Manual intervention required.');
      this.emit('max-reconnects-reached');
    }
  }

  /**
   * Get the provider instance
   */
  getProvider(): WebSocketProvider {
    if (!this.provider) {
      throw new Error('Provider not connected. Call connect() first.');
    }
    return this.provider;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const provider = this.getProvider();
    return await provider.getBlockNumber();
  }

  /**
   * Get balance of an address
   */
  async getBalance(address: string): Promise<bigint> {
    const provider = this.getProvider();
    return await provider.getBalance(address);
  }

  /**
   * Wait for transaction receipt
   */
  async waitForTransaction(txHash: string, confirmations: number = 1): Promise<TransactionReceipt | null> {
    const provider = this.getProvider();
    return await provider.waitForTransaction(txHash, confirmations);
  }

  /**
   * Get gas price
   */
  async getGasPrice(): Promise<bigint> {
    const provider = this.getProvider();
    const feeData = await provider.getFeeData();
    return feeData.gasPrice || 0n;
  }

  /**
   * Get fee data (EIP-1559)
   */
  async getFeeData() {
    const provider = this.getProvider();
    return await provider.getFeeData();
  }

  /**
   * Disconnect provider
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    if (this.provider) {
      await this.provider.destroy();
      this.provider = null;
    }

    this.emit('disconnected');
    logger.info('AlchemyProvider disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.provider !== null;
  }
}

// Singleton instance
let providerInstance: AlchemyProvider | null = null;

/**
 * Get singleton provider instance
 */
export function getAlchemyProvider(): AlchemyProvider {
  if (!providerInstance) {
    providerInstance = new AlchemyProvider();
  }
  return providerInstance;
}
