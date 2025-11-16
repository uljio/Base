/**
 * Deploy FlashLoanArbitrage contract to Base
 */

import { ethers } from 'hardhat';
import { getConfig } from '../src/config/environment';
import { getCurrentChain } from '../src/config/chains';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Deploying FlashLoanArbitrage contract...\n');

  const config = getConfig();
  const chain = getCurrentChain();

  console.log(`Network: ${chain.name}`);
  console.log(`Chain ID: ${chain.chainId}`);

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH\n`);

  if (balance === 0n) {
    throw new Error('Deployer has no ETH balance');
  }

  // Aave V3 Pool Address Provider on Base
  const aavePoolAddressProvider = config.AAVE_POOL_ADDRESS_PROVIDER;
  console.log(`Aave Pool Address Provider: ${aavePoolAddressProvider}\n`);

  // Deploy contract
  console.log('Deploying contract...');
  const FlashLoanArbitrage = await ethers.getContractFactory('FlashLoanArbitrage');
  const contract = await FlashLoanArbitrage.deploy(aavePoolAddressProvider);

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log(`\n✅ FlashLoanArbitrage deployed to: ${contractAddress}`);
  console.log(`Explorer: ${chain.explorerUrl}/address/${contractAddress}\n`);

  // Save contract address to file
  const deploymentInfo = {
    network: chain.name,
    chainId: chain.chainId,
    contractAddress,
    aavePoolAddressProvider,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction()?.hash,
  };

  const deploymentsDir = path.join(process.cwd(), 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `${chain.name.toLowerCase().replace(' ', '-')}.json`;
  const filepath = path.join(deploymentsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));

  console.log(`Deployment info saved to: ${filepath}\n`);

  // Update .env file
  console.log('📝 Update your .env file with:');
  console.log(`FLASH_LOAN_CONTRACT_ADDRESS=${contractAddress}\n`);

  // Verify on Etherscan
  if (process.env.BASESCAN_API_KEY && !chain.isTestnet) {
    console.log('Waiting 30 seconds before verification...');
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log('Verifying contract on BaseScan...');
    try {
      await run('verify:verify', {
        address: contractAddress,
        constructorArguments: [aavePoolAddressProvider],
      });
      console.log('✅ Contract verified!');
    } catch (error: any) {
      console.log('⚠️  Verification failed:', error.message);
    }
  }

  console.log('\n🎉 Deployment complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
