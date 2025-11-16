/**
 * Discover and analyze pools from GeckoTerminal
 */

import { GeckoTerminal } from '../src/services/discovery/GeckoTerminal';
import { PoolAnalyzer } from '../src/services/discovery/PoolAnalyzer';
import { logger } from '../src/services/utils/Logger';

async function main() {
  console.log('🔍 Discovering pools on Base chain...\n');

  try {
    // Initialize services
    const gecko = new GeckoTerminal();
    const analyzer = new PoolAnalyzer();

    // Discover pools
    console.log('Fetching pools from GeckoTerminal...');
    const pools = await gecko.discoverPools();

    console.log(`\n✅ Found ${pools.length} pools\n`);

    // Analyze pools
    console.log('Analyzing pools for arbitrage potential...\n');
    const scores = analyzer.analyzePools(pools);

    // Print summary
    analyzer.printSummary(scores, 20);

    // Find arbitrage pairs
    console.log('Finding arbitrage pairs...\n');
    const arbitragePairs = analyzer.findArbitragePairs(pools);

    console.log(`\n📊 Arbitrage Opportunities:`);
    console.log(`Total pairs: ${arbitragePairs.size}\n`);

    // Display top arbitrage pairs
    let count = 0;
    for (const [pairKey, poolList] of arbitragePairs.entries()) {
      if (count >= 10) break;

      const tokens = poolList[0];
      console.log(`\n${count + 1}. ${tokens.token0.symbol}/${tokens.token1.symbol}`);
      console.log(`   Available on ${poolList.length} DEXs:`);

      for (const pool of poolList) {
        console.log(`   - ${pool.dex.padEnd(20)} | Liquidity: $${pool.liquidityUSD.toLocaleString().padEnd(15)} | Volume: $${pool.volume24hUSD.toLocaleString()}`);
      }

      count++;
    }

    console.log('\n✨ Pool discovery complete!\n');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
