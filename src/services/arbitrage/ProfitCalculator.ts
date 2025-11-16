'use strict';

import { Logger } from '../../utils/Logger';
import { BigNumber } from 'ethers';

/**
 * Profit Calculator Service
 * Calculates exact profit after all costs including gas, slippage, and fees
 */
export interface ProfitCalculation {
  grossProfit: string; // Profit before costs in wei
  gasCost: string; // Gas cost in wei
  protocolFees: string; // DEX protocol fees in wei
  slippageLoss: string; // Slippage loss in wei
  totalCosts: string; // Total costs in wei
  netProfit: string; // Net profit in wei
  netProfitUsd: number; // Net profit in USD
  profitMarginPercentage: number; // Net profit as percentage of input
  roiPercentage: number; // Return on investment percentage
}

export class ProfitCalculator {
  private static readonly logger = Logger.getInstance();

  /**
   * Calculate profit for an arbitrage opportunity
   */
  public static calculateProfit(
    amountIn: string,
    amountOutPredicted: string,
    gasUsed: string,
    gasPrice: string,
    slippagePercentage: number = 0.5,
    protocolFeePercentage: number = 0.3,
    tokenPrice: number = 1,
    gasTokenPrice: number = 1
  ): ProfitCalculation {
    try {
      const inBN = BigNumber.from(amountIn);
      const outBN = BigNumber.from(amountOutPredicted);
      const gasUsedBN = BigNumber.from(gasUsed);
      const gasPriceBN = BigNumber.from(gasPrice);

      // Calculate gross profit (output - input)
      const grossProfit = outBN.sub(inBN);

      // Calculate gas cost in the output token
      const gasCostWei = gasUsedBN.mul(gasPriceBN);
      const gasCostInTokens = this.convertGasToToken(gasCostWei, gasTokenPrice, tokenPrice);

      // Calculate slippage loss
      const slippageLoss = outBN.mul(Math.floor(slippagePercentage * 100)).div(10000);

      // Calculate protocol fees
      const fees = outBN.mul(Math.floor(protocolFeePercentage * 100)).div(10000);

      // Calculate total costs
      const totalCosts = BigNumber.from(gasCostInTokens)
        .add(slippageLoss)
        .add(fees);

      // Calculate net profit
      const netProfit = grossProfit.sub(totalCosts);

      // Convert to USD
      const netProfitUsd = parseFloat(
        netProfit.toString()
      ) / 1e18 * tokenPrice;

      // Calculate profit margin percentage
      const profitMarginPercentage = inBN.gt(0)
        ? (parseFloat(netProfit.toString()) / parseFloat(inBN.toString())) * 100
        : 0;

      // Calculate ROI percentage
      const roiPercentage = (netProfitUsd / (parseFloat(amountIn) / 1e18 * tokenPrice)) * 100;

      return {
        grossProfit: grossProfit.toString(),
        gasCost: gasCostInTokens.toString(),
        protocolFees: fees.toString(),
        slippageLoss: slippageLoss.toString(),
        totalCosts: totalCosts.toString(),
        netProfit: netProfit.toString(),
        netProfitUsd,
        profitMarginPercentage,
        roiPercentage: isFinite(roiPercentage) ? roiPercentage : 0,
      };
    } catch (error) {
      this.logger.error(`Failed to calculate profit: ${error}`);
      throw new Error(`Profit calculation failed: ${error}`);
    }
  }

  /**
   * Calculate minimum output amount considering slippage
   */
  public static calculateMinimumOutput(
    expectedOutput: string,
    slippagePercentage: number = 0.5
  ): string {
    try {
      const expected = BigNumber.from(expectedOutput);
      const slippage = expected.mul(Math.floor(slippagePercentage * 100)).div(10000);
      const minimum = expected.sub(slippage);
      return minimum.toString();
    } catch (error) {
      this.logger.error(`Failed to calculate minimum output: ${error}`);
      throw new Error(`Minimum output calculation failed: ${error}`);
    }
  }

  /**
   * Calculate break-even gas price for an opportunity
   */
  public static calculateBreakEvenGasPrice(
    grossProfit: string,
    gasUsed: string,
    gasTokenPrice: number = 1,
    tokenPrice: number = 1
  ): string {
    try {
      const profit = BigNumber.from(grossProfit);
      const gas = BigNumber.from(gasUsed);

      if (gas.eq(0)) {
        return '0';
      }

      // breakEvenGasPrice = (profit * tokenPrice) / (gas * gasTokenPrice)
      const breakEven = profit
        .mul(Math.floor(tokenPrice * 1e6))
        .div(gas)
        .div(Math.floor(gasTokenPrice * 1e6));

      return breakEven.toString();
    } catch (error) {
      this.logger.error(`Failed to calculate break-even gas price: ${error}`);
      throw new Error(`Break-even calculation failed: ${error}`);
    }
  }

