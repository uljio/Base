/**
 * Arbitrage opportunity type definitions
 */

import { TokenInfo } from './dex.types';

export enum ArbitrageType {
  SIMPLE = 'SIMPLE', // Buy on DEX A, sell on DEX B
  TRIANGULAR = 'TRIANGULAR', // A -> B -> C -> A
}

export enum OpportunityStatus {
  DETECTED = 'DETECTED',
  VALIDATING = 'VALIDATING',
  EXECUTING = 'EXECUTING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  UNPROFITABLE = 'UNPROFITABLE',
}

export interface ArbitrageRoute {
  dex: string;
  poolAddress: string;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: bigint;
  expectedAmountOut: bigint;
  fee: number; // Fee in basis points
}

export interface ArbitrageOpportunity {
  id: string;
  type: ArbitrageType;
  routes: ArbitrageRoute[];
  startToken: TokenInfo;
  endToken: TokenInfo;
  borrowAmount: bigint;
  expectedProfit: bigint;
  expectedProfitUSD: number;
  gasEstimate: bigint;
  gasCostUSD: number;
  netProfitUSD: number;
  blockNumber: number;
  timestamp: number;
  status: OpportunityStatus;
}

export interface ProfitCalculation {
  grossProfit: bigint;
  swapFees: bigint;
  gasCost: bigint;
  flashLoanFee: bigint;
  slippage: bigint;
  netProfit: bigint;
  netProfitUSD: number;
  breakdownUSD: {
    grossProfitUSD: number;
    swapFeesUSD: number;
    gasCostUSD: number;
    flashLoanFeeUSD: number;
    slippageUSD: number;
  };
}

export interface FlashLoanParams {
  asset: string;
  amount: bigint;
  routes: ArbitrageRoute[];
  minProfit: bigint;
}
