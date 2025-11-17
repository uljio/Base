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

    // Use dummy private key for dry-run mode or if no valid key is provided
    const isDryRun = config.EXECUTION_MODE !== 'live';
    let privateKey = config.PRIVATE_KEY;

    // Validate private key format
    const isValidKey = privateKey &&
                       !privateKey.includes('your_private_key') &&
                       /^(0x)?[0-9a-fA-F]{64}$/.test(privateKey);

    if (!isValidKey) {
      if (isDryRun) {
        // Use dummy key for dry-run mode
        privateKey = '0x' + '1'.repeat(64);
        logger.info('Using dummy private key for dry-run mode');
      } else {
        logger.error('❌ Valid PRIVATE_KEY is required for live mode');
        logger.error('   Please set a valid private key in your .env file');
        process.exit(1);
      }
    }

    // Create bot instance
    const bot = new ArbitrageBot({
      rpcUrl: chain.rpcUrls[0],
      privateKey: privateKey as string,
      contractAddress: config.FLASH_LOAN_CONTRACT_ADDRESS || '0x' + '0'.repeat(40),
      contractAbi: FlashLoanArbitrageABI,
      apiPort: config.API_PORT,
      apiHost: '0.0.0.0',
      dryRunMode: isDryRun,
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
