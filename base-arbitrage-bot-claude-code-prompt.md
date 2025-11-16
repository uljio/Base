# Complete Base Chain DEX Arbitrage Bot - Claude Code Implementation Prompt

Use this prompt with Claude Code to build a production-ready arbitrage monitoring and execution system.

---

## CLAUDE CODE PROMPT

```
Create a complete Base chain DEX arbitrage bot with the following specifications:

## PROJECT STRUCTURE

base-arbitrage-bot/
├── src/
│   ├── config/
│   │   ├── chains.ts              # Chain configurations (Base mainnet/testnet)
│   │   ├── dexes.ts               # DEX contract addresses and ABIs
│   │   ├── tokens.ts              # Token addresses and metadata
│   │   └── environment.ts         # Environment variables handler
│   ├── services/
│   │   ├── rpc/
│   │   │   ├── AlchemyProvider.ts # Alchemy WebSocket connection manager
│   │   │   └── BlockListener.ts   # New block event handler
│   │   ├── discovery/
│   │   │   ├── GeckoTerminal.ts   # Pool discovery using GeckoTerminal API
│   │   │   └── PoolAnalyzer.ts    # Analyze pools for liquidity/volume
│   │   ├── monitoring/
│   │   │   ├── PriceMonitor.ts    # Real-time price monitoring via events
│   │   │   ├── PoolSubscriber.ts  # Subscribe to DEX pool events
│   │   │   └── MemPoolMonitor.ts  # Monitor pending transactions (optional)
│   │   ├── arbitrage/
│   │   │   ├── OpportunityDetector.ts  # Detect arbitrage opportunities
│   │   │   ├── ProfitCalculator.ts     # Calculate profit after gas
│   │   │   ├── RouteOptimizer.ts       # Find optimal swap routes
│   │   │   └── FlashLoanExecutor.ts    # Execute flash loan arbitrage
│   │   ├── execution/
│   │   │   ├── TransactionBuilder.ts   # Build arbitrage transactions
│   │   │   ├── GasEstimator.ts         # Estimate and optimize gas
│   │   │   └── TransactionSender.ts    # Send and monitor transactions
│   │   └── utils/
│   │       ├── Logger.ts               # Structured logging
│   │       ├── PriceFormatter.ts       # Format prices and amounts
│   │       └── ErrorHandler.ts         # Error handling and retry logic
│   ├── contracts/
│   │   ├── abis/
│   │   │   ├── UniswapV2Pool.json     # Uniswap V2 style DEX ABI
│   │   │   ├── UniswapV3Pool.json     # Uniswap V3 ABI
│   │   │   ├── AaveFlashLoan.json     # Aave V3 flash loan ABI
│   │   │   └── ERC20.json             # ERC20 token ABI
│   │   └── FlashLoanArbitrage.sol     # Solidity flash loan contract
│   ├── types/
│   │   ├── dex.types.ts               # DEX related types
│   │   ├── arbitrage.types.ts         # Arbitrage opportunity types
│   │   └── transaction.types.ts       # Transaction types
│   ├── database/
│   │   ├── sqlite.ts                  # SQLite setup for logging
│   │   └── models/
│   │       ├── Opportunity.ts         # Log arbitrage opportunities
│   │       ├── Execution.ts           # Log executed trades
│   │       └── Pool.ts                # Cache pool data
│   ├── api/
│   │   ├── server.ts                  # Express API server
│   │   └── routes/
│   │       ├── status.ts              # Bot status and stats
│   │       ├── opportunities.ts       # View detected opportunities
│   │       └── config.ts              # Update configuration
│   └── bot.ts                         # Main bot orchestrator
├── scripts/
│   ├── deploy-contract.ts             # Deploy flash loan contract
│   ├── discover-pools.ts              # Initial pool discovery
│   ├── test-opportunity.ts            # Test arbitrage detection
│   └── simulate-trade.ts              # Simulate trades on fork
├── test/
│   ├── unit/
│   │   ├── PriceMonitor.test.ts
│   │   ├── OpportunityDetector.test.ts
│   │   └── ProfitCalculator.test.ts
│   └── integration/
│       ├── FlashLoanExecution.test.ts
│       └── EndToEnd.test.ts
├── contracts/                         # Hardhat project for smart contracts
│   ├── FlashLoanArbitrage.sol
│   ├── test/
│   └── hardhat.config.ts
├── .env.example                       # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── DEPLOYMENT.md

## DETAILED IMPLEMENTATION REQUIREMENTS

### 1. CONFIGURATION FILES

#### src/config/chains.ts
- Export Base mainnet configuration (chainId: 8453)
- Export Base Sepolia testnet configuration (chainId: 84532)
- Include RPC URLs for Alchemy (primary) and public RPCs (fallback)
- WebSocket URLs for real-time monitoring
- Block time (~2 seconds)
- Gas price configuration
- Explorer URLs (BaseScan)

#### src/config/dexes.ts
- Configure these Base DEXs with contract addresses:
  * Uniswap V3
  * Aerodrome (major Base DEX)
  * BaseSwap
  * SwapBased
  * SushiSwap
- For each DEX include:
  * Router address
  * Factory address
  * Pool ABI (V2 or V3)
  * Fee tiers (if V3)
  * Name and type

#### src/config/tokens.ts
- Common Base tokens:
  * WETH: 0x4200000000000000000000000000000000000006
  * USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  * USDbC: 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA
  * DAI: 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb
- Include decimals, symbol, name for each token

#### src/config/environment.ts
- Load and validate environment variables:
  * ALCHEMY_API_KEY (required)
  * PRIVATE_KEY (required for execution)
  * FLASH_LOAN_CONTRACT_ADDRESS
  * MIN_PROFIT_USD (default: 10)
  * MAX_GAS_PRICE_GWEI (default: 5)
  * EXECUTION_MODE ('dry-run' or 'live')
  * LOG_LEVEL ('debug', 'info', 'warn', 'error')
  * DATABASE_PATH (default: ./data/arbitrage.db)
  * API_PORT (default: 3000)

### 2. RPC CONNECTION

#### src/services/rpc/AlchemyProvider.ts
- Create WebSocket provider using ethers v6
- Implement connection with auto-reconnect
- Handle connection errors with exponential backoff
- Provide methods:
  * getProvider(): WebSocketProvider
  * getBlockNumber(): Promise<number>
  * getBalance(address): Promise<BigInt>
  * waitForTransaction(txHash): Promise<TransactionReceipt>
- Implement connection health checks
- Log connection status changes

#### src/services/rpc/BlockListener.ts
- Subscribe to new blocks via WebSocket
- Emit events for each new block
- Track block processing time
- Handle reorgs (check if block exists)
- Maintain block history (last 100 blocks)

### 3. POOL DISCOVERY

#### src/services/discovery/GeckoTerminal.ts
- Fetch top pools from GeckoTerminal API:
  * URL: https://api.geckoterminal.com/api/v2/networks/base/pools
  * Sort by 24h volume
  * Filter: liquidity > $50,000
  * Include: WETH, USDC, USDbC pairs
- Parse response and extract:
  * Pool address
  * Token addresses (token0, token1)
  * DEX name
  * Liquidity (USD)
  * 24h volume
  * Price
- Implement caching (5 minute TTL)
- Handle rate limits (respect 30 requests/min)
- Retry logic for failed requests

#### src/services/discovery/PoolAnalyzer.ts
- Analyze discovered pools:
  * Calculate volume/liquidity ratio
  * Identify high-activity pools
  * Filter out low liquidity (<$50k)
  * Rank pools by arbitrage potential score
- Score formula: (volume_24h / liquidity) * price_volatility
- Return top 20-50 pools to monitor
- Update pool list every hour

### 4. REAL-TIME MONITORING

#### src/services/monitoring/PoolSubscriber.ts
- For each monitored pool:
  * Create contract instance with pool ABI
  * Subscribe to 'Swap' events via WebSocket
  * Parse event data (amount0, amount1, sqrtPriceX96, tick)
  * Calculate current price from event data
  * Emit price update events
- Handle both Uniswap V2 and V3 pool formats
- Implement event deduplication (same tx, same pool)
- Track event processing latency

#### src/services/monitoring/PriceMonitor.ts
- Maintain in-memory price cache for all monitored pools
- Structure: Map<poolAddress, { price, timestamp, blockNumber }>
- Update cache on each Swap event
- Provide methods:
  * getPrice(tokenA, tokenB, dex): Promise<BigInt>
  * getPriceWithFreshness(tokenA, tokenB, dex, maxAge): Promise<BigInt | null>
  * getAllPrices(tokenA, tokenB): Map<dex, price>
- Implement staleness detection (warn if price >5 seconds old)
- Calculate price in both directions (A/B and B/A)

#### src/services/monitoring/MemPoolMonitor.ts (OPTIONAL - Advanced)
- Subscribe to pending transactions
- Filter for DEX swap transactions
- Detect large trades that may move prices
- Emit alerts for potential front-running opportunities
- This is advanced - mark as optional in comments

### 5. ARBITRAGE DETECTION

#### src/services/arbitrage/OpportunityDetector.ts
- On each price update:
  * Compare prices across all DEXs for the same pair
  * Calculate potential profit = (sellPrice - buyPrice) - fees
  * Account for:
    - DEX swap fees (0.3% for V2, 0.05-1% for V3)
    - Gas costs (~0.5-2M gas for flash loan arbitrage)
    - Slippage (estimate based on liquidity)
    - Flash loan fees (0.09% for Aave V3)
- Detect two types of arbitrage:
  * Simple: Buy on DEX A, sell on DEX B (2 swaps)
  * Triangular: A→B→C→A (3+ swaps, more complex)
- Validate opportunity:
  * Is profit > MIN_PROFIT_USD?
  * Is liquidity sufficient?
  * Is gas price acceptable?
- Emit OpportunityFound event with full details

#### src/services/arbitrage/ProfitCalculator.ts
- Calculate exact profit for an opportunity:
  * Input: buy amount, buy DEX, sell DEX, token pair
  * Output: net profit in USD after all costs
- Detailed cost breakdown:
  * Swap fee on DEX 1
  * Swap fee on DEX 2
  * Gas cost (estimate: 1.5M gas × current gas price)
  * Flash loan fee (loan amount × 0.0009)
  * Slippage (1% default, adjustable)
- Implement getAmountsOut calculation (like Uniswap router)
- Handle both V2 and V3 pools (different pricing formulas)
- Account for price impact on low liquidity pools

#### src/services/arbitrage/RouteOptimizer.ts
- Find optimal swap route for arbitrage
- For simple arbitrage (A→B on DEX1, B→A on DEX2):
  * Calculate optimal amount to borrow
  * Formula: sqrt((reserveIn * reserveOut) / (1 - fee)²)
- For triangular arbitrage:
  * Generate possible routes (max 4 hops)
  * Calculate profit for each route
  * Return most profitable
- Consider multi-hop routes (e.g., ETH→USDC→DAI→ETH)
- Validate route doesn't exceed gas limits

### 6. FLASH LOAN EXECUTION

#### src/contracts/FlashLoanArbitrage.sol
Create a Solidity contract with these features:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract FlashLoanArbitrage is FlashLoanSimpleReceiverBase {
    address payable public owner;
    
    struct ArbitrageParams {
        address tokenBorrow;
        address tokenPay;
        uint256 amountBorrow;
        address dexBuy;      // Router address for buying
        address dexSell;     // Router address for selling
        uint24 fee;          // For V3 pools
    }
    
    constructor(address _addressProvider) 
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider)) 
    {
        owner = payable(msg.sender);
    }
    
    function executeFlashLoanArbitrage(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        // Request flash loan from Aave V3
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        // Decode arbitrage parameters
        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));
        
        // Step 1: Swap borrowed token on DEX 1
        // Step 2: Swap received token on DEX 2
        // Step 3: Ensure we have enough to repay flash loan + premium
        
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwed);
        
        return true;
    }
    
    // Emergency functions
    function withdrawToken(address token) external onlyOwner { }
    function withdrawETH() external onlyOwner { }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
}
```

