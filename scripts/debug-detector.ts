/**
 * Debug script to trace why OpportunityDetector isn't finding opportunities
 */

import sqlite from '../src/database/sqlite';
import { Pool } from '../src/database/models/Pool';
import { logger } from '../src/services/utils/Logger';
import { getCurrentChain } from '../src/config/chains';

async function main() {
  try {
    logger.info('🐛 Debug: Tracing OpportunityDetector Logic');
    logger.info('='.repeat(70));

    // Initialize database
    await sqlite.initialize();
    const chain = getCurrentChain();

    // Mock tokens
    const WETH = '0x4200000000000000000000000000000000000006';
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
    const DAI = '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb';

    // Clear and insert test data
    sqlite.prepare('DELETE FROM pools').run();

    await Pool.upsert({
      chain_id: chain.chainId,
      token0: WETH,
      token1: USDC,
      reserve0: '100000000000000000000', // 100 WETH
      reserve1: '300000000000', // 300,000 USDC
      fee: 0.003,
      liquidity: '300000',
      price: 3000,
    });

    await Pool.upsert({
      chain_id: chain.chainId,
      token0: WETH,
      token1: USDC,
      reserve0: '50000000000000000000', // 50 WETH
      reserve1: '160000000000', // 160,000 USDC
      fee: 0.001,
      liquidity: '160000',
      price: 3200,
    });

    const pools = await Pool.findByChain(chain.chainId, 100);
    logger.info(`\n✅ Created ${pools.length} test pools\n`);

    // Manually trace what OpportunityDetector should do
    const tokens = [WETH, USDC];
    const decimalsMap = new Map([[WETH.toLowerCase(), 18], [USDC.toLowerCase(), 6]]);

    logger.info('🔍 Tracing OpportunityDetector.scanOpportunities() logic:\n');
    logger.info(`Step 1: Iterate through token pairs`);
    logger.info(`  tokens.length = ${tokens.length}`);
    logger.info(`  Will check ${tokens.length * (tokens.length - 1)} pairs\n`);

    for (let i = 0; i < tokens.length; i++) {
      for (let j = 0; j < tokens.length; j++) {
        if (i === j) continue;

        const tokenIn = tokens[i];
        const tokenOut = tokens[j];

        logger.info(`\nStep 2: Checking pair ${i}-${j}:`);
        logger.info(`  tokenIn:  ${tokenIn} (${tokenIn === WETH ? 'WETH' : 'USDC'})`);
        logger.info(`  tokenOut: ${tokenOut} (${tokenOut === WETH ? 'WETH' : 'USDC'})`);

        // Find connecting pools
        const connectingPools = pools.filter(pool =>
          (pool.token0.toLowerCase() === tokenIn.toLowerCase() &&
           pool.token1.toLowerCase() === tokenOut.toLowerCase()) ||
          (pool.token0.toLowerCase() === tokenOut.toLowerCase() &&
           pool.token1.toLowerCase() === tokenIn.toLowerCase())
        );

        logger.info(`  Found ${connectingPools.length} connecting pools`);

        if (connectingPools.length >= 2) {
          logger.info(`  ✅ ENOUGH POOLS FOR ARBITRAGE!`);
          logger.info(`\n  Pool Details:`);
          connectingPools.forEach((pool, idx) => {
            logger.info(`    Pool ${idx + 1}:`);
            logger.info(`      token0: ${pool.token0} (${pool.token0 === WETH ? 'WETH' : 'USDC'})`);
            logger.info(`      token1: ${pool.token1} (${pool.token1 === WETH ? 'WETH' : 'USDC'})`);
            logger.info(`      reserve0: ${pool.reserve0}`);
            logger.info(`      reserve1: ${pool.reserve1}`);
            logger.info(`      price: $${pool.price}`);
            logger.info(`      fee: ${(pool.fee * 100).toFixed(2)}%`);
          });

          logger.info(`\n  Step 3: Calculate arbitrage for each pool pair`);

          for (let x = 0; x < connectingPools.length; x++) {
            for (let y = x + 1; y < connectingPools.length; y++) {
              const pool1 = connectingPools[x];
              const pool2 = connectingPools[y];

              logger.info(`\n  Attempting arbitrage: Pool ${x+1} → Pool ${y+1}`);
              logger.info(`    Buy from Pool ${x+1} ($${pool1.price}), Sell to Pool ${y+1} ($${pool2.price})`);

              // Simulate the calculation
              const decimals = decimalsMap.get(tokenIn.toLowerCase()) || 18;
              const decimalsOut = decimalsMap.get(tokenOut.toLowerCase()) || 18;
              const tradeSizeUsd = 50;

              logger.info(`    Trade config:`);
              logger.info(`      tradeSizeUsd: $${tradeSizeUsd}`);
              logger.info(`      tokenIn decimals: ${decimals}`);
              logger.info(`      tokenOut decimals: ${decimalsOut}`);

              // Calculate what amountIn should be
              const buyIsToken0 = pool1.token0.toLowerCase() === tokenIn.toLowerCase();
              const reserveIn = BigInt(buyIsToken0 ? pool1.reserve0 : pool1.reserve1);
              const reserveOut = BigInt(buyIsToken0 ? pool1.reserve1 : pool1.reserve0);

              logger.info(`    Reserves for buy pool:`);
              logger.info(`      reserveIn (${tokenIn === WETH ? 'WETH' : 'USDC'}): ${reserveIn}`);
              logger.info(`      reserveOut (${tokenOut === WETH ? 'WETH' : 'USDC'}): ${reserveOut}`);

              // Price calculation
              const priceRatio = Number(reserveOut) / Number(reserveIn);
              const decimalAdjustment = Math.pow(10, decimals - decimalsOut);
              const tokenInPriceInTokenOut = priceRatio * decimalAdjustment;

              logger.info(`    Price calculation:`);
              logger.info(`      priceRatio: ${priceRatio}`);
              logger.info(`      decimalAdjustment: ${decimalAdjustment}`);
              logger.info(`      tokenInPriceInTokenOut: ${tokenInPriceInTokenOut}`);

              if (decimalsOut >= 6 && decimalsOut <= 8) {
                const tokenInPriceUsd = tokenInPriceInTokenOut;
                const tokenAmount = tradeSizeUsd / tokenInPriceUsd;
                const decimalMultiplier = Math.pow(10, decimals);
                const amountIn = BigInt(Math.floor(tokenAmount * decimalMultiplier));

                logger.info(`    ✅ Using price-based calculation (tokenOut is stablecoin):`);
                logger.info(`      tokenInPriceUsd: $${tokenInPriceUsd}`);
                logger.info(`      tokenAmount: ${tokenAmount}`);
                logger.info(`      amountIn: ${amountIn} wei`);
                logger.info(`      amountIn in human: ${Number(amountIn) / decimalMultiplier} tokens`);
              } else {
                const decimalMultiplier = Math.pow(10, decimals);
                const amountIn = BigInt(Math.floor(tradeSizeUsd * decimalMultiplier));
                logger.info(`    ⚠️  Using simple calculation (assuming tokenIn is stablecoin):`);
                logger.info(`      amountIn: ${amountIn} wei`);
                logger.info(`      amountIn in human: ${Number(amountIn) / decimalMultiplier} tokens`);
              }
            }
          }
        } else {
          logger.info(`  ❌ Not enough pools (need 2, found ${connectingPools.length})`);
        }
      }
    }

    logger.info('\n' + '='.repeat(70));
    logger.info('✅ Debug trace complete');

  } catch (error) {
    logger.error(`Debug failed: ${error}`);
    process.exit(1);
  }
}

main();
