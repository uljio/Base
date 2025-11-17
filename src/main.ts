/**
 * Main entry point for the arbitrage bot
 */

import { ArbitrageBot } from './bot';
import { getConfig } from './config/environment';
import { getCurrentChain } from './config/chains';
import { logger } from './services/utils/Logger';
import FlashLoanArbitrageABI from './contracts/abis/FlashLoanArbitrage.json';

async function main() {
  try {
    logger.info('Initializing Base Arbitrage Bot...');

    // Load configuration
    const config = getConfig();
    const chain = getCurrentChain();

    // Check if contract is deployed
    if (!config.FLASH_LOAN_CONTRACT_ADDRESS) {
      logger.warn('⚠️  Flash loan contract not deployed yet');
      logger.warn('   Run "npm run deploy" to deploy the contract first');
      logger.info('   Starting API server in monitoring mode...');
    }

    // Create bot instance
    // Use dummy key if PRIVATE_KEY is not set or is a placeholder value
    const hasValidPrivateKey = config.PRIVATE_KEY &&
                                config.PRIVATE_KEY !== '' &&
                                !config.PRIVATE_KEY.includes('your_private_key');
    // Use a valid dummy key for testing (this is a well-known test key with no real funds)
    const privateKey: string = hasValidPrivateKey ? config.PRIVATE_KEY! : '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    const bot = new ArbitrageBot({
      rpcUrl: chain.rpcUrls[0],
      privateKey,
      contractAddress: config.FLASH_LOAN_CONTRACT_ADDRESS || '0x' + '0'.repeat(40),
      contractAbi: FlashLoanArbitrageABI,
      apiPort: config.API_PORT,
      apiHost: '0.0.0.0',
      dryRunMode: config.EXECUTION_MODE !== 'live',
    });

    // Start the bot
    await bot.start();

    logger.info('✅ Bot is running!');
    logger.info(`   API Server: http://localhost:${config.API_PORT}`);
    logger.info(`   Mode: ${config.EXECUTION_MODE.toUpperCase()}`);
    logger.info('   Press Ctrl+C to stop');

  } catch (error) {
    logger.error(`Failed to start bot: ${error}`);
    process.exit(1);
  }
}

// Start the bot
main();