- Implement full contract with proper error handling
- Add events for tracking execution
- Include security checks (reentrancy guard, owner only)
- Optimize gas usage

#### src/services/arbitrage/FlashLoanExecutor.ts
- Build and execute flash loan transactions
- Steps:
  1. Encode arbitrage parameters
  2. Estimate gas for flash loan call
  3. Build transaction with proper gas settings
  4. Sign transaction with private key
  5. Send transaction via Alchemy
  6. Monitor transaction status
  7. Handle success/failure
- Implement dry-run mode (simulate without sending)
- Use Tenderly or Hardhat fork for simulation
- Log all execution attempts to database

### 7. TRANSACTION EXECUTION

#### src/services/execution/TransactionBuilder.ts
- Build EIP-1559 transactions for Base
- Set proper gas parameters:
  * maxFeePerGas: Current base fee × 1.5
  * maxPriorityFeePerGas: 0.1 gwei (Base is cheap)
  * gasLimit: 2M for flash loan arbitrage
- Add nonce management (track pending txs)
- Implement transaction replacement (speed up if needed)
- Build call data for contract interactions

#### src/services/execution/GasEstimator.ts
- Estimate gas for arbitrage transactions
- Use eth_estimateGas with proper error handling
- Add 20% buffer to estimates
- Monitor Base network gas prices
- Track historical gas usage for optimization
- Implement gas price ceiling (reject if too high)

