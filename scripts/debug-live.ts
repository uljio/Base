/**
 * Debug script that runs the same logic as test-opportunity but with more debugging
 */

import { GeckoTerminal } from '../src/services/discovery/GeckoTerminal';
import { getCurrentChain } from '../src/config/chains';
import { getConfig } from '../src/config/environment';
import { ReserveFetcher } from '../src/services/blockchain/ReserveFetcher';
import { TokenInfo } from '../src/services/blockchain/TokenInfo';
import { ethers } from 'ethers';

async function main() {
  console.log('🔍 Debug Live Pool Data\n');

  try {
    const chain = getCurrentChain();
    const config = getConfig();
    const gecko = new GeckoTerminal();

    console.log('Fetching pools from GeckoTerminal...\n');
    const pools = await gecko.discoverPools();

    if (pools.length === 0) {
      console.log('No pools found');
      return;
    }

    console.log(`Found ${pools.length} pools\n`);

    // Initialize blockchain provider and services
    console.log('Initializing blockchain provider...\n');
    const alchemyUrl = `https://base-mainnet.g.alchemy.com/v2/${config.ALCHEMY_API_KEY}`;
    const provider = new ethers.JsonRpcProvider(alchemyUrl);
    const reserveFetcher = new ReserveFetcher(provider);
    const tokenInfo = new TokenInfo(provider);

    // Take just the first 5 pools for debugging
    const testPools = pools.slice(0, 5);
    console.log(`Testing with first 5 pools:\n`);

    for (const pool of testPools) {
      console.log(`\nPool: ${pool.address}`);
      console.log(`  Token0: ${pool.token0.address} (${pool.token0.symbol})`);
      console.log(`  Token1: ${pool.token1.address} (${pool.token1.symbol})`);
      console.log(`  Liquidity: $${pool.liquidityUSD.toLocaleString()}`);

      // Fetch reserves
      const reserves = await reserveFetcher.fetchReserves(pool.address);
      if (reserves) {
        console.log(`  ✅ Reserves fetched:`);
        console.log(`    Reserve0: ${reserves.reserve0}`);
        console.log(`    Reserve1: ${reserves.reserve1}`);

        // Fetch decimals
        const decimals0 = await tokenInfo.getDecimals(pool.token0.address);
        const decimals1 = await tokenInfo.getDecimals(pool.token1.address);
        console.log(`    Token0 decimals: ${decimals0}`);
        console.log(`    Token1 decimals: ${decimals1}`);

        // Format reserves with correct decimals
        const reserve0Formatted = Number(BigInt(reserves.reserve0)) / Math.pow(10, decimals0);
        const reserve1Formatted = Number(BigInt(reserves.reserve1)) / Math.pow(10, decimals1);
        console.log(`    Reserve0 formatted: ${reserve0Formatted.toFixed(6)} ${pool.token0.symbol}`);
        console.log(`    Reserve1 formatted: ${reserve1Formatted.toFixed(6)} ${pool.token1.symbol}`);

        // Calculate implied price
        if (reserve0Formatted > 0 && reserve1Formatted > 0) {
          const price = reserve1Formatted / reserve0Formatted;
          console.log(`    Implied price: 1 ${pool.token0.symbol} = ${price.toFixed(6)} ${pool.token1.symbol}`);
        }
      } else {
        console.log(`  ❌ Failed to fetch reserves`);
      }
    }

    console.log('\n✅ Debug complete');
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
