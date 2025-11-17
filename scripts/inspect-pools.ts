/**
 * Inspect pools in database to understand the detected opportunities
 */

import sqlite from '../src/database/sqlite';
import { Pool } from '../src/database/models/Pool';

async function main() {
  try {
    await sqlite.initialize();

    // Get all pools with valid reserves
    const pools = await Pool.findByChain(8453, 20);

    console.log(`\n📊 Top ${pools.length} pools by liquidity:\n`);

    for (const pool of pools) {
      const reserve0Big = BigInt(pool.reserve0 || '0');
      const reserve1Big = BigInt(pool.reserve1 || '0');

      // Format reserves for readability
      const reserve0Formatted = (Number(reserve0Big) / 1e18).toFixed(2);
      const reserve1Formatted = (Number(reserve1Big) / 1e18).toFixed(2);

      console.log(`Pool: ${pool.address}`);
      console.log(`  Token0: ${pool.token0}`);
      console.log(`  Token1: ${pool.token1}`);
      console.log(`  Reserve0: ${reserve0Formatted} (${pool.reserve0})`);
      console.log(`  Reserve1: ${reserve1Formatted} (${pool.reserve1})`);
      console.log(`  Liquidity: $${Number(pool.liquidity).toLocaleString()}`);
      console.log(`  Price: ${pool.price}`);
      console.log('');
    }

    // Check USDC and WETH addresses
    const WETH = '0x4200000000000000000000000000000000000006';
    const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

    console.log('\n🔍 WETH/USDC pools:\n');
    const wethUsdcPools = await Pool.findBetweenTokens(8453, WETH, USDC);

    for (const pool of wethUsdcPools) {
      console.log(`Pool ID: ${pool.id}`);
      console.log(`  ${pool.token0} <-> ${pool.token1}`);
      console.log(`  Reserve0: ${pool.reserve0}`);
      console.log(`  Reserve1: ${pool.reserve1}`);
      console.log(`  Liquidity: $${Number(pool.liquidity).toLocaleString()}`);
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sqlite.close();
  }
}

main();
