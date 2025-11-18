/**
 * Diagnostic script to understand why arbitrage opportunities aren't being detected
 */

import sqlite from '../src/database/sqlite';
import { Pool } from '../src/database/models/Pool';
import { logger } from '../src/services/utils/Logger';
import { getCurrentChain } from '../src/config/chains';

async function main() {
  try {
    logger.info('🔧 Diagnostic Test for Arbitrage Detection');
    logger.info('='.repeat(60));

    // Initialize database
    await sqlite.initialize();
    const chain = getCurrentChain();

    // Get all pools from database
    const pools = await Pool.findByChain(chain.chainId, 100);
    logger.info(`\n📊 Found ${pools.length} pools in database:`);

    pools.forEach((pool, index) => {
      logger.info(`\nPool #${index + 1}:`);
      logger.info(`  ID: ${pool.id}`);
      logger.info(`  Token0: ${pool.token0}`);
      logger.info(`  Token1: ${pool.token1}`);
      logger.info(`  Reserve0: ${pool.reserve0}`);
      logger.info(`  Reserve1: ${pool.reserve1}`);
      logger.info(`  Fee: ${pool.fee}`);
      logger.info(`  Price: ${pool.price}`);
    });

    // Find WETH/USDC pools specifically
    const WETH = '0x4200000000000000000000000000000000000006';
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    logger.info(`\n🔍 Filtering for WETH/USDC pools...`);
    logger.info(`  WETH: ${WETH}`);
    logger.info(`  USDC: ${USDC}`);

    const wethUsdcPools = pools.filter(pool =>
      (pool.token0.toLowerCase() === WETH.toLowerCase() &&
       pool.token1.toLowerCase() === USDC.toLowerCase()) ||
      (pool.token0.toLowerCase() === USDC.toLowerCase() &&
       pool.token1.toLowerCase() === WETH.toLowerCase())
    );

    logger.info(`\n✅ Found ${wethUsdcPools.length} WETH/USDC pools:`);
    wethUsdcPools.forEach((pool, index) => {
      logger.info(`\n  Pool #${index + 1}:`);
      logger.info(`    Price: $${pool.price}`);
      logger.info(`    Fee: ${(pool.fee * 100).toFixed(2)}%`);
      logger.info(`    Reserve0: ${pool.reserve0}`);
      logger.info(`    Reserve1: ${pool.reserve1}`);
    });

    if (wethUsdcPools.length >= 2) {
      logger.info(`\n💰 Price Analysis:`);
      const prices = wethUsdcPools.map(p => p.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const priceDiff = maxPrice - minPrice;
      const priceDiffPercent = (priceDiff / minPrice) * 100;

      logger.info(`  Lowest price: $${minPrice}`);
      logger.info(`  Highest price: $${maxPrice}`);
      logger.info(`  Price difference: $${priceDiff.toFixed(2)} (${priceDiffPercent.toFixed(2)}%)`);
      logger.info(`  Potential profit (before fees): ${priceDiffPercent.toFixed(2)}%`);

      if (priceDiffPercent > 1) {
        logger.info(`\n  ✅ This is a SIGNIFICANT price discrepancy!`);
        logger.info(`  🤔 Why isn't the bot detecting it?`);
      }
    } else {
      logger.warn(`\n⚠️  Not enough WETH/USDC pools for arbitrage (need at least 2)`);
    }

    logger.info('\n' + '='.repeat(60));
    logger.info('✅ Diagnostic complete');

  } catch (error) {
    logger.error(`Diagnostic failed: ${error}`);
    process.exit(1);
  }
}

main();