#### src/services/execution/TransactionSender.ts
- Send signed transactions via Alchemy
- Implement retry logic (max 3 attempts)
- Monitor transaction status:
  * Pending: Wait for inclusion
  * Success: Log and celebrate
  * Failed: Parse revert reason, log, alert
  * Stuck: Replace with higher gas
- Track transaction lifecycle
- Implement mempool monitoring for sent txs

### 8. DATABASE & LOGGING

#### src/database/sqlite.ts
- Set up SQLite database with tables:
  * opportunities (id, timestamp, tokenA, tokenB, dex1, dex2, profit, status)
  * executions (id, opportunity_id, txHash, gasUsed, actualProfit, timestamp)
  * pools (address, dex, tokenA, tokenB, liquidity, volume, lastUpdate)
  * errors (id, timestamp, service, error, stack)
- Implement connection pooling
- Add migrations for schema updates
- Create indexes for performance

#### src/services/utils/Logger.ts
- Implement structured logging with Winston
- Log levels: debug, info, warn, error
- Output formats:
  * Console: Colorized, human-readable
  * File: JSON for analysis
  * Database: Critical events
- Include context: timestamp, service, blockNumber
- Implement log rotation (daily files)

### 9. API SERVER

#### src/api/server.ts
- Create Express server on configured port
- Endpoints:
  * GET /status - Bot status, uptime, stats
  * GET /opportunities - Recent opportunities (last 100)
  * GET /executions - Execution history
  * GET /pools - Currently monitored pools
  * GET /config - Current configuration
  * POST /config - Update config (min profit, etc.)
  * POST /pause - Pause bot
  * POST /resume - Resume bot
