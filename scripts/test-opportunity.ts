/**
 * Test arbitrage opportunity detection
 */

import { getAlchemyProvider } from '../src/services/rpc/AlchemyProvider';
import { OpportunityDetector } from '../src/services/arbitrage/OpportunityDetector';
import { getCurrentChain } from '../src/config/chains';
import { getConfig } from '../src/config/environment';
import { WETH, USDC, DAI } from '../src/config/tokens';
import { Pool } from '../src/database/models/Pool';

async function main() {
  console.log('🧪 Testing arbitrage opportunity detection...\n');

  try {
    // Initialize services
    const provider = getAlchemyProvider();
    await provider.connect();

    const chain = getCurrentChain();
    const config = getConfig();

    const opportunityDetector = new OpportunityDetector(
      chain.chainId,
      config.MIN_PROFIT_USD,
      0.5, // 0.5% min profit percentage
      60000 // 60 second TTL
    );

    console.log('✅ Services initialized\n');
    console.log(`Chain: ${chain.name} (${chain.chainId})`);
    console.log(`Min Profit: $${config.MIN_PROFIT_USD}\n`);

    // Fetch some pools from database to test with
    console.log('Fetching active pools from database...\n');

    const pools = Pool.findByStatus('active', 10);

    if (pools.length === 0) {
      console.log('⚠️  No active pools found in database.');
      console.log('   Run "npm run discover" first to populate pools.\n');
      await provider.disconnect();
      return;
    }

    console.log(`Found ${pools.length} active pools\n`);

    // Create a mock price map from pool data
    const poolPrices = new Map<string, number>();

    pools.forEach((pool) => {
      // Create synthetic price from liquidity/volume ratio
      const price = pool.volume24hUSD / Math.max(pool.liquidityUSD, 1);
      poolPrices.set(pool.address, price);
    });

    // Get unique tokens from pools
    const tokens = Array.from(
      new Set(pools.flatMap((p) => [p.token0Address, p.token1Address]))
    );

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

    await provider.disconnect();
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
