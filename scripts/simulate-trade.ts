/**
 * Simulate arbitrage trade on Hardhat fork
 */

import { ethers } from 'hardhat';
import { parseUnits, formatUnits } from 'ethers';
import { WETH, USDC } from '../src/config/tokens';
import { UNISWAP_V3, AERODROME } from '../src/config/dexes';

async function main() {
  console.log('🔧 Simulating arbitrage trade on Hardhat fork...\n');

  try {
    const [signer] = await ethers.getSigners();
    console.log(`Signer: ${signer.address}\n`);

    // Get initial balance
    const wethBalance = await ethers.provider.getBalance(signer.address);
    console.log(`Initial ETH balance: ${formatUnits(wethBalance, 18)} ETH\n`);

    // Deploy FlashLoanArbitrage contract
    console.log('Deploying FlashLoanArbitrage contract...');
    const aavePoolAddressProvider = '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D';

    const FlashLoanArbitrage = await ethers.getContractFactory('FlashLoanArbitrage');
    const contract = await FlashLoanArbitrage.deploy(aavePoolAddressProvider);
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    console.log(`✅ Contract deployed to: ${contractAddress}\n`);

    // Fund contract with some ETH for gas
    console.log('Funding contract with 0.1 ETH...');
    const tx = await signer.sendTransaction({
      to: contractAddress,
      value: parseUnits('0.1', 18),
    });
    await tx.wait();
    console.log('✅ Contract funded\n');

    // Simulate arbitrage parameters
    const arbitrageParams = {
      tokenBorrow: WETH.address,
      tokenIntermediate: USDC.address,
      amountBorrow: parseUnits('1', 18), // Borrow 1 WETH
      dexBuy: UNISWAP_V3.routerAddress,
      dexSell: AERODROME.routerAddress,
      feeBuy: 3000, // 0.3% for V3
      feeSell: 0, // V2 doesn't use fee parameter
      isV3Buy: true,
      isV3Sell: false,
      minProfit: parseUnits('0.01', 18), // Minimum 0.01 WETH profit
    };

    console.log('Arbitrage Parameters:');
    console.log(`  Borrow: ${formatUnits(arbitrageParams.amountBorrow, 18)} WETH`);
    console.log(`  Buy on: Uniswap V3`);
    console.log(`  Sell on: Aerodrome`);
    console.log(`  Min profit: ${formatUnits(arbitrageParams.minProfit, 18)} WETH\n`);

    // Encode parameters
    const encodedParams = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(address,address,uint256,address,address,uint24,uint24,bool,bool,uint256)'],
      [
        [
          arbitrageParams.tokenBorrow,
          arbitrageParams.tokenIntermediate,
          arbitrageParams.amountBorrow,
          arbitrageParams.dexBuy,
          arbitrageParams.dexSell,
          arbitrageParams.feeBuy,
          arbitrageParams.feeSell,
          arbitrageParams.isV3Buy,
          arbitrageParams.isV3Sell,
          arbitrageParams.minProfit,
        ],
      ]
    );

    // Simulate flash loan execution
    console.log('Simulating flash loan execution...\n');

    try {
      // This will likely fail on a fork without proper setup,
      // but demonstrates the process
      const simulateTx = await contract.executeFlashLoanArbitrage.staticCall(
        WETH.address,
        arbitrageParams.amountBorrow,
        encodedParams
      );

      console.log('✅ Simulation successful!');
      console.log('Transaction would execute without reverting\n');
    } catch (error: any) {
      console.log('⚠️  Simulation reverted (expected on fork)');
      console.log(`Reason: ${error.message}\n`);

      console.log('Note: To successfully simulate:');
      console.log('1. Ensure Hardhat fork has latest Base state');
      console.log('2. There must be an actual price discrepancy');
      console.log('3. Liquidity must be sufficient');
      console.log('4. Gas prices must be reasonable\n');
    }

    // Get final contract balances
    const contractETH = await ethers.provider.getBalance(contractAddress);
    console.log(`Contract ETH balance: ${formatUnits(contractETH, 18)} ETH`);

    console.log('\n✨ Simulation complete!\n');
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
