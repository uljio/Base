/**
 * DEX-related type definitions
 */

export enum DexType {
  UNISWAP_V2 = 'UNISWAP_V2',
  UNISWAP_V3 = 'UNISWAP_V3',
}

export interface DexConfig {
  name: string;
  type: DexType;
  routerAddress: string;
  factoryAddress: string;
  feeTiers?: number[]; // For V3 DEXs
  defaultFee: number; // Default fee in basis points (e.g., 30 = 0.3%)
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface PoolInfo {
  address: string;
  dex: string;
  dexType: DexType;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number; // Fee in basis points
  liquidityUSD: number;
  volume24hUSD: number;
  lastUpdate: number; // Timestamp
}

export interface PriceInfo {
  price: bigint; // Price in wei/smallest unit
  blockNumber: number;
  timestamp: number;
  poolAddress: string;
  dex: string;
}

export interface SwapEvent {
  poolAddress: string;
  dex: string;
  token0: string;
  token1: string;
  amount0: bigint;
  amount1: bigint;
  price: bigint;
  blockNumber: number;
  txHash: string;
  timestamp: number;
}
