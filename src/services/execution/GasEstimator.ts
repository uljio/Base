'use strict';

import { Logger } from '../../utils/Logger';
import { BigNumber, ethers } from 'ethers';

/**
 * Gas Estimator Service
 * Estimates gas costs for transactions
 */
export interface GasEstimate {
  gasUsed: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  estimatedCostWei: string;
  estimatedCostUsd: number;
}

export interface NetworkGasPrices {
  baseFeePerGas: string;
  priorityFeePerGas: string;
  gasPrice: string;
  standardGasPrice: string;
  fastGasPrice: string;
}

export class GasEstimator {
  private static readonly logger = Logger.getInstance();
  private readonly provider: ethers.providers.Provider | null;
  private readonly chainId: number;
  private gasTokenPrice: number = 1; // ETH price in USD

  // Gas usage constants for different operations
  private readonly GAS_CONSTANTS = {
    TRANSFER: 21000,
    SWAP: 100000,
    MULTI_HOP_SWAP: 150000,
    FLASH_SWAP: 200000,
    APPROVE: 45000,
    MINT: 80000,
    BURN: 60000,
    UNISWAP_V2_SWAP: 120000,
    UNISWAP_V3_SWAP: 200000,
    CURVE_SWAP: 100000,
  };

  constructor(
    chainId: number,
    provider?: ethers.providers.Provider,
    gasTokenPrice: number = 1
  ) {
    this.chainId = chainId;
    this.provider = provider || null;
    this.gasTokenPrice = gasTokenPrice;
  }

  /**
   * Estimate gas for swap transaction
   */
  public async estimateSwapGas(
    to: string,
    data: string,
    value: string = '0'
  ): Promise<GasEstimate> {
    try {
      const gasLimit = await this.getGasLimit(to, data, value);
      const gasPrices = await this.getGasPrices();

      return this.buildGasEstimate(
        gasLimit,
        gasPrices.baseFeePerGas,
        gasPrices.priorityFeePerGas
      );
    } catch (error) {
      this.logger.error(`Failed to estimate swap gas: ${error}`);
      // Return conservative estimate
      return this.buildGasEstimate(
        this.GAS_CONSTANTS.UNISWAP_V2_SWAP.toString(),
        '30000000000',
        '2000000000'
      );
    }
  }

  /**
   * Estimate gas for multi-hop swap
   */
  public async estimateMultiHopSwapGas(
    to: string,
    data: string,
    hopCount: number
  ): Promise<GasEstimate> {
    try {
      // Base swap gas + additional gas per hop
      const baseGas = this.GAS_CONSTANTS.MULTI_HOP_SWAP;
      const gasPerHop = 40000;
      const estimatedGas = (baseGas + gasPerHop * (hopCount - 1)).toString();

      const gasPrices = await this.getGasPrices();

      return this.buildGasEstimate(
        estimatedGas,
        gasPrices.baseFeePerGas,
        gasPrices.priorityFeePerGas
      );
    } catch (error) {
      this.logger.error(`Failed to estimate multi-hop gas: ${error}`);
      return this.buildGasEstimate(
        this.GAS_CONSTANTS.MULTI_HOP_SWAP.toString(),
        '30000000000',
        '2000000000'
      );
    }
  }

  /**
   * Estimate gas for flash swap
   */
  public async estimateFlashSwapGas(): Promise<GasEstimate> {
    try {
      const gasPrices = await this.getGasPrices();

      return this.buildGasEstimate(
        this.GAS_CONSTANTS.FLASH_SWAP.toString(),
        gasPrices.baseFeePerGas,
        gasPrices.priorityFeePerGas
      );
    } catch (error) {
      this.logger.error(`Failed to estimate flash swap gas: ${error}`);
      return this.buildGasEstimate(
        this.GAS_CONSTANTS.FLASH_SWAP.toString(),
        '30000000000',
        '2000000000'
      );
    }
  }

  /**
   * Get current network gas prices
   */
  public async getGasPrices(): Promise<NetworkGasPrices> {
    try {
      if (!this.provider) {
        // Return default prices if no provider
        return {
          baseFeePerGas: '30000000000', // 30 gwei
          priorityFeePerGas: '2000000000', // 2 gwei
          gasPrice: '32000000000', // 32 gwei
          standardGasPrice: '30000000000',
          fastGasPrice: '50000000000',
        };
      }

      const feeData = await this.provider.getFeeData();

      return {
        baseFeePerGas: feeData.lastBaseFeePerGas?.toString() || '30000000000',
        priorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() || '2000000000',
        gasPrice: feeData.gasPrice?.toString() || '32000000000',
        standardGasPrice: feeData.gasPrice?.toString() || '30000000000',
        fastGasPrice: BigNumber.from(feeData.gasPrice || '32000000000')
          .mul(13)
          .div(10)
          .toString(),
      };
    } catch (error) {
      this.logger.warn(`Failed to get gas prices: ${error}`);
      // Return reasonable defaults
      return {
        baseFeePerGas: '30000000000',
        priorityFeePerGas: '2000000000',
        gasPrice: '32000000000',
        standardGasPrice: '30000000000',
        fastGasPrice: '50000000000',
      };
    }
  }

