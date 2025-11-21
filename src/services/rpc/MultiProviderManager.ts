/**
 * Multi-Provider Manager for Round-Robin RPC Access
 * Eliminates rate limiting by rotating through multiple public RPC endpoints
 */

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';
import { CurlRpcProvider } from '../blockchain/CurlRpcProvider';

export interface ProviderConfig {
  url: string;
  name: string;
  priority: number; // 1 = highest, 3 = lowest
  useCurl: boolean; // Use curl-based provider instead of ethers
}

export class MultiProviderManager {
  private providers: ProviderConfig[];
  private currentIndex: number = 0;
  private failedProviders: Set<string> = new Set();
  private providerInstances: Map<string, ethers.Provider | CurlRpcProvider> = new Map();
  private lastUsed: Map<string, number> = new Map();
  private readonly cooldownMs: number = 1000; // 1 second cooldown between uses

  constructor(providers: ProviderConfig[]) {
    // Sort by priority (1 = highest)
    this.providers = providers.sort((a, b) => a.priority - b.priority);
    logger.info(`MultiProviderManager initialized with ${this.providers.length} RPC endpoints`);
  }

  /**
   * Get next available provider using round-robin with cooldown
   */
  getNextProvider(): ethers.Provider | CurlRpcProvider {
    const maxAttempts = this.providers.length;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const config = this.providers[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.providers.length;
      attempts++;

      // Skip failed providers
      if (this.failedProviders.has(config.url)) {
        continue;
      }

      // Check cooldown
      const lastUsed = this.lastUsed.get(config.url) || 0;
      const timeSinceLastUse = Date.now() - lastUsed;

      if (timeSinceLastUse < this.cooldownMs) {
        continue; // Skip this provider, it was used too recently
      }

      // Get or create provider instance
      let provider = this.providerInstances.get(config.url);
      if (!provider) {
        provider = this.createProvider(config);
        this.providerInstances.set(config.url, provider);
      }

      // Update last used time
      this.lastUsed.set(config.url, Date.now());

      logger.debug(`Using RPC provider: ${config.name}`);
      return provider;
    }

    // If all providers are in cooldown or failed, use the first available one
    const fallback = this.providers[0];
    logger.warn('All providers in cooldown, using fallback:', fallback.name);

    let provider = this.providerInstances.get(fallback.url);
    if (!provider) {
      provider = this.createProvider(fallback);
      this.providerInstances.set(fallback.url, provider);
    }

    return provider;
  }

  /**
   * Create provider instance based on configuration
   */
  private createProvider(config: ProviderConfig): ethers.Provider | CurlRpcProvider {
    if (config.useCurl) {
      logger.debug(`Creating CurlRpcProvider for ${config.name}`);
      return new CurlRpcProvider(config.url);
    } else {
      logger.debug(`Creating JsonRpcProvider for ${config.name}`);
      return new ethers.JsonRpcProvider(config.url);
    }
  }

  /**
   * Mark a provider as failed (temporarily)
   */
  markProviderFailed(providerUrl: string): void {
    logger.warn(`Marking provider as failed: ${providerUrl}`);
    this.failedProviders.add(providerUrl);

    // Auto-recover after 5 minutes
    setTimeout(() => {
      logger.info(`Recovering provider: ${providerUrl}`);
      this.failedProviders.delete(providerUrl);
    }, 5 * 60 * 1000);
  }

  /**
   * Get a specific provider by name
   */
  getProviderByName(name: string): ethers.Provider | CurlRpcProvider | null {
    const config = this.providers.find(p => p.name === name);
    if (!config) return null;

    let provider = this.providerInstances.get(config.url);
    if (!provider) {
      provider = this.createProvider(config);
      this.providerInstances.set(config.url, provider);
    }

    return provider;
  }

  /**
   * Execute a function with automatic provider rotation on failure
   */
  async executeWithRetry<T>(
    fn: (provider: ethers.Provider | CurlRpcProvider) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const provider = this.getNextProvider();

      try {
        const result = await fn(provider);
        return result;
      } catch (error) {
        lastError = error as Error;
        logger.debug(`Provider attempt ${attempt + 1} failed:`, error);

        // If it's a rate limit error, mark provider as failed
        if (error instanceof Error && error.message.includes('429')) {
          const config = this.getProviderConfig(provider);
          if (config) {
            this.markProviderFailed(config.url);
          }
        }

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }

    throw new Error(`All ${maxRetries} provider attempts failed: ${lastError?.message}`);
  }

  /**
   * Get provider config from instance
   */
  private getProviderConfig(provider: ethers.Provider | CurlRpcProvider): ProviderConfig | null {
    for (const [url, instance] of this.providerInstances.entries()) {
      if (instance === provider) {
        return this.providers.find(p => p.url === url) || null;
      }
    }
    return null;
  }

  /**
   * Get statistics about provider usage
   */
  getStats(): {
    total: number;
    active: number;
    failed: number;
    providers: { name: string; status: string; lastUsed: number }[];
  } {
    return {
      total: this.providers.length,
      active: this.providers.length - this.failedProviders.size,
      failed: this.failedProviders.size,
      providers: this.providers.map(p => ({
        name: p.name,
        status: this.failedProviders.has(p.url) ? 'failed' : 'active',
        lastUsed: this.lastUsed.get(p.url) || 0,
      })),
    };
  }

  /**
   * Reset all failed providers
   */
  resetFailedProviders(): void {
    logger.info('Resetting all failed providers');
    this.failedProviders.clear();
  }
}

/**
 * Default public Base RPC endpoints
 */
export const DEFAULT_BASE_RPCS: ProviderConfig[] = [
  // Tier 1: Most reliable (use ethers for full contract support)
  {
    url: 'https://mainnet.base.org',
    name: 'Base Official',
    priority: 1,
    useCurl: false, // Changed to false for contract support
  },
  {
    url: 'https://base.publicnode.com',
    name: 'PublicNode Primary',
    priority: 1,
    useCurl: false,
  },
  {
    url: 'https://base-rpc.publicnode.com',
    name: 'PublicNode Secondary',
    priority: 1,
    useCurl: false,
  },

  // Tier 2: Good alternatives
  {
    url: 'https://base.meowrpc.com',
    name: 'MeowRPC',
    priority: 2,
    useCurl: false,
  },
  {
    url: 'https://base.drpc.org',
    name: 'dRPC',
    priority: 2,
    useCurl: false,
  },
  {
    url: 'https://rpc.ankr.com/base',
    name: 'Ankr',
    priority: 2,
    useCurl: false,
  },
  {
    url: 'https://base.gateway.tenderly.co',
    name: 'Tenderly',
    priority: 2,
    useCurl: false,
  },

  // Tier 3: Backup options
  {
    url: 'https://1rpc.io/base',
    name: '1RPC',
    priority: 3,
    useCurl: false,
  },
  {
    url: 'https://base.llamarpc.com',
    name: 'LlamaRPC',
    priority: 3,
    useCurl: false,
  },
  {
    url: 'https://base-pokt.nodies.app',
    name: 'Nodies POKT',
    priority: 3,
    useCurl: false,
  },
];

export default MultiProviderManager;
