'use strict';

import { logger } from '../../services/utils/Logger';
import { ethers, Interface, isAddress, isHexString, Transaction } from 'ethers';

/**
 * Transaction Builder Service
 * Builds EIP-1559 transactions for arbitrage execution
 */
export interface TransactionConfig {
  to: string;
  data: string;
  value?: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  gasLimit: string;
  nonce?: number;
  chainId: number;
}

export interface SignedTransaction {
  hash: string;
  from: string;
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  nonce: number;
  chainId: number;
  signature: string;
  serialized: string;
}

export class TransactionBuilder {
private readonly signer: ethers.Signer | null;
  private readonly chainId: number;

  constructor(chainId: number, signer?: ethers.Signer) {
    this.chainId = chainId;
    this.signer = signer || null;
  }

  /**
   * Build EIP-1559 transaction
   */
  public async buildTransaction(
    to: string,
    data: string,
    gasLimit: string,
    maxPriorityFeePerGas: string,
    maxFeePerGas: string,
    nonce?: number,
    value: string = '0'
  ): Promise<TransactionConfig> {
    try {
      // Validate inputs
      this.validateAddress(to);
      this.validateHexString(data);
      this.validateNumberString(gasLimit);
      this.validateNumberString(maxPriorityFeePerGas);
      this.validateNumberString(maxFeePerGas);
      this.validateNumberString(value);

      // Get nonce if not provided
      let txNonce = nonce;
      if (txNonce === undefined && this.signer && this.signer.provider) {
        const address = await this.signer.getAddress();
        txNonce = await this.signer.provider.getTransactionCount(address);
      }

      // Validate fee ordering
      const maxPriorityBN = BigInt(maxPriorityFeePerGas);
      const maxFeeBN = BigInt(maxFeePerGas);

      if (maxFeeBN < maxPriorityBN) {
        throw new Error('maxFeePerGas must be >= maxPriorityFeePerGas');
      }

      return {
        to,
        data,
        value,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit,
        nonce: txNonce,
        chainId: this.chainId,
      };
    } catch (error) {
      logger.error(`Failed to build transaction: ${error}`);
      throw new Error(`Transaction build failed: ${error}`);
    }
  }

  /**
   * Build flash swap transaction
   */
  public buildFlashSwapTransaction(
    routerAddress: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    amountOutMin: string,
    gasLimit: string,
    maxPriorityFeePerGas: string,
    maxFeePerGas: string,
    nonce?: number
  ): TransactionConfig {
    try {
      // Encode swap function call
      // This is a simplified version - real implementation depends on router ABI
      const iface = new Interface([
        'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) external returns (uint256)',
      ]);

      const data = iface.encodeFunctionData('swap', [
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMin,
      ]);

      return {
        to: routerAddress,
        data,
        value: '0',
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit,
        nonce,
        chainId: this.chainId,
      };
    } catch (error) {
      logger.error(`Failed to build flash swap: ${error}`);
      throw new Error(`Flash swap build failed: ${error}`);
    }
  }

  /**
   * Build multi-hop swap transaction
   */
  public buildMultiHopSwapTransaction(
    routerAddress: string,
    path: string[], // Token addresses in order
    amounts: string[], // Amount at each step
    gasLimit: string,
    maxPriorityFeePerGas: string,
    maxFeePerGas: string,
    nonce?: number
  ): TransactionConfig {
    try {
      if (path.length < 2) {
        throw new Error('Path must contain at least 2 tokens');
      }

      if (amounts.length !== path.length) {
        throw new Error('Amounts array must match path length');
      }

      // Encode swap function
      const iface = new Interface([
        'function swapPath(address[] calldata path, uint256[] calldata amounts) external returns (uint256)',
      ]);

      const data = iface.encodeFunctionData('swapPath', [path, amounts]);

      return {
        to: routerAddress,
        data,
        value: '0',
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit,
        nonce,
        chainId: this.chainId,
      };
    } catch (error) {
      logger.error(`Failed to build multi-hop swap: ${error}`);
      throw new Error(`Multi-hop swap build failed: ${error}`);
    }
  }

  /**
   * Sign transaction
   */
  public async signTransaction(config: TransactionConfig): Promise<SignedTransaction> {
    try {
      if (!this.signer) {
        throw new Error('Signer not configured');
      }

      // Create transaction object
      const tx = {
        to: config.to,
        data: config.data,
        value: config.value || '0',
        maxPriorityFeePerGas: BigInt(config.maxPriorityFeePerGas),
        maxFeePerGas: BigInt(config.maxFeePerGas),
        gasLimit: BigInt(config.gasLimit),
        nonce: config.nonce,
        chainId: config.chainId,
        type: 2, // EIP-1559
      };

      // Sign transaction
      const signedTx = await this.signer.signTransaction(tx);
      const parsedTx = Transaction.from(signedTx);

      return {
        hash: parsedTx.hash || '',
        from: await this.signer.getAddress(),
        to: parsedTx.to || '',
        data: parsedTx.data,
        value: parsedTx.value?.toString() || '0',
        gasLimit: parsedTx.gasLimit?.toString() || '0',
        gasPrice: parsedTx.gasPrice?.toString() || '0',
        nonce: parsedTx.nonce || 0,
        chainId: Number(parsedTx.chainId) || this.chainId,
        signature: parsedTx.signature ? JSON.stringify(parsedTx.signature) : '',
        serialized: signedTx,
      };
    } catch (error) {
      logger.error(`Failed to sign transaction: ${error}`);
      throw new Error(`Transaction signing failed: ${error}`);
    }
  }

