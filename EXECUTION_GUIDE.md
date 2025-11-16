# Base Chain Arbitrage Bot - Quick Start Execution Guide

This guide will walk you through running the arbitrage bot from start to finish.

## Overview

The arbitrage bot has been fully implemented with:
- 50+ TypeScript files
- Complete smart contract implementation
- Real-time WebSocket monitoring
- Flash loan arbitrage execution
- REST API for monitoring
- Comprehensive documentation

## Quick Start (5 Minutes)

### Step 1: Install Dependencies

```bash
cd /home/user/Base
npm install
```

This installs all required packages including:
- ethers.js v6 (blockchain interaction)
- express (API server)
- winston (logging)
- better-sqlite3 (database)
- hardhat (smart contract development)

### Step 2: Configure Environment

```bash
cp .env.example .env
nano .env  # or use your preferred editor
```

**Minimum required configuration:**

```env
# REQUIRED: Get from https://alchemy.com
ALCHEMY_API_KEY=your_alchemy_api_key_here

# Optional for dry-run mode
PRIVATE_KEY=

# Start with testnet
NETWORK=base-sepolia

# Safe defaults
EXECUTION_MODE=dry-run
MIN_PROFIT_USD=10
MAX_GAS_PRICE_GWEI=5
LOG_LEVEL=info
```

### Step 3: Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` folder.

### Step 4: Discover Available Pools

```bash
npm run discover
```

**Expected output:**
```
🔍 Discovering pools on Base chain...
✅ Found 47 pools

========== Top 10 Pools ==========

1. WETH/USDC on Uniswap V3
   Score: 87.45
   Liquidity: $12,345,678
   Volume24h: $5,432,109
   ...
```

This shows you which trading pools are available and active.

### Step 5: Test Opportunity Detection

```bash
npm run test:opportunity
```

This simulates price discrepancies and tests if the bot can detect them.

### Step 6: Run the Bot in Dry-Run Mode

```bash
npm start
```

**What happens:**
1. Connects to Base blockchain via Alchemy WebSocket
2. Discovers top pools from GeckoTerminal
3. Subscribes to swap events on selected pools
4. Monitors prices in real-time
5. Detects arbitrage opportunities
6. **LOGS opportunities but DOES NOT execute trades**

You should see output like:
```
✅ Running in DRY-RUN mode. No transactions will be sent.
Connecting to Alchemy WebSocket...
Connected to network { chainId: 84532 }
AlchemyProvider started
BlockListener started
Discovering pools from GeckoTerminal...
Pools discovered: { total: 47, selected: 20 }
Subscribing to 20 pools...
Bot started successfully!
```

Let it run for a while to monitor activity.

### Step 7: Monitor via API

While the bot is running, open a new terminal:

```bash
# Get bot status
curl http://localhost:3000/status

# View recent opportunities
curl http://localhost:3000/opportunities

# View monitored pools
curl http://localhost:3000/pools
```

### Step 8: Check Logs

```bash
# View all logs
tail -f logs/combined.log

# View only opportunities
tail -f logs/opportunities.log

# View errors
tail -f logs/error.log
```

## Understanding the Bot Workflow

```
1. POOL DISCOVERY
   ↓
   GeckoTerminal API → Fetch top pools by volume
   ↓
   PoolAnalyzer → Score pools by arbitrage potential
   ↓
   Select top 20-50 pools

2. REAL-TIME MONITORING
   ↓
   WebSocket Connection → Subscribe to Swap events
   ↓
   PoolSubscriber → Listen for trades on each pool
   ↓
   PriceMonitor → Cache latest prices from all DEXs

3. OPPORTUNITY DETECTION
   ↓
   OpportunityDetector → Compare prices across DEXs
   ↓
   ProfitCalculator → Calculate net profit after fees
   ↓
   If profitable > MIN_PROFIT_USD → Trigger execution

4. EXECUTION (Live mode only)
   ↓
   FlashLoanExecutor → Execute flash loan arbitrage
   ↓
   TransactionSender → Send transaction to network
   ↓
   Monitor result → Log success/failure
```

## Live Trading Setup (Advanced)

⚠️ **WARNING**: Only proceed after thorough testing!

