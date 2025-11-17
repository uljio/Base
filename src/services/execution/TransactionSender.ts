'use strict';

import { logger } from '../../services/utils/Logger';
import { Provider } from 'ethers';

/**
 * Transaction Sender Service
 * Sends transactions and monitors their confirmation status
 */
export interface TransactionStatus {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'reverted';
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  transactionFee?: string;
  confirmations?: number;
  error?: string;
}

export interface PendingTransaction {
  hash: string;
  from: string;
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  nonce: number;
  submittedAt: number;
  confirmations: number;
}

export class TransactionSender {
private readonly provider: Provider;
  private readonly signer: any;
  private readonly chainId: number;
  private readonly confirmationTarget: number = 1;
  private readonly maxRetries: number = 3;
  private readonly retryDelay: number = 2000; // 2 seconds

  private pendingTransactions: Map<string, PendingTransaction> = new Map();
  private transactionCache: Map<string, TransactionStatus> = new Map();

  constructor(
    provider: Provider,
    signer: any,
    chainId: number,
    confirmationTarget: number = 1,
    maxRetries: number = 3
  ) {
    this.provider = provider;
    this.signer = signer;
    this.chainId = chainId;
    this.confirmationTarget = confirmationTarget;
    this.maxRetries = maxRetries;
  }

