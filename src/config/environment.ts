/**
 * Environment variable configuration and validation
 */

import dotenv from 'dotenv';
import Joi from 'joi';

// Load environment variables
dotenv.config();

/**
 * Environment configuration schema
 */
const envSchema = Joi.object({
  // Alchemy
  ALCHEMY_API_KEY: Joi.string().required(),

  // Wallet
  PRIVATE_KEY: Joi.string()
    .optional()
    .allow('')
    .custom((value, helpers) => {
      // Allow empty or placeholder values
      if (!value || value === '' || value.includes('your_private_key')) {
        return value;
      }
      // Validate actual private keys
      if (!/^(0x)?[0-9a-fA-F]{64}$/.test(value)) {
        return helpers.error('any.invalid');
      }
      return value;
    }),

  // Flash Loan Contract
  FLASH_LOAN_CONTRACT_ADDRESS: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .optional()
    .allow(''),

  // Bot Configuration
  MIN_PROFIT_USD: Joi.number().min(0).default(0.10),
  MAX_GAS_PRICE_GWEI: Joi.number().min(0).default(5),
  EXECUTION_MODE: Joi.string().valid('dry-run', 'live').default('dry-run'),
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .default('info'),

  // Slippage and Risk
  MAX_SLIPPAGE_PERCENT: Joi.number().min(0).max(100).default(1),
  MAX_POSITION_SIZE_USD: Joi.number().min(0).default(1000),

  // Database
  DATABASE_PATH: Joi.string().default('./data/arbitrage.db'),

  // API
  API_PORT: Joi.number().port().default(3000),
  API_KEY: Joi.string().default(''),

  // Network
  NETWORK: Joi.string()
    .valid('base-mainnet', 'base-sepolia')
    .default('base-mainnet'),

  // Pool Discovery
  MIN_LIQUIDITY_USD: Joi.number().min(0).default(10000),
  MAX_POOLS_TO_MONITOR: Joi.number().min(1).max(2000).default(1500),
  POOL_UPDATE_INTERVAL_MINUTES: Joi.number().min(1).default(60),
  POOL_UPDATE_INTERVAL_SECONDS: Joi.number().min(1).default(60),
  GECKO_PAGES_TO_FETCH: Joi.number().min(1).max(30).default(25),
  ACCEPT_ALL_TOKENS: Joi.boolean().default(true),

  // Token Filtering
  MIN_TOKEN_POOL_COUNT: Joi.number().min(1).default(2),
  PRIORITIZE_BASE_TOKENS: Joi.boolean().default(true),

  // Monitoring
  PRICE_FRESHNESS_SECONDS: Joi.number().min(1).default(5),
  BLOCK_PROCESSING_TIMEOUT_MS: Joi.number().min(100).default(1000),

  // Flash Loan Configuration
  FLASH_LOAN_SIZE_USD: Joi.number().min(1).default(500),
  MIN_NET_PROFIT_USD: Joi.number().min(0).default(0.10),
  AAVE_POOL_ADDRESS_PROVIDER: Joi.string()
    .pattern(/^0x[0-9a-fA-F]{40}$/)
    .default('0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D'), // Base mainnet

  // Profit Calculation
  DEX_FEE_PERCENTAGE: Joi.number().min(0).max(100).default(0.3),
  FLASHLOAN_FEE_PERCENTAGE: Joi.number().min(0).max(100).default(0.09),
  ESTIMATED_GAS_COST_USD: Joi.number().min(0).default(0.30),

  // Arbitrage Path Configuration
  MAX_HOPS_STANDARD: Joi.number().min(1).max(10).default(2),
  MAX_HOPS_HIGH_PROFIT: Joi.number().min(1).max(10).default(4),
  HIGH_PROFIT_THRESHOLD_USD: Joi.number().min(0).default(5.00),
})
  .unknown(true);

/**
 * Validated environment configuration
 */