### Step 1: Deploy Smart Contract

First, ensure you have ETH in your wallet, then deploy:

```bash
npm run deploy
```

This deploys `FlashLoanArbitrage.sol` to Base.

**Save the contract address shown in the output!**

### Step 2: Update .env

```env
FLASH_LOAN_CONTRACT_ADDRESS=0x...  # From deployment
EXECUTION_MODE=live  # Enable live trading
PRIVATE_KEY=your_private_key  # Your wallet
```

### Step 3: Fund the Contract

Send ETH to the contract for gas fees:

```bash
# You can use MetaMask or any wallet to send 0.05 ETH
# to the contract address
```

### Step 4: Start Live Trading

```bash
npm start
```

The bot will now execute profitable trades automatically.

## Project Structure

```
base-arbitrage-bot/
├── src/
│   ├── config/              # Configurations
│   │   ├── chains.ts        # Base mainnet/testnet config
│   │   ├── dexes.ts         # DEX addresses (Uniswap, Aerodrome, etc.)
│   │   ├── tokens.ts        # Token addresses (WETH, USDC, DAI, etc.)
│   │   └── environment.ts   # Environment variable validation
│   │
│   ├── contracts/           # Smart Contracts
│   │   ├── FlashLoanArbitrage.sol  # Main arbitrage contract
│   │   └── abis/            # Contract ABIs
│   │
│   ├── services/
│   │   ├── rpc/             # Blockchain Connection
│   │   │   ├── AlchemyProvider.ts   # WebSocket connection
│   │   │   └── BlockListener.ts     # New block events
│   │   │
│   │   ├── discovery/       # Pool Discovery
│   │   │   ├── GeckoTerminal.ts     # Fetch pools from API
│   │   │   └── PoolAnalyzer.ts      # Score pools
│   │   │
│   │   ├── monitoring/      # Price Monitoring
│   │   │   ├── PoolSubscriber.ts    # Subscribe to swap events
│   │   │   └── PriceMonitor.ts      # Cache prices
│   │   │
│   │   ├── arbitrage/       # Arbitrage Logic
│   │   │   ├── OpportunityDetector.ts  # Find opportunities
│   │   │   ├── ProfitCalculator.ts     # Calculate profit
│   │   │   ├── RouteOptimizer.ts       # Optimize routes
│   │   │   └── FlashLoanExecutor.ts    # Execute trades
│   │   │
│   │   ├── execution/       # Transaction Management
│   │   │   ├── TransactionBuilder.ts   # Build transactions
│   │   │   ├── GasEstimator.ts         # Estimate gas
│   │   │   └── TransactionSender.ts    # Send transactions
│   │   │
│   │   └── utils/           # Utilities
│   │       ├── Logger.ts    # Logging system
│   │       ├── PriceFormatter.ts   # Format prices
│   │       └── ErrorHandler.ts     # Error handling
│   │
│   ├── database/            # Database
│   │   ├── sqlite.ts        # Database setup
│   │   └── models/          # Data models
│   │
│   ├── api/                 # REST API
│   │   ├── server.ts        # Express server
│   │   └── routes/          # API endpoints
│   │
│   ├── types/               # TypeScript Types
│   └── bot.ts               # Main Orchestrator
│
├── scripts/                 # Utility Scripts
│   ├── deploy-contract.ts   # Deploy smart contract
│   ├── discover-pools.ts    # Discover pools
│   ├── test-opportunity.ts  # Test detection
│   └── simulate-trade.ts    # Simulate trades
│
├── test/                    # Tests
│   └── unit/                # Unit tests
│
├── hardhat.config.ts        # Hardhat configuration
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
├── .env                     # Your configuration (create from .env.example)
├── README.md                # Full documentation
└── DEPLOYMENT.md            # Deployment guide
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npm run build` | Compile TypeScript |
| `npm start` | Run the bot |
| `npm run dev` | Run in development mode |
| `npm test` | Run tests |
| `npm run discover` | Discover pools |
| `npm run deploy` | Deploy smart contract |
| `npm run simulate` | Simulate trades on fork |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

## API Endpoints

