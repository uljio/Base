/**
 * DEX configurations for Base chain
 */

import { DexConfig, DexType } from '../types/dex.types';

/**
 * Uniswap V3 on Base
 */
export const UNISWAP_V3: DexConfig = {
  name: 'Uniswap V3',
  type: DexType.UNISWAP_V3,
  routerAddress: '0x2626664c2603336E57B271c5C0b26F421741e481', // SwapRouter02
  factoryAddress: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  feeTiers: [100, 500, 3000, 10000], // 0.01%, 0.05%, 0.3%, 1%
  defaultFee: 3000, // 0.3%
};

/**
 * Aerodrome - Major Base DEX (V2 style)
 */
export const AERODROME: DexConfig = {
  name: 'Aerodrome',
  type: DexType.UNISWAP_V2,
  routerAddress: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  factoryAddress: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  defaultFee: 30, // 0.3%
};

/**
 * Velodrome - Major Base DEX (V2 style, fork of Aerodrome)
 */
export const VELODROME: DexConfig = {
  name: 'Velodrome',
  type: DexType.UNISWAP_V2,
  routerAddress: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858',
  factoryAddress: '0x25CbdDb98b35ab1FF77413456B31EC81A6B6B746',
  defaultFee: 30, // 0.3%
};

/**
 * BaseSwap (V2 style)
 */
export const BASESWAP: DexConfig = {
  name: 'BaseSwap',
  type: DexType.UNISWAP_V2,
  routerAddress: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86',
  factoryAddress: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB',
  defaultFee: 25, // 0.25%
};

/**
 * SwapBased (V2 style)
 */
export const SWAPBASED: DexConfig = {
  name: 'SwapBased',
  type: DexType.UNISWAP_V2,
  routerAddress: '0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066',
  factoryAddress: '0x04C9f118d21e8B767D2e50C946f0cC9F6C367300',
  defaultFee: 30, // 0.3%
};

/**
 * SushiSwap V3 on Base
 */
export const SUSHISWAP_V3: DexConfig = {
  name: 'SushiSwap V3',
  type: DexType.UNISWAP_V3,
  routerAddress: '0xFB7eF66a7e61224DD6FcD0D7d9C3be5C8B049b9f',
  factoryAddress: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
  feeTiers: [100, 500, 3000, 10000],
  defaultFee: 3000,
};

/**
 * SushiSwap V2 on Base
 */
export const SUSHISWAP_V2: DexConfig = {
  name: 'SushiSwap V2',
  type: DexType.UNISWAP_V2,
  routerAddress: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
  factoryAddress: '0x71524B4f93c58fcbF659783284E38825f0622859',
  defaultFee: 30,
};

/**
 * All configured DEXs on Base
 */
export const ALL_DEXES: DexConfig[] = [
  UNISWAP_V3,
  AERODROME,
  VELODROME,
  BASESWAP,
  SWAPBASED,
  SUSHISWAP_V3,
  SUSHISWAP_V2,
];

/**
 * Get DEX configuration by name
 */
export function getDexConfig(name: string): DexConfig | undefined {
  return ALL_DEXES.find(
    (dex) => dex.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get all V2 style DEXs
 */
export function getV2Dexes(): DexConfig[] {
  return ALL_DEXES.filter((dex) => dex.type === DexType.UNISWAP_V2);
}

/**
 * Get all V3 style DEXs
 */
export function getV3Dexes(): DexConfig[] {
  return ALL_DEXES.filter((dex) => dex.type === DexType.UNISWAP_V3);
}