  /**
   * Estimate transaction cost
   */
  public estimateTransactionCost(
    gasUsed: string,
    maxFeePerGas: string,
    callData: string = ''
  ): string {
    try {
      const gasBN = BigInt(gasUsed);
      const feeBN = BigInt(maxFeePerGas);

      // Calculate total gas cost
      let actualGas = gasBN;

      // Add calldata cost if provided
      if (callData) {
        const calldataGas = this.calculateCalldataGas(callData);
        actualGas = actualGas + calldataGas;
      }

      const cost = actualGas * feeBN;
      return cost.toString();
    } catch (error) {
      logger.error(`Failed to estimate transaction cost: ${error}`);
      return '0';
    }
  }

  /**
   * Calculate gas cost of calldata
   */
  private calculateCalldataGas(callData: string): bigint {
    try {
      const data = callData.startsWith('0x') ? callData.slice(2) : callData;
      let gasCost = 0n;

      for (let i = 0; i < data.length; i += 2) {
        const byte = data.slice(i, i + 2);
        // 4 gas for zero bytes, 16 gas for non-zero bytes
        const cost = byte === '00' ? 4n : 16n;
        gasCost = gasCost + cost;
      }

      return gasCost;
    } catch (error) {
      logger.error(`Failed to calculate calldata gas: ${error}`);
      return 0n;
    }
  }

  /**
   * Calculate optimal gas price given network conditions
   */
  public calculateOptimalGasPrice(
    baseFeePerGas: string,
    gasPriceMultiplier: number = 1.2,
    priorityFeePerGas: string = '2000000000' // 2 gwei
  ): { maxFeePerGas: string; maxPriorityFeePerGas: string } {
    try {
      const baseBN = BigInt(baseFeePerGas);
      const priorityBN = BigInt(priorityFeePerGas);

      // maxFeePerGas = (baseFee * multiplier) + priorityFee
      const multiplied = (baseBN * BigInt(Math.floor(gasPriceMultiplier * 1000))) / 1000n;
      const maxFee = multiplied + priorityBN;

      return {
        maxFeePerGas: maxFee.toString(),
        maxPriorityFeePerGas: priorityFeePerGas,
      };
    } catch (error) {
      logger.error(`Failed to calculate optimal gas price: ${error}`);
      return {
        maxFeePerGas: baseFeePerGas,
        maxPriorityFeePerGas: priorityFeePerGas,
      };
    }
  }

  /**
   * Validate transaction before submission
   */
  public validateTransaction(config: TransactionConfig): boolean {
    try {
      // Validate address
      this.validateAddress(config.to);

      // Validate data
      this.validateHexString(config.data);

      // Validate amounts
      this.validateNumberString(config.gasLimit);
      this.validateNumberString(config.maxFeePerGas);
      this.validateNumberString(config.maxPriorityFeePerGas);
      this.validateNumberString(config.value || '0');

      // Validate fee ordering
      const maxPriority = BigInt(config.maxPriorityFeePerGas);
      const maxFee = BigInt(config.maxFeePerGas);

      if (maxFee < maxPriority) {
        throw new Error('maxFeePerGas < maxPriorityFeePerGas');
      }

      // Validate gas limit
      const gasLimit = BigInt(config.gasLimit);
      if (gasLimit < 21000n) {
        throw new Error('Gas limit below minimum (21000)');
      }

      if (gasLimit > 30000000n) {
        throw new Error('Gas limit exceeds maximum');
      }

      return true;
    } catch (error) {
      logger.error(`Transaction validation failed: ${error}`);
      return false;
    }
  }

  /**
   * Validate address format
   */
  private validateAddress(address: string): void {
    if (!isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
  }

  /**
   * Validate hex string
   */
  private validateHexString(value: string): void {
    if (!isHexString(value)) {
      throw new Error(`Invalid hex string: ${value}`);
    }
  }

  /**
   * Validate numeric string
   */
  private validateNumberString(value: string): void {
    try {
      BigInt(value);
    } catch (error) {
      throw new Error(`Invalid number string: ${value}`);
    }
  }
}

export default TransactionBuilder;