  /**
   * Estimate gas cost in USD
   */
  public static estimateGasCostUsd(
    gasUsed: string,
    gasPrice: string,
    gasTokenPrice: number = 1
  ): number {
    try {
      const gas = BigNumber.from(gasUsed);
      const price = BigNumber.from(gasPrice);

      const gasCostWei = gas.mul(price);
      const gasCostEth = parseFloat(gasCostWei.toString()) / 1e18;
      const gasCostUsd = gasCostEth * gasTokenPrice;

      return gasCostUsd;
    } catch (error) {
      this.logger.error(`Failed to estimate gas cost: ${error}`);
      return 0;
    }
  }

  /**
   * Calculate price impact from swap size
   */
  public static calculatePriceImpact(
    amountIn: string,
    reserveIn: string,
    reserveOut: string
  ): number {
    try {
      const inBN = BigNumber.from(amountIn);
      const resInBN = BigNumber.from(reserveIn);
      const resOutBN = BigNumber.from(reserveOut);

      // Calculate spot price before swap
      const spotPrice = resOutBN.mul(1e18).div(resInBN);

      // Calculate execution price after swap
      // Using constant product formula: (x + a) * (y - b) = x * y
      // where b = y * a / (x + a)
      const amountOut = resOutBN.mul(inBN).div(resInBN.add(inBN));
      const executionPrice = amountOut.mul(1e18).div(inBN);

      // Price impact = (spotPrice - executionPrice) / spotPrice
      const impact = spotPrice.sub(executionPrice).mul(10000).div(spotPrice);

      return parseFloat(impact.toString()) / 10000;
    } catch (error) {
      this.logger.error(`Failed to calculate price impact: ${error}`);
      return 0;
    }
  }

  /**
   * Estimate slippage tolerance for safe execution
   */
  public static estimateSlippageTolerance(
    priceImpact: number,
    volatilityPercentage: number = 2
  ): number {
    try {
      // Slippage = price impact + volatility buffer
      const slippage = priceImpact + (volatilityPercentage / 100);

      // Ensure reasonable bounds
      return Math.min(Math.max(slippage, 0.1), 10); // Between 0.1% and 10%
    } catch (error) {
      this.logger.error(`Failed to estimate slippage tolerance: ${error}`);
      return 1; // Default to 1%
    }
  }

  /**
   * Calculate profit per dollar of capital
   */
  public static calculateProfitPerDollar(
    netProfit: string,
    amountIn: string,
    tokenPrice: number = 1
  ): number {
    try {
      const profit = parseFloat(netProfit) / 1e18;
      const capital = parseFloat(amountIn) / 1e18 * tokenPrice;

      if (capital === 0) {
        return 0;
      }

      return profit / capital;
    } catch (error) {
      this.logger.error(`Failed to calculate profit per dollar: ${error}`);
      return 0;
    }
  }

  /**
   * Rank opportunities by profitability
   */
  public static rankByProfitability(
    opportunities: ProfitCalculation[],
    metric: 'roi' | 'netProfit' | 'profitMargin' = 'roi'
  ): ProfitCalculation[] {
    try {
      const sorted = [...opportunities];

      switch (metric) {
        case 'roi':
          sorted.sort((a, b) => b.roiPercentage - a.roiPercentage);
          break;
        case 'netProfit':
          sorted.sort(
            (a, b) =>
              parseFloat(b.netProfit) - parseFloat(a.netProfit)
          );
          break;
        case 'profitMargin':
          sorted.sort((a, b) => b.profitMarginPercentage - a.profitMarginPercentage);
          break;
      }

      return sorted;
    } catch (error) {
      this.logger.error(`Failed to rank opportunities: ${error}`);
      return opportunities;
    }
  }

  /**
   * Convert gas costs from gas token to target token
   */
  private static convertGasToToken(
    gasCostWei: BigNumber,
    gasTokenPrice: number = 1,
    tokenPrice: number = 1
  ): string {
    try {
      // Gas token to ETH (assuming gas token is ETH)
      const gasEth = gasCostWei;

      // ETH to target token
      // gasCostInToken = gasEth * gasTokenPrice / tokenPrice
      const gasCostInToken = gasEth
        .mul(Math.floor(gasTokenPrice * 1e6))
        .div(Math.floor(tokenPrice * 1e6));

      return gasCostInToken.toString();
    } catch (error) {
      this.logger.error(`Failed to convert gas to token: ${error}`);
      return '0';
    }
  }
}

export default ProfitCalculator;
