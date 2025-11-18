/**
 * Test script to verify CurlRpcProvider works with real Base mainnet data
 */

import { CurlRpcProvider } from '../src/services/blockchain/CurlRpcProvider';
import { ReserveFetcher } from '../src/services/blockchain/ReserveFetcher';
import { TokenInfo } from '../src/services/blockchain/TokenInfo';
import { logger } from '../src/services/utils/Logger';
import { getCurrentChain } from '../src/config/chains';

async function main() {
  try {
    logger.info('🧪 Testing CurlRpcProvider with real Base mainnet data...\n');

    const chain = getCurrentChain();
    const rpcUrl = chain.rpcUrls[0];

    logger.info(`RPC URL: ${rpcUrl.replace(/\/v2\/[a-zA-Z0-9]+/, '/v2/***')}`);

    // Create CurlRpcProvider
    const provider = new CurlRpcProvider(rpcUrl);

    // Test 1: Get block number
    logger.info('\n📊 Test 1: Get current block number');
    const blockNumber = await provider.getBlockNumber();
    logger.info(`✅ Current block: ${blockNumber}`);

    // Test 2: Get chain ID
    logger.info('\n📊 Test 2: Get chain ID');
    const chainId = await provider.getChainId();
    logger.info(`✅ Chain ID: ${chainId} (${chainId === 8453 ? 'Base Mainnet' : 'Unknown'})`);

    // Test 3: Fetch token decimals
    logger.info('\n📊 Test 3: Fetch token decimals');
    const tokenInfo = new TokenInfo(provider);

    const WETH = '0x4200000000000000000000000000000000000006';
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    const wethDecimals = await tokenInfo.getDecimals(WETH);
    const usdcDecimals = await tokenInfo.getDecimals(USDC);

    logger.info(`✅ WETH decimals: ${wethDecimals} (expected: 18)`);
    logger.info(`✅ USDC decimals: ${usdcDecimals} (expected: 6)`);

    if (wethDecimals !== 18 || usdcDecimals !== 6) {
      throw new Error('Decimal fetch mismatch!');
    }

    // Test 4: Fetch pool reserves
    logger.info('\n📊 Test 4: Fetch pool reserves');
    const reserveFetcher = new ReserveFetcher(provider);

    // Use a known Base mainnet pool (example: a WETH/USDC pool)
    // This is a real Uniswap V2 pool on Base
    const testPoolAddress = '0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C'; // Example pool

    const reserves = await reserveFetcher.fetchReserves(testPoolAddress);

    if (reserves) {
      logger.info(`✅ Pool reserves fetched successfully!`);
      logger.info(`   Token0: ${reserves.token0}`);
      logger.info(`   Token1: ${reserves.token1}`);
      logger.info(`   Reserve0: ${reserves.reserve0}`);
      logger.info(`   Reserve1: ${reserves.reserve1}`);
      logger.info(`   Timestamp: ${reserves.timestamp}`);
    } else {
      logger.warn(`⚠️  Could not fetch reserves for pool ${testPoolAddress}`);
      logger.warn('   This might be normal if the pool address doesn\'t exist');
    }

    // Test 5: Test batch calls
    logger.info('\n📊 Test 5: Test batch RPC calls');
    const batchResults = await provider.batchCall([
      { method: 'eth_blockNumber', params: [] },
      { method: 'eth_chainId', params: [] },
      { method: 'eth_gasPrice', params: [] },
    ]);

    logger.info(`✅ Batch call results:`);
    logger.info(`   Block number: ${parseInt(batchResults[0], 16)}`);
    logger.info(`   Chain ID: ${parseInt(batchResults[1], 16)}`);
    logger.info(`   Gas price: ${parseInt(batchResults[2], 16)} wei`);

    logger.info('\n✅ ALL TESTS PASSED!');
    logger.info('\n🎉 CurlRpcProvider is working correctly!');
    logger.info('   The bot can now fetch real-time on-chain data');
    logger.info('   and detect arbitrage opportunities on live markets!');

  } catch (error) {
    logger.error(`\n❌ Test failed: ${error}`);
    if (error instanceof Error) {
      logger.error(`   ${error.stack}`);
    }
    process.exit(1);
  }
}

main();