export interface EnvironmentConfig {
  // Alchemy
  ALCHEMY_API_KEY: string;

  // Wallet
  PRIVATE_KEY?: string;

  // Flash Loan Contract
  FLASH_LOAN_CONTRACT_ADDRESS?: string;

  // Bot Configuration
  MIN_PROFIT_USD: number;
  MAX_GAS_PRICE_GWEI: number;
  EXECUTION_MODE: 'dry-run' | 'live';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';

  // Slippage and Risk
  MAX_SLIPPAGE_PERCENT: number;
  MAX_POSITION_SIZE_USD: number;

  // Database
  DATABASE_PATH: string;

  // API
  API_PORT: number;
  API_KEY: string;

  // Network
  NETWORK: 'base-mainnet' | 'base-sepolia';

  // Pool Discovery
  MIN_LIQUIDITY_USD: number;
  MAX_POOLS_TO_MONITOR: number;
  POOL_UPDATE_INTERVAL_MINUTES: number;
  POOL_UPDATE_INTERVAL_SECONDS: number;
  GECKO_PAGES_TO_FETCH: number;
  ACCEPT_ALL_TOKENS: boolean;

  // Token Filtering
  MIN_TOKEN_POOL_COUNT: number;
  PRIORITIZE_BASE_TOKENS: boolean;

  // Monitoring
  PRICE_FRESHNESS_SECONDS: number;
  BLOCK_PROCESSING_TIMEOUT_MS: number;

  // Flash Loan Configuration
  FLASH_LOAN_SIZE_USD: number;
  MIN_NET_PROFIT_USD: number;
  AAVE_POOL_ADDRESS_PROVIDER: string;

  // Profit Calculation
  DEX_FEE_PERCENTAGE: number;
  FLASHLOAN_FEE_PERCENTAGE: number;
  ESTIMATED_GAS_COST_USD: number;

  // Arbitrage Path Configuration
  MAX_HOPS_STANDARD: number;
  MAX_HOPS_HIGH_PROFIT: number;
  HIGH_PROFIT_THRESHOLD_USD: number;
}

/**
 * Validate and load environment configuration
 */
export function loadEnvironment(): EnvironmentConfig {
  const { error, value } = envSchema.validate(process.env, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errorMessages = error.details.map((detail) => detail.message).join(', ');
    throw new Error(`Environment validation failed: ${errorMessages}`);
  }

  return value as EnvironmentConfig;
}

/**
 * Validate execution mode requirements
 */
export function validateExecutionMode(config: EnvironmentConfig): void {
  if (config.EXECUTION_MODE === 'live') {
    // Check for valid private key (not empty or placeholder)
    if (!config.PRIVATE_KEY ||
        config.PRIVATE_KEY === '' ||
        config.PRIVATE_KEY.includes('your_private_key')) {
      throw new Error(
        'A valid PRIVATE_KEY is required when EXECUTION_MODE is set to "live". ' +
        'Please add your real private key to the .env file.'
      );
    }

    // Validate private key format
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(config.PRIVATE_KEY)) {
      throw new Error(
        'PRIVATE_KEY must be a valid 64-character hexadecimal private key'
      );
    }

    if (!config.FLASH_LOAN_CONTRACT_ADDRESS) {
      throw new Error(
        'FLASH_LOAN_CONTRACT_ADDRESS is required when EXECUTION_MODE is set to "live"'
      );
    }

    console.warn(
      '⚠️  WARNING: Running in LIVE mode. Real transactions will be executed!'
    );
  } else {
    console.log('✅ Running in DRY-RUN mode. No transactions will be sent.');
  }
}

/**
 * Global environment configuration
 */
let cachedConfig: EnvironmentConfig | null = null;

/**
 * Get validated environment configuration
 */
export function getConfig(): EnvironmentConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnvironment();
    validateExecutionMode(cachedConfig);
  }
  return cachedConfig;
}
