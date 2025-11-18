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
import { ReserveFetcher } from '../src/services/blockchain/ReserveFetcher';
import { TokenInfo } from '../src/services/blockchain/TokenInfo';
import { ethers } from 'ethers';

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

    // Initialize blockchain provider and services
    console.log('Initializing blockchain provider...\n');
    const alchemyUrl = `https://base-mainnet.g.alchemy.com/v2/${config.ALCHEMY_API_KEY}`;
    const provider = new ethers.JsonRpcProvider(alchemyUrl);
    const reserveFetcher = new ReserveFetcher(provider);
    const tokenInfo = new TokenInfo(provider);

    // Fetch reserves from blockchain
    console.log('Fetching reserves from blockchain...\n');
    const poolAddresses = pools.map(p => p.address);
    const reservesMap = await reserveFetcher.batchFetchReserves(poolAddresses);

    console.log(`Successfully fetched reserves for ${reservesMap.size}/${pools.length} pools\n`);

    // Fetch token decimals
    console.log('Fetching token decimals...\n');
    const allTokens = Array.from(
      new Set(pools.flatMap((p: PoolInfo) => [p.token0.address, p.token1.address]))
    ) as string[];
    const tokenDecimalsMap = await tokenInfo.batchGetDecimals(allTokens);

    console.log(`Fetched decimals for ${tokenDecimalsMap.size} tokens\n`);

    // Save pools to database with real reserve data
    console.log('Saving pools to database...\n');
    let savedCount = 0;
    let mismatchCount = 0;

    for (const pool of pools) {
      const reserves = reservesMap.get(pool.address.toLowerCase());

      if (reserves) {
        // Verify that GeckoTerminal's token order matches the pool contract's order
        const gtToken0 = pool.token0.address.toLowerCase();
        const gtToken1 = pool.token1.address.toLowerCase();
        const contractToken0 = reserves.token0;
        const contractToken1 = reserves.token1;

        // Check if ordering matches
        const orderMatches = (gtToken0 === contractToken0 && gtToken1 === contractToken1);

        if (!orderMatches) {
          // Log mismatch for debugging
          console.log(`⚠️  Token order mismatch for pool ${pool.address}:`);
          console.log(`    GeckoTerminal: token0=${gtToken0}, token1=${gtToken1}`);
          console.log(`    Pool contract: token0=${contractToken0}, token1=${contractToken1}`);
          mismatchCount++;
        }

        // Use the pool contract's actual token0/token1 order (the source of truth)
        const price = Pool.calculatePrice(reserves.reserve0, reserves.reserve1);

        await Pool.upsert({
          chain_id: chain.chainId,
          token0: reserves.token0,  // Use actual token0 from pool contract
          token1: reserves.token1,  // Use actual token1 from pool contract
          reserve0: reserves.reserve0,
          reserve1: reserves.reserve1,
          fee: pool.fee,
          liquidity: pool.liquidityUSD.toString(),
          price: price,
        });
        savedCount++;
      } else {
        // Skip pools without reserves - they may be invalid or use different interfaces
        console.log(`⚠️  Skipping pool ${pool.address} - no reserves fetched`);
      }
    }

    console.log(`Saved ${savedCount} pools with valid reserves\n`);
    if (mismatchCount > 0) {
      console.log(`⚠️  Found ${mismatchCount} pools with token order mismatches (fixed using contract data)\n`);
    }

    // Create a price map from pools with valid reserves
    const poolPrices = new Map<string, number>();
    const validPools: PoolInfo[] = [];

    pools.forEach((pool: PoolInfo) => {
      const reserves = reservesMap.get(pool.address.toLowerCase());
      if (reserves) {
        const price = Pool.calculatePrice(reserves.reserve0, reserves.reserve1);
        poolPrices.set(pool.address, price);
        validPools.push(pool);
      }
    });

    // Get unique token addresses from pools with valid reserves
    const tokens = Array.from(
      new Set(validPools.flatMap((p: PoolInfo) => [p.token0.address, p.token1.address]))
    ) as string[];

    console.log(`Scanning ${tokens.length} unique tokens from ${validPools.length} valid pools...\n`);

    // Scan for opportunities
    const opportunities = await opportunityDetector.scanOpportunities(
      tokens,
      poolPrices,
      tokenDecimalsMap
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