- Add authentication (API key from env)
- CORS configuration
- Rate limiting

### 10. MAIN BOT ORCHESTRATOR

#### src/bot.ts
Main application that ties everything together:

```typescript
class ArbitrageBot {
  private provider: AlchemyProvider;
  private blockListener: BlockListener;
  private poolDiscovery: GeckoTerminal;
  private poolSubscriber: PoolSubscriber;
  private priceMonitor: PriceMonitor;
  private opportunityDetector: OpportunityDetector;
  private flashLoanExecutor: FlashLoanExecutor;
  private apiServer: APIServer;
  private isRunning: boolean = false;
  
  async start() {
    // 1. Initialize all services
    // 2. Discover pools from GeckoTerminal
    // 3. Subscribe to pool events via WebSocket
    // 4. Start block listener
    // 5. Start opportunity detection
    // 6. Start API server
    // 7. Log startup complete
  }
  
  async stop() {
    // Graceful shutdown of all services
  }
  
  private async onNewBlock(blockNumber: number) {
    // Update gas prices
    // Log block processing stats
  }
  
  private async onPriceUpdate(pool, price) {
    // Trigger arbitrage detection
  }
  
  private async onOpportunityFound(opportunity) {
    // Log to database
    // If profitable enough and execution mode is 'live':
    //   Execute flash loan arbitrage
    // Else:
    //   Log opportunity for analysis
  }
}

// Main entry point
async function main() {
  const bot = new ArbitrageBot();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => bot.stop());
  process.on('SIGTERM', () => bot.stop());
  
  await bot.start();
}

main().catch(console.error);
```

