/**
 * Token configurations for Base chain
 */

import { TokenInfo } from '../types/dex.types';

/**
 * Wrapped Ether (WETH) on Base
 */
export const WETH: TokenInfo = {
  address: '0x4200000000000000000000000000000000000006',
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
};

/**
 * USD Coin (USDC) - Native on Base
 */
export const USDC: TokenInfo = {
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
};

/**
 * Bridged USD Coin (USDbC) - Bridged from Ethereum
 */
export const USDbC: TokenInfo = {
  address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  symbol: 'USDbC',
  name: 'USD Base Coin',
  decimals: 6,
};

/**
 * Dai Stablecoin (DAI) on Base
 */
export const DAI: TokenInfo = {
  address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  symbol: 'DAI',
  name: 'Dai Stablecoin',
  decimals: 18,
};

/**
 * Coinbase Wrapped Staked ETH (cbETH)
 */
export const cbETH: TokenInfo = {
  address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  symbol: 'cbETH',
  name: 'Coinbase Wrapped Staked ETH',
  decimals: 18,
};

/**
 * Tether USD (USDT) on Base
 */
export const USDT: TokenInfo = {
  address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
};

/**
 * All common tokens on Base
 */
export const ALL_TOKENS: TokenInfo[] = [
  WETH,
  USDC,
  USDbC,
  DAI,
  cbETH,
  USDT,
];

/**
 * Stablecoins on Base
 */
export const STABLECOINS: TokenInfo[] = [
  USDC,
  USDbC,
  DAI,
  USDT,
];

/**
 * Get token info by address
 */
export function getTokenByAddress(address: string): TokenInfo | undefined {
  return ALL_TOKENS.find(
    (token) => token.address.toLowerCase() === address.toLowerCase()
  );
}

/**
 * Get token info by symbol
 */
export function getTokenBySymbol(symbol: string): TokenInfo | undefined {
  return ALL_TOKENS.find(
    (token) => token.symbol.toLowerCase() === symbol.toLowerCase()
  );
}

/**
 * Check if token is a stablecoin
 */
export function isStablecoin(tokenAddress: string): boolean {
  return STABLECOINS.some(
    (token) => token.address.toLowerCase() === tokenAddress.toLowerCase()
  );
}

/**
 * Format token amount to human-readable string
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;

  if (fractionalPart === 0n) {
    return integerPart.toString();
  }

  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  return `${integerPart}.${fractionalStr}`;
}

/**
 * Parse human-readable token amount to wei/smallest unit
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  const parts = amount.split('.');
  const integerPart = parts[0] || '0';
  const fractionalPart = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);

  return BigInt(integerPart) * BigInt(10 ** decimals) + BigInt(fractionalPart);
}
