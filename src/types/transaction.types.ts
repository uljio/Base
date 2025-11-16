/**
 * Transaction-related type definitions
 */

export enum TransactionStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  REPLACED = 'REPLACED',
  STUCK = 'STUCK',
}

export interface TransactionConfig {
  to: string;
  data: string;
  value?: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce?: number;
  chainId: number;
}

export interface TransactionResult {
  txHash: string;
  status: TransactionStatus;
  blockNumber?: number;
  gasUsed?: bigint;
  effectiveGasPrice?: bigint;
  confirmations?: number;
  timestamp?: number;
  error?: string;
}

export interface GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedCost: bigint;
  estimatedCostUSD: number;
}

export interface PendingTransaction {
  txHash: string;
  nonce: number;
  sentAt: number;
  gasPrice: bigint;
  replacementCount: number;
}