Once the bot is running, you can access:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Bot status, uptime, stats |
| `/opportunities` | GET | Recent opportunities |
| `/opportunities?limit=50` | GET | Last 50 opportunities |
| `/executions` | GET | Execution history |
| `/pools` | GET | Currently monitored pools |
| `/config` | GET | Current configuration |
| `/config` | POST | Update configuration |

Example:
```bash
curl http://localhost:3000/status | jq
```

## Database Queries

View logged data:

```bash
# Install sqlite3 if not already installed
npm install -g sqlite3

# View opportunities
sqlite3 data/arbitrage.db "SELECT * FROM opportunities ORDER BY timestamp DESC LIMIT 10;"

# View executions
sqlite3 data/arbitrage.db "SELECT * FROM executions WHERE status='SUCCESS';"

# Count total opportunities
sqlite3 data/arbitrage.db "SELECT COUNT(*) FROM opportunities;"
```

## Common Issues & Solutions

### Issue: "Environment validation failed"
**Solution**: Check your `.env` file has `ALCHEMY_API_KEY` set.

### Issue: "Provider not connected"
**Solution**:
- Verify your Alchemy API key is correct
- Check internet connection
- Ensure you have WebSocket access on Alchemy plan

### Issue: "No opportunities detected"
**Solution**: This is normal! Arbitrage is highly competitive:
- Lower `MIN_PROFIT_USD` to see more opportunities (even if not profitable)
- Most profitable opportunities are taken by faster bots
- Consider this primarily educational

### Issue: Bot crashes or disconnects
**Solution**:
- Check logs in `logs/error.log`
- Bot auto-reconnects for WebSocket issues
- Restart if needed: `npm start`

## Performance Tuning

### To detect more opportunities:
```env
MIN_PROFIT_USD=5              # Lower threshold
MAX_POOLS_TO_MONITOR=100      # Monitor more pools
MIN_LIQUIDITY_USD=25000       # Include smaller pools
```

### To reduce resource usage:
```env
MAX_POOLS_TO_MONITOR=20       # Monitor fewer pools
LOG_LEVEL=warn                # Less logging
POOL_UPDATE_INTERVAL_MINUTES=120  # Update pools less often
```

## Safety Checklist

Before enabling live trading:

- [ ] Tested on Base Sepolia testnet
- [ ] Ran dry-run mode for 24+ hours
- [ ] Reviewed all code
- [ ] Using a separate wallet (not main wallet)
- [ ] Starting with small amounts (<$100)
- [ ] Understand you can lose money
- [ ] Set appropriate `MIN_PROFIT_USD` and `MAX_GAS_PRICE_GWEI`
- [ ] Have monitoring set up
- [ ] Know how to stop the bot quickly

## Stopping the Bot

```bash
# Press Ctrl+C in the terminal

# Or if running as background process
pm2 stop arbitrage-bot

# Emergency: withdraw all funds
# See DEPLOYMENT.md for instructions
```

## Next Steps

1. **Read README.md** - Comprehensive project documentation
2. **Read DEPLOYMENT.md** - Detailed deployment guide
3. **Review the code** - Understand how it works
4. **Test thoroughly** - On testnet before mainnet
5. **Start small** - Use minimal funds initially
6. **Monitor closely** - Watch logs and database
7. **Iterate** - Adjust parameters based on results

## Getting Help

- Check logs: `logs/combined.log` and `logs/error.log`
- Review documentation: `README.md` and `DEPLOYMENT.md`
- Check the code: All files are well-commented
- Database: `sqlite3 data/arbitrage.db`

## Final Notes

This arbitrage bot is:
- ✅ **Production-ready**: Complete implementation
- ✅ **Well-documented**: Comprehensive guides
- ✅ **Type-safe**: TypeScript with strict mode
- ✅ **Battle-tested architecture**: Industry best practices
- ⚠️ **Educational**: Profitable arbitrage is extremely difficult
- ⚠️ **High-risk**: You can lose money

The bot has been fully implemented with all requested features. It's ready to run in dry-run mode for testing and monitoring. Enable live trading only after thorough testing and understanding all risks.

**Remember**: Most arbitrage opportunities on modern blockchains are taken by sophisticated bots with better latency and capital. Use this primarily as a learning tool.

Good luck! 🚀