### 11. TESTING

#### test/unit/
- Test each service in isolation
- Mock external dependencies (Alchemy, GeckoTerminal)
- Test edge cases:
  * WebSocket disconnection
  * Invalid pool data
  * Gas price spikes
  * Reorg handling

#### test/integration/
- Test full arbitrage flow on Hardhat fork
- Use Hardhat's mainnet forking feature
- Simulate real scenarios:
  * Deploy flash loan contract
  * Create price discrepancy
  * Execute arbitrage
  * Verify profit
- Test failure scenarios:
  * Insufficient liquidity
  * Price moves before execution
  * Transaction reverts

### 12. SCRIPTS

#### scripts/deploy-contract.ts
- Deploy FlashLoanArbitrage contract to Base
- Use Hardhat deployment script
- Verify on BaseScan
- Save contract address to config

#### scripts/discover-pools.ts
- Run pool discovery independently
- Output top pools to console
- Save to database for inspection
- Useful for initial setup

#### scripts/test-opportunity.ts
- Manually test opportunity detection
- Input: two DEXs, token pair
- Output: Calculated profit
- Useful for debugging

#### scripts/simulate-trade.ts
- Simulate arbitrage on Tenderly or Hardhat fork
- Test without spending real money
- Verify profit calculations

### 13. ENVIRONMENT & DEPENDENCIES

#### package.json dependencies:
```json
{
  "dependencies": {
    "ethers": "^6.9.0",
    "ws": "^8.14.0",
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "better-sqlite3": "^9.2.0",
    "winston": "^3.11.0",
    "dotenv": "^16.3.1",
    "joi": "^17.11.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/express": "^4.17.21",
    "@types/better-sqlite3": "^7.6.8",
    "typescript": "^5.3.0",
    "hardhat": "^2.19.0",
    "@nomicfoundation/hardhat-toolbox": "^4.0.0",
    "ts-node": "^10.9.1",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.8",
    "eslint": "^8.55.0",
    "prettier": "^3.1.0"
  }
}
```

#### .env.example:
```
# Alchemy
ALCHEMY_API_KEY=your_alchemy_key_here

# Wallet
PRIVATE_KEY=your_private_key_here

# Contract
FLASH_LOAN_CONTRACT_ADDRESS=

# Bot Configuration
MIN_PROFIT_USD=10
MAX_GAS_PRICE_GWEI=5
EXECUTION_MODE=dry-run
LOG_LEVEL=info

# Database
DATABASE_PATH=./data/arbitrage.db

# API
API_PORT=3000
API_KEY=secure_random_key_here
```

### 14. DOCUMENTATION

#### README.md
Include:
- Project overview and goals
- Architecture diagram
- Setup instructions (npm install, .env config)
- How to run (npm start)
- How to test (npm test)
- Safety warnings about private keys
- Link to DEPLOYMENT.md

#### DEPLOYMENT.md
Include:
- Deploying flash loan contract
- Funding the contract with ETH
- Running in testnet vs mainnet
- Monitoring and maintenance
- Common issues and troubleshooting

## IMPLEMENTATION ORDER

Build in this sequence:

1. Project setup (package.json, tsconfig, folder structure)
2. Configuration files (chains, dexes, tokens, environment)
3. RPC connection (AlchemyProvider, BlockListener)
4. Pool discovery (GeckoTerminal, PoolAnalyzer)
5. Price monitoring (PoolSubscriber, PriceMonitor)
6. Arbitrage detection (OpportunityDetector, ProfitCalculator)
7. Database setup (SQLite, models)
8. Logging utility (Logger)
9. Flash loan contract (Solidity)
10. Flash loan executor (TypeScript)
11. Transaction execution (TransactionBuilder, Sender)
12. API server
13. Main bot orchestrator
14. Testing suite
15. Scripts
16. Documentation

