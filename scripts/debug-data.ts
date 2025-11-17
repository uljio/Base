/**
 * Debug script to inspect actual data in database
 */

import sqlite from '../src/database/sqlite';
import { Pool } from '../src/database/models/Pool';

async function main() {
  try {
    await sqlite.initialize();

    console.log('\n🔍 Debugging Database Contents\n');

    // Get all pools
    const pools = await Pool.findByChain(8453, 500);
    console.log(`Total pools in database: ${pools.length}\n`);

    if (pools.length === 0) {
      console.log('❌ No pools found in database!');
      return;
    }

    // Check for pools with valid reserves
    const poolsWithReserves = pools.filter(p =>
      p.reserve0 && p.reserve1 &&
      p.reserve0 !== '0' && p.reserve1 !== '0'
    );

    console.log(`Pools with valid reserves: ${poolsWithReserves.length}\n`);

    if (poolsWithReserves.length === 0) {
      console.log('❌ No pools have valid reserves!');
      console.log('\nSample pool data:');
      pools.slice(0, 3).forEach(p => {
        console.log(`  Pool: ${p.id}`);
        console.log(`    Token0: ${p.token0}`);
        console.log(`    Token1: ${p.token1}`);
        console.log(`    Reserve0: ${p.reserve0}`);
        console.log(`    Reserve1: ${p.reserve1}`);
        console.log(`    Liquidity: ${p.liquidity}`);
        console.log('');
      });
      return;
    }

    // Show top pools by liquidity
    console.log('📊 Top 5 pools with reserves:\n');
    poolsWithReserves.slice(0, 5).forEach((p, i) => {
      const reserve0Big = BigInt(p.reserve0);
      const reserve1Big = BigInt(p.reserve1);

      // Try to format assuming different decimals
      const r0_18 = Number(reserve0Big) / 1e18;
      const r1_18 = Number(reserve1Big) / 1e18;
      const r0_6 = Number(reserve0Big) / 1e6;
      const r1_6 = Number(reserve1Big) / 1e6;

      console.log(`${i + 1}. Pool ID: ${p.id}`);
      console.log(`   Token0: ${p.token0}`);
      console.log(`   Token1: ${p.token1}`);
      console.log(`   Reserve0: ${p.reserve0}`);
      console.log(`     - As 18 decimals: ${r0_18.toFixed(6)}`);
      console.log(`     - As 6 decimals: ${r0_6.toFixed(2)}`);
      console.log(`   Reserve1: ${p.reserve1}`);
      console.log(`     - As 18 decimals: ${r1_18.toFixed(6)}`);
      console.log(`     - As 6 decimals: ${r1_6.toFixed(2)}`);
      console.log(`   Liquidity USD: $${Number(p.liquidity).toLocaleString()}`);
      console.log('');
    });

    // Check WETH/USDC pools specifically
    const WETH = '0x4200000000000000000000000000000000000006';
    const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

    console.log('\n💱 WETH/USDC Pools:\n');
    const wethUsdcPools = poolsWithReserves.filter(p =>
      (p.token0.toLowerCase() === WETH.toLowerCase() && p.token1.toLowerCase() === USDC.toLowerCase()) ||
      (p.token0.toLowerCase() === USDC.toLowerCase() && p.token1.toLowerCase() === WETH.toLowerCase())
    );

    console.log(`Found ${wethUsdcPools.length} WETH/USDC pools with reserves\n`);

    wethUsdcPools.forEach((p, i) => {
      const isToken0USDC = p.token0.toLowerCase() === USDC.toLowerCase();
      const usdcReserve = isToken0USDC ? p.reserve0 : p.reserve1;
      const wethReserve = isToken0USDC ? p.reserve1 : p.reserve0;

      const usdcAmount = Number(BigInt(usdcReserve)) / 1e6; // USDC has 6 decimals
      const wethAmount = Number(BigInt(wethReserve)) / 1e18; // WETH has 18 decimals

      console.log(`${i + 1}. Pool: ${p.id}`);
      console.log(`   USDC Reserve: ${usdcAmount.toFixed(2)} USDC (${usdcReserve} wei)`);
      console.log(`   WETH Reserve: ${wethAmount.toFixed(6)} WETH (${wethReserve} wei)`);
      console.log(`   Implied Price: ${usdcAmount > 0 ? (wethAmount / usdcAmount * 1e6).toFixed(2) : 'N/A'} USDC per WETH`);
      console.log(`   Liquidity: $${Number(p.liquidity).toLocaleString()}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await sqlite.close();
  }
}

main();
