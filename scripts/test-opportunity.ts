/**
 * Test arbitrage opportunity detection
 */

import { OpportunityDetector } from '../src/services/arbitrage/OpportunityDetector';
import { GeckoTerminal } from '../src/services/discovery/GeckoTerminal';
import { getCurrentChain } from '../src/config/chains';
import { getConfig } from '../src/config/environment';
import { PoolInfo } from '../src/types/dex.types';
import sqlite from '../src/database/sqlite';
import { Pool } from '../src/database/models/Pool';

async function main() {
  console.log('🧪 Testing arbitrage opportunity detection...\n');

  try {
    // Initialize database
    console.log('Initializing database...\n');
    await sqlite.initialize();

    // Initialize services (no provider needed for this test)
    const chain = getCurrentChain();
    const config = getConfig();

    const opportunityDetector = new OpportunityDetector(
      chain.chainId,
      config.MIN_NET_PROFIT_USD,  // Use new MIN_NET_PROFIT_USD instead of MIN_PROFIT_USD
      0.5, // 0.5% min profit percentage
      60000 // 60 second TTL
    );

    const gecko = new GeckoTerminal();

    console.log('✅ Services initialized\n');
    console.log(`Chain: ${chain.name} (${chain.chainId})`);
    console.log(`Flashloan Size: $${config.FLASH_LOAN_SIZE_USD}`);
    console.log(`Min Net Profit: $${config.MIN_NET_PROFIT_USD}`);
    console.log(`Pages to Fetch: ${config.GECKO_PAGES_TO_FETCH}\n`);

    // Discover pools using GeckoTerminal
    console.log('Fetching pools from GeckoTerminal...\n');

    const pools = await gecko.discoverPools();

    if (pools.length === 0) {
      console.log('⚠️  No pools found from GeckoTerminal.');
      console.log('   This might be a temporary API issue. Try again later.\n');
      return;
    }

    console.log(`Found ${pools.length} pools\n`);

    // Save pools to database for OpportunityDetector to use
    console.log('Saving pools to database...\n');
    for (const pool of pools) {
      await Pool.upsert({
        chain_id: chain.chainId,
        token0: pool.token0.address,
        token1: pool.token1.address,
        reserve0: '0', // We don't have reserve data from GeckoTerminal
        reserve1: '0',
        fee: pool.fee,
        liquidity: pool.liquidityUSD.toString(),
        price: 0, // Will be calculated from reserves if needed
      });
    }

    // Create a price map from pool data
    const poolPrices = new Map<string, number>();

    pools.forEach((pool: PoolInfo) => {
      // Use volume to liquidity ratio as a proxy for price volatility
      const price = pool.volume24hUSD / Math.max(pool.liquidityUSD, 1);
      poolPrices.set(pool.address, price);
    });

    // Get unique token addresses from pools
    const tokens = Array.from(
      new Set(pools.flatMap((p: PoolInfo) => [p.token0.address, p.token1.address]))
    ) as string[];

    console.log(`Scanning ${tokens.length} unique tokens...\n`);

    // Scan for opportunities
    const opportunities = await opportunityDetector.scanOpportunities(
      tokens,
      poolPrices
    );

    console.log(`\n📊 Results:`);
    console.log(`   Found ${opportunities.length} potential opportunities\n`);

    if (opportunities.length > 0) {
      console.log('Top Opportunities:\n');
      opportunities.slice(0, 5).forEach((opp, i) => {
        console.log(`${i + 1}. ${opp.tokenIn} → ${opp.tokenOut}`);
        console.log(`   Profit: $${opp.profitUsd.toFixed(2)} (${opp.profitPercentage.toFixed(2)}%)`);
        console.log(`   Confidence: ${(opp.confidence * 100).toFixed(0)}%`);
        console.log(`   Route: ${opp.route.path.join(' → ')}\n`);
      });
    } else {
      console.log('⚠️  No profitable opportunities detected.');
      console.log('   This is normal - arbitrage opportunities are rare and fleeting.\n');
    }

    console.log('✅ Test complete!\n');

    // Clean up
    sqlite.close();
  } catch (error) {
    console.error('❌ Error:', error);
    sqlite.close();
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