  /**
   * Estimate gas limit for transaction
   */
  private async getGasLimit(to: string, data: string, value: string = '0'): Promise<string> {
    try {
      if (!this.provider) {
        // Return default estimate
        return this.GAS_CONSTANTS.SWAP.toString();
      }

      const estimate = await this.provider.estimateGas({
        to,
        data,
        value: BigNumber.from(value),
      });

      // Add 20% buffer to avoid out-of-gas errors
      const withBuffer = estimate.mul(120).div(100);
      return withBuffer.toString();
    } catch (error) {
      this.logger.warn(`Failed to estimate gas limit: ${error}`);
      // Return conservative estimate
      return this.GAS_CONSTANTS.SWAP.toString();
    }
  }

  /**
   * Build gas estimate object
   */
  private buildGasEstimate(
    gasUsed: string,
    baseFeePerGas: string,
    priorityFeePerGas: string
  ): GasEstimate {
    try {
      const gasUsedBN = BigNumber.from(gasUsed);
      const baseBN = BigNumber.from(baseFeePerGas);
      const priorityBN = BigNumber.from(priorityFeePerGas);

      // maxFeePerGas = baseFee + priorityFee
      const maxFeePerGas = baseBN.add(priorityBN);

      // Estimated cost
      const estimatedCost = gasUsedBN.mul(maxFeePerGas);
      const estimatedCostUsd = parseFloat(estimatedCost.toString()) / 1e18 * this.gasTokenPrice;

      return {
        gasUsed: gasUsed,
        gasLimit: gasUsedBN.mul(120).div(100).toString(), // 20% buffer
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: priorityFeePerGas,
        estimatedCostWei: estimatedCost.toString(),
        estimatedCostUsd,
      };
    } catch (error) {
      this.logger.error(`Failed to build gas estimate: ${error}`);
      throw new Error(`Gas estimate build failed: ${error}`);
    }
  }

  /**
   * Calculate gas cost in USD
   */
  public calculateGasCostUsd(gasUsed: string, gasPrice: string): number {
    try {
      const gas = BigNumber.from(gasUsed);
      const price = BigNumber.from(gasPrice);

      const totalWei = gas.mul(price);
      const totalEth = parseFloat(totalWei.toString()) / 1e18;
      const totalUsd = totalEth * this.gasTokenPrice;

      return totalUsd;
    } catch (error) {
      this.logger.error(`Failed to calculate gas cost: ${error}`);
      return 0;
    }
  }

  /**
   * Estimate gas for token approval
   */
  public async estimateApproveGas(): Promise<GasEstimate> {
    try {
      const gasPrices = await this.getGasPrices();

      return this.buildGasEstimate(
        this.GAS_CONSTANTS.APPROVE.toString(),
        gasPrices.baseFeePerGas,
        gasPrices.priorityFeePerGas
      );
    } catch (error) {
      this.logger.error(`Failed to estimate approve gas: ${error}`);
      return this.buildGasEstimate(
        this.GAS_CONSTANTS.APPROVE.toString(),
        '30000000000',
        '2000000000'
      );
    }
  }

  /**
   * Check if transaction would be profitable after gas costs
   */
  public isProfitable(
    profitUsd: number,
    estimatedGasCostUsd: number,
    minProfitMargin: number = 0.1
  ): boolean {
    try {
      const netProfit = profitUsd - estimatedGasCostUsd;
      const minProfit = estimatedGasCostUsd * minProfitMargin;

      return netProfit > minProfit;
    } catch (error) {
      this.logger.error(`Failed to check profitability: ${error}`);
      return false;
    }
  }

  /**
   * Calculate gas price multiplier for priority
   */
  public getGasPriceMultiplier(priority: 'standard' | 'fast' | 'instant' = 'standard'): number {
    switch (priority) {
      case 'standard':
        return 1.0;
      case 'fast':
        return 1.3;
      case 'instant':
        return 1.6;
      default:
        return 1.0;
    }
  }

  /**
   * Update gas token price
   */
  public setGasTokenPrice(price: number): void {
    this.gasTokenPrice = price;
    this.logger.info(`Updated gas token price to ${price} USD`);
  }

  /**
   * Get estimated gas for different DEX operations
   */
  public getOperationGasEstimate(operation: keyof typeof this.GAS_CONSTANTS): number {
    return this.GAS_CONSTANTS[operation] || this.GAS_CONSTANTS.SWAP;
  }
}

export default GasEstimator;
