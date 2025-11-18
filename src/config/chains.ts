/**
 * Blockchain network configurations for Base
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrls: string[];
  wsRpcUrls: string[];
  blockTime: number; // Average block time in seconds
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  explorerUrl: string;
  isTestnet: boolean;
}

/**
 * Base Mainnet Configuration
 */
export const BASE_MAINNET: ChainConfig = {
  chainId: 8453,
  name: 'Base Mainnet',
  rpcUrls: [
    // Use public RPCs first, then Alchemy if API key is provided
    'https://mainnet.base.org',
    'https://base.publicnode.com',
    ...(process.env.ALCHEMY_API_KEY && process.env.ALCHEMY_API_KEY !== 'your_alchemy_api_key_here'
      ? [`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`]
      : []),
  ],
  wsRpcUrls: [
    ...(process.env.ALCHEMY_API_KEY && process.env.ALCHEMY_API_KEY !== 'your_alchemy_api_key_here'
      ? [`wss://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`]
      : []),
  ],
  blockTime: 2, // ~2 seconds per block
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  explorerUrl: 'https://basescan.org',
  isTestnet: false,
};

/**
 * Base Sepolia Testnet Configuration
 */
export const BASE_SEPOLIA: ChainConfig = {
  chainId: 84532,
  name: 'Base Sepolia',
  rpcUrls: [
    `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    'https://sepolia.base.org',
  ],
  wsRpcUrls: [
    `wss://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
  ],
  blockTime: 2,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  explorerUrl: 'https://sepolia.basescan.org',
  isTestnet: true,
};

/**
 * Get chain configuration based on network name
 */
export function getChainConfig(network: string = 'base-mainnet'): ChainConfig {
  switch (network.toLowerCase()) {
    case 'base-mainnet':
    case 'mainnet':
      return BASE_MAINNET;
    case 'base-sepolia':
    case 'sepolia':
    case 'testnet':
      return BASE_SEPOLIA;
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

/**
 * Get current chain configuration from environment
 */
export function getCurrentChain(): ChainConfig {
  const network = process.env.NETWORK || 'base-mainnet';
  return getChainConfig(network);
}
