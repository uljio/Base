/**
 * Price and amount formatting utilities
 */

import { formatUnits, parseUnits } from 'ethers';

/**
 * Format wei to ETH with specified decimal places
 */
export function formatEther(wei: bigint, decimals: number = 18): string {
  return formatUnits(wei, decimals);
}

/**
 * Format token amount with proper decimals
 */
export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  maxDecimals: number = 6
): string {
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);

  if (num === 0) return '0';

  // For small numbers, show more decimals
  if (Math.abs(num) < 0.01) {
    return num.toFixed(Math.min(decimals, 8));
  }

  // For regular numbers, limit decimals
  return num.toFixed(Math.min(maxDecimals, decimals));
}

/**
 * Format USD amount
 */
export function formatUSD(amount: number, decimals: number = 2): string {
  return `$${amount.toFixed(decimals)}`;
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Calculate price from reserves (Uniswap V2 style)
 */
export function calculateV2Price(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number
): number {
  if (reserve0 === 0n || reserve1 === 0n) return 0;

  const r0 = parseFloat(formatUnits(reserve0, decimals0));
  const r1 = parseFloat(formatUnits(reserve1, decimals1));

  return r1 / r0;
}

/**
 * Calculate price from sqrtPriceX96 (Uniswap V3 style)
 */
export function calculateV3Price(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number
): number {
  // Price = (sqrtPriceX96 / 2^96)^2
  const Q96 = 2n ** 96n;
  const price = (sqrtPriceX96 * sqrtPriceX96 * BigInt(10 ** decimals0)) / (Q96 * Q96 * BigInt(10 ** decimals1));

  return Number(price) / 10 ** decimals0;
}

/**
 * Calculate token amounts out (Uniswap V2 formula)
 */
export function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  fee: number = 30 // Fee in basis points (30 = 0.3%)
): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) {
    return 0n;
  }

  const feeDivisor = 10000n;
  const feeMultiplier = feeDivisor - BigInt(fee);

  const amountInWithFee = amountIn * feeMultiplier;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * feeDivisor + amountInWithFee;

  return numerator / denominator;
}

/**
 * Calculate optimal arbitrage amount (for equal profit between buy and sell)
 */
export function calculateOptimalAmount(
  reserveIn: bigint,
  reserveOut: bigint,
  fee: number = 30
): bigint {
  if (reserveIn === 0n || reserveOut === 0n) return 0n;

  const feeDivisor = 10000n;
  const feeMultiplier = feeDivisor - BigInt(fee);

  // Optimal amount = sqrt((reserveIn * reserveOut) / (1 - fee)^2) - reserveIn
  // Simplified for integer math
  const product = reserveIn * reserveOut;
  const sqrtProduct = sqrt(product);

  return (sqrtProduct * feeDivisor) / feeMultiplier - reserveIn;
}

/**
 * Integer square root using Newton's method
 */
function sqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error('Square root of negative numbers is not supported');
  }

  if (value < 2n) {
    return value;
  }

  let x = value;
  let y = (x + 1n) / 2n;

  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }

  return x;
}

/**
 * Calculate price impact percentage
 */
export function calculatePriceImpact(
  amountIn: bigint,
  reserveIn: bigint,
  amountOut: bigint,
  reserveOut: bigint
): number {
  if (reserveIn === 0n || reserveOut === 0n) return 100;

  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const executionPrice = Number(amountOut) / Number(amountIn);

  const impact = ((spotPrice - executionPrice) / spotPrice) * 100;
  return Math.abs(impact);
}

/**
 * Format gas price from gwei
 */
export function formatGasPrice(gwei: number): string {
  return `${gwei.toFixed(2)} gwei`;
}

/**
 * Convert ETH price to USD
 */
export function ethToUSD(ethAmount: bigint, ethPrice: number): number {
  const eth = parseFloat(formatUnits(ethAmount, 18));
  return eth * ethPrice;
}

/**
 * Format duration in milliseconds to human readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}