  /**
   * Send transaction with retry logic
   */
  public async sendTransaction(
    to: string,
    data: string,
    gasLimit: string,
    maxPriorityFeePerGas: string,
    maxFeePerGas: string,
    value: string = '0'
  ): Promise<string> {
    try {
      let lastError: Error | null = null;
      let txHash: string | null = null;

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          logger.info(`Sending transaction (attempt ${attempt + 1}/${this.maxRetries})`);

          const tx = await this.signer.sendTransaction({
            to,
            data,
            value: BigInt(value),
            gasLimit: BigInt(gasLimit),
            maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas),
            maxFeePerGas: BigInt(maxFeePerGas),
            type: 2,
          });

          txHash = tx.hash;
          if (!txHash) {
            throw new Error('Transaction hash is null');
          }
          logger.info(`Transaction sent: ${txHash}`);

          // Store pending transaction
          const signerAddress = await this.signer.getAddress();
          this.pendingTransactions.set(txHash, {
            hash: txHash,
            from: signerAddress,
            to,
            data,
            value,
            gasLimit,
            gasPrice: maxFeePerGas,
            nonce: tx.nonce,
            submittedAt: Date.now(),
            confirmations: 0,
          });

          return txHash;
        } catch (error) {
          lastError = error as Error;
          logger.warn(`Transaction send failed (attempt ${attempt + 1}): ${error}`);

          if (attempt < this.maxRetries - 1) {
            await this.delay(this.retryDelay * (attempt + 1)); // Exponential backoff
          }
        }
      }

      throw lastError || new Error('Transaction send failed after all retries');
    } catch (error) {
      logger.error(`Failed to send transaction: ${error}`);
      throw new Error(`Transaction send failed: ${error}`);
    }
  }

  /**
   * Monitor transaction status
   */
  public async monitorTransaction(
    txHash: string,
    timeout: number = 300000 // 5 minutes default
  ): Promise<TransactionStatus> {
    try {
      const startTime = Date.now();
      let lastError: Error | null = null;

      while (Date.now() - startTime < timeout) {
        try {
          const receipt = await this.provider.getTransactionReceipt(txHash);

          if (!receipt) {
            // Transaction still pending
            const tx = await this.provider.getTransaction(txHash);

            if (!tx) {
              // Transaction not found
              const status: TransactionStatus = {
                hash: txHash,
                status: 'failed',
                error: 'Transaction not found',
              };

              this.transactionCache.set(txHash, status);
              return status;
            }

            // Still pending - wait and retry
            await this.delay(2000);
            continue;
          }

          // Transaction confirmed or reverted
          const blockNumber = receipt.blockNumber;
          const currentBlock = await this.provider.getBlockNumber();
          const confirmations = currentBlock - blockNumber;

          const status: TransactionStatus = {
            hash: txHash,
            status: receipt.status === 1 ? 'confirmed' : 'reverted',
            blockNumber,
            gasUsed: receipt.gasUsed?.toString(),
            gasPrice: receipt.gasPrice?.toString(), // ethers v6: use gasPrice directly
            transactionFee: receipt.gasUsed
              ? (receipt.gasUsed * (receipt.gasPrice || 0n)).toString()
              : undefined,
            confirmations,
          };

          // Cache result
          this.transactionCache.set(txHash, status);
          this.pendingTransactions.delete(txHash);

          logger.info(
            `Transaction ${txHash} ${status.status} with ${confirmations} confirmations`
          );

          return status;
        } catch (error) {
          lastError = error as Error;
          logger.warn(`Failed to monitor transaction: ${error}`);
          await this.delay(2000); // Wait before retry
        }
      }

      // Timeout reached
      const timeoutStatus: TransactionStatus = {
        hash: txHash,
        status: 'pending',
        error: `Transaction monitoring timeout after ${timeout}ms`,
      };

      logger.warn(`Transaction monitoring timeout: ${txHash}`);
      return timeoutStatus;
    } catch (error) {
      logger.error(`Failed to monitor transaction: ${error}`);
      throw new Error(`Transaction monitoring failed: ${error}`);
    }
  }

  /**
   * Wait for transaction confirmation
   */
  public async waitForConfirmation(
    txHash: string,
    confirmationsRequired: number = 1,
    timeout: number = 300000
  ): Promise<boolean> {
    try {
      const status = await this.monitorTransaction(txHash, timeout);

      if (status.status === 'confirmed' && status.confirmations !== undefined) {
        return status.confirmations >= confirmationsRequired;
      }

      return false;
    } catch (error) {
      logger.error(`Failed to wait for confirmation: ${error}`);
      return false;
    }
  }

  /**
   * Get transaction status from cache or RPC
   */
  public async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
    try {
      // Check cache first
      if (this.transactionCache.has(txHash)) {
        return this.transactionCache.get(txHash)!;
      }

      // Check pending transactions
      if (this.pendingTransactions.has(txHash)) {
        const pending = this.pendingTransactions.get(txHash)!;
        const blockNumber = await this.provider.getBlockNumber();
        const confirmations = blockNumber - (pending.nonce || 0);

        return {
          hash: txHash,
          status: 'pending',
          confirmations: Math.max(0, confirmations),
        };
      }

      // Query RPC
      const receipt = await this.provider.getTransactionReceipt(txHash);

      if (receipt) {
        const currentBlock = await this.provider.getBlockNumber();
        const confirmations = currentBlock - receipt.blockNumber;

        const status: TransactionStatus = {
          hash: txHash,
          status: receipt.status === 1 ? 'confirmed' : 'reverted',
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed?.toString(),
          confirmations,
        };

        this.transactionCache.set(txHash, status);
        return status;
      }

      // Not found
      return {
        hash: txHash,
        status: 'failed',
        error: 'Transaction not found on blockchain',
      };
    } catch (error) {
      logger.error(`Failed to get transaction status: ${error}`);
      return {
        hash: txHash,
        status: 'failed',
        error: `Failed to get status: ${error}`,
      };
    }
  }

  /**
   * Cancel pending transaction via replace-by-fee
   */
  public async cancelTransaction(txHash: string): Promise<string> {
    try {
      const tx = await this.provider.getTransaction(txHash);

      if (!tx) {
        throw new Error(`Transaction ${txHash} not found`);
      }

      // Get current gas prices
      const feeData = await this.provider.getFeeData();

      // Create replacement transaction with higher gas price
      const cancellationTx = await this.signer.sendTransaction({
        to: await this.signer.getAddress(), // Send to self
        value: '0',
        nonce: tx.nonce,
        gasLimit: 21000,
        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || 0n) * 2n,
        maxFeePerGas: (feeData.maxFeePerGas || 0n) * 2n,
        type: 2,
      });

      logger.info(`Sent replacement transaction to cancel ${txHash}: ${cancellationTx.hash}`);

      return cancellationTx.hash;
    } catch (error) {
      logger.error(`Failed to cancel transaction: ${error}`);
      throw new Error(`Transaction cancellation failed: ${error}`);
    }
  }

  /**
   * Speed up pending transaction via replace-by-fee
   */
  public async speedUpTransaction(txHash: string, gasMultiplier: number = 1.5): Promise<string> {
    try {
      const tx = await this.provider.getTransaction(txHash);

      if (!tx) {
        throw new Error(`Transaction ${txHash} not found`);
      }

      // Create replacement transaction with higher gas price
      const speedupTx = await this.signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        nonce: tx.nonce,
        gasLimit: tx.gasLimit,
        maxPriorityFeePerGas: (BigInt(tx.maxPriorityFeePerGas || 0) * BigInt(Math.floor(gasMultiplier * 100))) / 100n,
        maxFeePerGas: (BigInt(tx.maxFeePerGas || 0) * BigInt(Math.floor(gasMultiplier * 100))) / 100n,
        type: 2,
      });

      logger.info(`Sped up transaction ${txHash}: ${speedupTx.hash}`);

      return speedupTx.hash;
    } catch (error) {
      logger.error(`Failed to speed up transaction: ${error}`);
      throw new Error(`Transaction speedup failed: ${error}`);
    }
  }

  /**
   * Get pending transactions
   */
  public getPendingTransactions(): PendingTransaction[] {
    return Array.from(this.pendingTransactions.values());
  }

  /**
   * Clear transaction from pending
   */
  public clearPendingTransaction(txHash: string): void {
    this.pendingTransactions.delete(txHash);
  }

  /**
   * Get transaction statistics
   */
  public async getTransactionStats(): Promise<{
    pending: number;
    confirmed: number;
    failed: number;
    avgGasCost: number;
  }> {
    try {
      let confirmed = 0;
      let failed = 0;
      let totalGasCost = 0;

      for (const [, status] of this.transactionCache) {
        if (status.status === 'confirmed') {
          confirmed++;
          if (status.transactionFee) {
            totalGasCost += parseFloat(status.transactionFee);
          }
        } else if (status.status === 'failed' || status.status === 'reverted') {
          failed++;
        }
      }

      const avgGasCost = confirmed > 0 ? totalGasCost / confirmed : 0;

      return {
        pending: this.pendingTransactions.size,
        confirmed,
        failed,
        avgGasCost,
      };
    } catch (error) {
      logger.error(`Failed to get stats: ${error}`);
      return {
        pending: 0,
        confirmed: 0,
        failed: 0,
        avgGasCost: 0,
      };
    }
  }

  /**
   * Delay utility function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default TransactionSender;
