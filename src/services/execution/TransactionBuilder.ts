'use strict';

import { Logger } from '../../utils/Logger';
import { BigNumber, ethers } from 'ethers';

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
  private static readonly logger = Logger.getInstance();
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
      if (txNonce === undefined && this.signer) {
        txNonce = await this.signer.getTransactionCount();
      }

      // Validate fee ordering
      const maxPriorityBN = BigNumber.from(maxPriorityFeePerGas);
      const maxFeeBN = BigNumber.from(maxFeePerGas);

      if (maxFeeBN.lt(maxPriorityBN)) {
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
      this.logger.error(`Failed to build transaction: ${error}`);
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
      const iface = new ethers.utils.Interface([
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
      this.logger.error(`Failed to build flash swap: ${error}`);
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
      const iface = new ethers.utils.Interface([
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
      this.logger.error(`Failed to build multi-hop swap: ${error}`);
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
        maxPriorityFeePerGas: BigNumber.from(config.maxPriorityFeePerGas),
        maxFeePerGas: BigNumber.from(config.maxFeePerGas),
        gasLimit: BigNumber.from(config.gasLimit),
        nonce: config.nonce,
        chainId: config.chainId,
        type: 2, // EIP-1559
      };

      // Sign transaction
      const signedTx = await this.signer.signTransaction(tx);
      const parsedTx = ethers.utils.parseTransaction(signedTx);

      return {
        hash: parsedTx.hash || '',
        from: await this.signer.getAddress(),
        to: parsedTx.to || '',
        data: parsedTx.data,
        value: parsedTx.value?.toString() || '0',
        gasLimit: parsedTx.gasLimit?.toString() || '0',
        gasPrice: parsedTx.gasPrice?.toString() || '0',
        nonce: parsedTx.nonce || 0,
        chainId: parsedTx.chainId || this.chainId,
        signature: parsedTx.signature || '',
        serialized: signedTx,
      };
    } catch (error) {
      this.logger.error(`Failed to sign transaction: ${error}`);
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
      const gasBN = BigNumber.from(gasUsed);
      const feeBN = BigNumber.from(maxFeePerGas);

      // Calculate total gas cost
      let actualGas = gasBN;

      // Add calldata cost if provided
      if (callData) {
        const calldataGas = this.calculateCalldataGas(callData);
        actualGas = actualGas.add(calldataGas);
      }

      const cost = actualGas.mul(feeBN);
      return cost.toString();
    } catch (error) {
      this.logger.error(`Failed to estimate transaction cost: ${error}`);
      return '0';
    }
  }

  /**
   * Calculate gas cost of calldata
   */
  private calculateCalldataGas(callData: string): BigNumber {
    try {
      const data = callData.startsWith('0x') ? callData.slice(2) : callData;
      let gasCost = BigNumber.from(0);

      for (let i = 0; i < data.length; i += 2) {
        const byte = data.slice(i, i + 2);
        // 4 gas for zero bytes, 16 gas for non-zero bytes
        const cost = byte === '00' ? 4 : 16;
        gasCost = gasCost.add(cost);
      }

      return gasCost;
    } catch (error) {
      this.logger.error(`Failed to calculate calldata gas: ${error}`);
      return BigNumber.from(0);
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
      const baseBN = BigNumber.from(baseFeePerGas);
      const priorityBN = BigNumber.from(priorityFeePerGas);

      // maxFeePerGas = (baseFee * multiplier) + priorityFee
      const multiplied = baseBN.mul(Math.floor(gasPriceMultiplier * 1000)).div(1000);
      const maxFee = multiplied.add(priorityBN);

      return {
        maxFeePerGas: maxFee.toString(),
        maxPriorityFeePerGas: priorityFeePerGas,
      };
    } catch (error) {
      this.logger.error(`Failed to calculate optimal gas price: ${error}`);
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
      const maxPriority = BigNumber.from(config.maxPriorityFeePerGas);
      const maxFee = BigNumber.from(config.maxFeePerGas);

      if (maxFee.lt(maxPriority)) {
        throw new Error('maxFeePerGas < maxPriorityFeePerGas');
      }

      // Validate gas limit
      const gasLimit = BigNumber.from(config.gasLimit);
      if (gasLimit.lt(21000)) {
        throw new Error('Gas limit below minimum (21000)');
      }

      if (gasLimit.gt(BigNumber.from('30000000'))) {
        throw new Error('Gas limit exceeds maximum');
      }

      return true;
    } catch (error) {
      this.logger.error(`Transaction validation failed: ${error}`);
      return false;
    }
  }

  /**
   * Validate address format
   */
  private validateAddress(address: string): void {
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
  }

  /**
   * Validate hex string
   */
  private validateHexString(value: string): void {
    if (!ethers.utils.isHexString(value)) {
      throw new Error(`Invalid hex string: ${value}`);
    }
  }

  /**
   * Validate numeric string
   */
  private validateNumberString(value: string): void {
    try {
      BigNumber.from(value);
    } catch (error) {
      throw new Error(`Invalid number string: ${value}`);
    }
  }
}

export default TransactionBuilder;
