/**
 * Test arbitrage opportunity detection
 */

import { getAlchemyProvider } from '../src/services/rpc/AlchemyProvider';
import { PriceMonitor } from '../src/services/monitoring/PriceMonitor';
import { OpportunityDetector } from '../src/services/arbitrage/OpportunityDetector';
import { ProfitCalculator } from '../src/services/arbitrage/ProfitCalculator';
import { WETH, USDC } from '../src/config/tokens';
import { parseUnits } from 'ethers';

async function main() {
  console.log('🧪 Testing arbitrage opportunity detection...\n');

  try {
    // Initialize services
    const provider = getAlchemyProvider();
    await provider.connect();

    const priceMonitor = new PriceMonitor();
    const profitCalculator = new ProfitCalculator();
    const opportunityDetector = new OpportunityDetector(priceMonitor, profitCalculator);

    console.log('✅ Services initialized\n');

    // Simulate price updates
    console.log('Simulating price discrepancy between DEXs...\n');

    // DEX 1: WETH/USDC at 2000 USDC per WETH
    priceMonitor.updatePrice({
      poolAddress: '0x1234...', // dummy
      dex: 'Uniswap V3',
      token0: WETH.address,
      token1: USDC.address,
      amount0: parseUnits('1', 18), // 1 WETH
      amount1: parseUnits('2000', 6), // 2000 USDC
      price: parseUnits('2000', 6), // 2000 USDC per WETH
      blockNumber: 12345,
      txHash: '0xabc...',
      timestamp: Date.now(),
    });

    // DEX 2: WETH/USDC at 2020 USDC per WETH (1% higher)
    priceMonitor.updatePrice({
      poolAddress: '0x5678...',
      dex: 'Aerodrome',
      token0: WETH.address,
      token1: USDC.address,
      amount0: parseUnits('1', 18),
      amount1: parseUnits('2020', 6),
      price: parseUnits('2020', 6),
      blockNumber: 12345,
      txHash: '0xdef...',
      timestamp: Date.now(),
    });

    console.log('Price data:');
    console.log('- Uniswap V3: 2000 USDC/WETH');
    console.log('- Aerodrome:  2020 USDC/WETH');
    console.log('- Spread:     1%\n');

    // Get price spread
    const spread = priceMonitor.getPriceSpread(WETH.address, USDC.address);

    if (spread) {
      console.log(`📊 Price Spread Detected:`);
      console.log(`   Buy on:  ${spread.lowDex}`);
      console.log(`   Sell on: ${spread.highDex}`);
      console.log(`   Spread:  ${spread.spreadPercent.toFixed(2)}%\n`);
    }

    // Simulate opportunity detection
    console.log('Running opportunity detector...\n');

    // Start detector
    await opportunityDetector.start();

    // Wait a moment for detection
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('✅ Test complete!\n');
    console.log('Note: Check logs for detected opportunities');

    await opportunityDetector.stop();
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
