/**
 * Analyze the arbitrage bot run results
 */

import sqlite from '../src/database/sqlite';
import { Pool } from '../src/database/models/Pool';
import { Opportunity } from '../src/database/models/Opportunity';
import { logger } from '../src/services/utils/Logger';
import { getCurrentChain } from '../src/config/chains';

async function main() {
  try {
    logger.info('📊 Analyzing Arbitrage Bot Run Results\n');
    logger.info('='.repeat(80));

    await sqlite.initialize();
    const chain = getCurrentChain();

    // Get all pools
    const pools = await Pool.findByChain(chain.chainId, 10000);
    logger.info(`\n✅ Pools discovered and saved: ${pools.length}`);

    if (pools.length > 0) {
      // Group by token pairs
      const tokenPairs = new Map<string, Pool[]>();
      pools.forEach(pool => {
        const pair = [pool.token0, pool.token1].sort().join('-');
        if (!tokenPairs.has(pair)) {
          tokenPairs.set(pair, []);
        }
        tokenPairs.get(pair)!.push(pool);
      });

      logger.info(`\n📈 Unique token pairs: ${tokenPairs.size}`);
      logger.info(`\n🔍 Top 10 Pools by Liquidity:`);

      const topPools = pools
        .sort((a, b) => parseFloat(b.liquidity) - parseFloat(a.liquidity))
        .slice(0, 10);

      topPools.forEach((pool, i) => {
        logger.info(`\n${i + 1}. Pool:`);
        logger.info(`   Token0: ${pool.token0}`);
        logger.info(`   Token1: ${pool.token1}`);
        logger.info(`   Liquidity: $${parseFloat(pool.liquidity).toLocaleString()}`);
        logger.info(`   Reserve0: ${pool.reserve0}`);
        logger.info(`   Reserve1: ${pool.reserve1}`);
        logger.info(`   Price: ${pool.price}`);
        logger.info(`   Fee: ${(pool.fee * 100).toFixed(2)}%`);
      });

      // Check for pairs with multiple pools (potential arbitrage)
      logger.info(`\n\n🎯 Token pairs with multiple pools (arbitrage candidates):`);
      let pairsWithMultiplePools = 0;
      tokenPairs.forEach((poolList, pair) => {
        if (poolList.length >= 2) {
          pairsWithMultiplePools++;
          logger.info(`\n${pair}:`);
          logger.info(`  ${poolList.length} pools found`);
          poolList.forEach((pool, idx) => {
            logger.info(`  Pool ${idx + 1}:`);
            logger.info(`    Price: ${pool.price.toFixed(6)}`);
            logger.info(`    Liquidity: $${parseFloat(pool.liquidity).toLocaleString()}`);
            logger.info(`    Fee: ${(pool.fee * 100).toFixed(2)}%`);
          });

          // Calculate potential price spread
          if (poolList.length === 2) {
            const spread = Math.abs(poolList[0].price - poolList[1].price);
            const spreadPct = (spread / Math.min(poolList[0].price, poolList[1].price)) * 100;
            logger.info(`  💰 Price spread: ${spreadPct.toFixed(4)}%`);
          }
        }
      });

      logger.info(`\n\nTotal pairs with 2+ pools: ${pairsWithMultiplePools}`);
    }

    // Get all opportunities
    const opportunities = await Opportunity.findPending(10000);
    logger.info(`\n\n💰 Arbitrage Opportunities Found: ${opportunities.length}`);

    if (opportunities.length > 0) {
      logger.info('\n' + '='.repeat(80));
      logger.info('ARBITRAGE OPPORTUNITIES DETAILS:');
      logger.info('='.repeat(80));

      opportunities.forEach((opp, i) => {
        logger.info(`\n📊 Opportunity #${i + 1}:`);
        logger.info(`   Token In:  ${opp.token_in}`);
        logger.info(`   Token Out: ${opp.token_out}`);
        logger.info(`   Amount In: ${opp.amount_in}`);
        logger.info(`   Amount Out (Predicted): ${opp.amount_out_predicted}`);
        logger.info(`   Profit: $${opp.profit_usd.toFixed(2)} (${opp.profit_percentage.toFixed(2)}%)`);
        logger.info(`   Status: ${opp.status}`);
        logger.info(`   Created: ${new Date(opp.created_at).toISOString()}`);

        if (opp.route) {
          try {
            const route = JSON.parse(opp.route);
            logger.info(`   Route: ${route.path ? route.path.join(' → ') : 'N/A'}`);
          } catch (e) {
            logger.info(`   Route: ${opp.route}`);
          }
        }
      });
    } else {
      logger.info('\n⚠️  No profitable arbitrage opportunities were detected.');
      logger.info('\nPossible reasons:');
      logger.info('1. Market is efficient - no price discrepancies above profit thresholds');
      logger.info('2. Fees (DEX + flashloan + gas) consume potential profits');
      logger.info('3. Minimum profit threshold too high ($0.50)');
      logger.info('4. Limited number of pools with valid reserves');
      logger.info('5. Price spreads exist but are smaller than transaction costs');
    }

    logger.info('\n' + '='.repeat(80));
    logger.info('\n✅ Analysis complete!');

  } catch (error) {
    logger.error(`Analysis failed: ${error}`);
    process.exit(1);
  }
}

main();