## CRITICAL REQUIREMENTS

✅ Use TypeScript strict mode
✅ Implement comprehensive error handling
✅ Add detailed logging at every step
✅ Include inline comments explaining complex logic
✅ Use async/await properly (no callback hell)
✅ Implement connection recovery for WebSocket
✅ Never expose private keys in logs
✅ Validate all user inputs and external data
✅ Use BigInt for all token amounts (avoid precision loss)
✅ Implement rate limiting for API calls
✅ Add health checks for all services
✅ Make execution mode configurable (dry-run vs live)
✅ Include safety checks before executing trades
✅ Log ALL opportunities (even unprofitable ones) for analysis
✅ Implement graceful shutdown
✅ Add proper TypeScript types (no 'any' unless absolutely necessary)

## SUCCESS CRITERIA

The bot should be able to:
1. ✅ Connect to Base blockchain via Alchemy
2. ✅ Discover top DEX pools automatically
3. ✅ Monitor prices in real-time (<500ms latency)
4. ✅ Detect arbitrage opportunities accurately
5. ✅ Calculate profit after ALL costs
6. ✅ Execute flash loan trades (in live mode)
7. ✅ Handle errors and reconnect automatically
8. ✅ Provide API for monitoring
9. ✅ Log everything to database
10. ✅ Run 24/7 without crashing

## ADDITIONAL NOTES

- Start with DRY-RUN mode only
- Test extensively on Base Sepolia testnet first
- Use small amounts on mainnet initially ($10-50)
- Monitor closely for first 24 hours
- Be prepared for competition (most opportunities will be taken by faster bots)
- Focus on learning and optimization
- Consider this educational - profitable arbitrage is extremely difficult

Build this entire project now. Create all files with complete implementations. Do not use placeholders or TODOs - implement everything fully. The code should be production-ready and able to run immediately after npm install.
```

---

## HOW TO USE THIS PROMPT

1. **Copy the entire prompt above** (everything in the code block)

2. **Run Claude Code:**
   ```bash
   # Navigate to your projects folder
   cd ~/projects
   
   # Run Claude Code with the prompt
   claude-code "paste the entire prompt here"
   ```

3. **Claude Code will:**
   - Create the entire project structure
   - Implement all TypeScript files
   - Write the Solidity contract
   - Set up configuration files
   - Create tests
   - Write documentation
   - Set up package.json with all dependencies

4. **After Claude Code finishes:**
   ```bash
   cd base-arbitrage-bot
   npm install
   cp .env.example .env
   # Edit .env with your Alchemy API key
   npm run build
   npm start
   ```

## WHAT YOU'LL GET

A complete, production-ready arbitrage bot with:
- 🔥 Real-time WebSocket monitoring
- 💰 Flash loan execution capability
- 📊 API dashboard
- 💾 SQLite database logging
- 🧪 Full test suite
- 📝 Comprehensive documentation
- 🛡️ Error handling and recovery
- 🎯 Dry-run and live modes

## ESTIMATED BUILD TIME

Claude Code should complete this in approximately 10-15 minutes, creating 40+ files with full implementations.

## NEXT STEPS AFTER BUILD

1. Set up Alchemy account and get API key
2. Deploy flash loan contract to Base Sepolia testnet
3. Run in dry-run mode for 24 hours to see opportunities
4. Analyze data to optimize parameters
5. Test execution on testnet with test tokens
6. Carefully test on mainnet with small amounts
7. Monitor and iterate

## IMPORTANT SAFETY REMINDERS

⚠️ Never commit private keys to git
⚠️ Start with testnet (Base Sepolia)
⚠️ Use dry-run mode extensively
⚠️ Test with small amounts on mainnet
⚠️ Monitor gas prices carefully
⚠️ Understand you're competing with professional bots
⚠️ Consider this primarily educational

---

Good luck! This is a comprehensive, professional-grade arbitrage bot that will teach you everything about DeFi, smart contracts, and algorithmic trading.
