# Base Chain DEX Arbitrage Bot

A production-ready arbitrage bot for Base blockchain that monitors DEX prices in real-time and executes profitable arbitrage opportunities using Aave V3 flash loans.

## Features

- **Real-time Price Monitoring**: WebSocket-based monitoring of swap events across multiple DEXs
- **Flash Loan Arbitrage**: Executes arbitrage without requiring upfront capital using Aave V3
- **Multi-DEX Support**: Supports Uniswap V3, Aerodrome, BaseSwap, SwapBased, and SushiSwap
- **Automatic Pool Discovery**: Uses GeckoTerminal API to discover high-liquidity pools
- **Profit Calculation**: Accurate profit estimation accounting for all fees and gas costs
- **Dry-Run Mode**: Test opportunity detection without executing real transactions
- **REST API**: Monitor bot status and opportunities via HTTP endpoints
- **SQLite Database**: Logs all opportunities and executions for analysis
- **TypeScript**: Fully typed with strict mode enabled

## Architecture

```
┌─────────────────┐
│  GeckoTerminal  │  Discover top pools
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Pool Analyzer  │  Score pools by arbitrage potential
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Pool Subscriber │  Subscribe to Swap events via WebSocket
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Price Monitor  │  Cache prices from all DEXs
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Opportunity     │  Detect price discrepancies
│ Detector        │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Profit          │  Calculate net profit after costs
│ Calculator      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Flash Loan      │  Execute arbitrage via Aave V3
│ Executor        │
└─────────────────┘
```

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Alchemy API key
- Private key for execution (keep secure!)

## Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd base-arbitrage-bot
```

2. **Install dependencies**

```bash
npm install
```

3. **Configure environment**

```bash
cp .env.example .env
```

Edit `.env` and add your configuration:

```env
# Required
ALCHEMY_API_KEY=your_alchemy_api_key

# Required for live execution
PRIVATE_KEY=your_private_key_here

# Bot configuration
MIN_PROFIT_USD=10
MAX_GAS_PRICE_GWEI=5
EXECUTION_MODE=dry-run  # Change to 'live' for real trading
LOG_LEVEL=info

# Network
NETWORK=base-mainnet  # or base-sepolia for testnet
```

4. **Build the project**

```bash
npm run build
```

## Usage

### 1. Discover Pools

Before running the bot, discover available pools:

```bash
npm run discover
```

This will show top pools by liquidity and volume.

### 2. Test Opportunity Detection

Test the opportunity detection logic:

```bash
npm run test:opportunity
```

### 3. Run the Bot in Dry-Run Mode

Start monitoring for opportunities (no real transactions):

```bash
npm start
```

The bot will:
- Connect to Base via Alchemy WebSocket
- Discover top pools from GeckoTerminal
- Subscribe to swap events
- Monitor prices in real-time
- Detect arbitrage opportunities
- Log opportunities to database and console
- **NOT execute** any real transactions

### 4. Monitor via API

The bot exposes a REST API on port 3000 (configurable):

```bash
# Get bot status
curl http://localhost:3000/status

# Get recent opportunities
curl http://localhost:3000/opportunities

# Get monitored pools
curl http://localhost:3000/pools

# Get configuration
curl http://localhost:3000/config
```

### 5. Deploy Flash Loan Contract

Before enabling live mode, deploy the flash loan contract:

```bash
npm run deploy
```

This will:
- Deploy `FlashLoanArbitrage.sol` to Base
- Verify the contract on BaseScan (if API key provided)
- Save deployment info to `deployments/`

Update your `.env` with the contract address:

```env
FLASH_LOAN_CONTRACT_ADDRESS=0x...
```

### 6. Run in Live Mode

⚠️ **WARNING**: Only enable live mode after thorough testing!

1. Ensure contract is deployed and funded
2. Update `.env`:

```env
EXECUTION_MODE=live
```

3. Start the bot:

```bash
npm start
```

The bot will now execute profitable arbitrage opportunities automatically.

## Project Structure

```
base-arbitrage-bot/
├── src/
│   ├── config/              # Configuration files
│   │   ├── chains.ts        # Chain configurations
│   │   ├── dexes.ts         # DEX addresses and configs
│   │   ├── tokens.ts        # Token addresses
│   │   └── environment.ts   # Environment variables
│   ├── contracts/           # Smart contracts
│   │   ├── abis/            # Contract ABIs
│   │   └── FlashLoanArbitrage.sol
│   ├── services/            # Core services
│   │   ├── rpc/             # RPC providers
│   │   ├── discovery/       # Pool discovery
│   │   ├── monitoring/      # Price monitoring
│   │   ├── arbitrage/       # Opportunity detection
│   │   ├── execution/       # Transaction execution
│   │   └── utils/           # Utilities
│   ├── database/            # Database models
│   ├── api/                 # REST API
│   ├── types/               # TypeScript types
│   └── bot.ts               # Main orchestrator
├── scripts/                 # Utility scripts
├── test/                    # Test suite
├── hardhat.config.ts        # Hardhat configuration
├── package.json
└── README.md
```

## Development

### Run Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration
```

### Lint and Format

```bash
# Lint code
npm run lint

# Format code
npm run format
```

### Simulate Trades

Test flash loan execution on a local fork:

```bash
npm run simulate
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALCHEMY_API_KEY` | Alchemy API key | Required |
| `PRIVATE_KEY` | Wallet private key | Required for live |
| `FLASH_LOAN_CONTRACT_ADDRESS` | Deployed contract address | - |
| `MIN_PROFIT_USD` | Minimum profit threshold | 10 |
| `MAX_GAS_PRICE_GWEI` | Maximum gas price | 5 |
| `EXECUTION_MODE` | 'dry-run' or 'live' | dry-run |
| `LOG_LEVEL` | Logging level | info |
| `MIN_LIQUIDITY_USD` | Minimum pool liquidity | 50000 |
| `MAX_POOLS_TO_MONITOR` | Maximum pools to monitor | 50 |

### Supported DEXs

- **Uniswap V3**: Full support for concentrated liquidity
- **Aerodrome**: Major Base DEX, V2 style
- **BaseSwap**: V2 style DEX
- **SwapBased**: V2 style DEX
- **SushiSwap**: Both V2 and V3

### Supported Tokens

- WETH (Wrapped Ether)
- USDC (Native USD Coin)
- USDbC (Bridged USD Coin)
- DAI (Dai Stablecoin)
- cbETH (Coinbase Wrapped Staked ETH)
- USDT (Tether USD)

## Safety Features

- **Dry-run mode**: Test without risk
- **Minimum profit threshold**: Only execute profitable trades
- **Gas price limit**: Skip trades when gas is too expensive
- **Slippage protection**: Account for price impact
- **Circuit breaker**: Pause on repeated failures
- **Comprehensive logging**: Track all activities

## Logs and Database

Logs are stored in:
- `logs/combined.log` - All logs
- `logs/error.log` - Errors only
- `logs/opportunities.log` - Detected opportunities

Database:
- `data/arbitrage.db` - SQLite database with:
  - Opportunities table
  - Executions table
  - Pools table

## Troubleshooting

### WebSocket Connection Issues

If you see connection errors:
1. Check your Alchemy API key
2. Ensure you have WebSocket access
3. Check network connectivity

### No Opportunities Detected

This is normal! Arbitrage is highly competitive:
- Most opportunities are taken within milliseconds
- Competition from professional bots
- Consider this primarily educational

### Transaction Failures

Common reasons:
- Price moved before execution (frontrun)
- Insufficient liquidity
- Gas price too high
- Slippage exceeded

## Performance Tips

1. **Use WebSocket**: Much faster than HTTP polling
2. **Monitor fewer pools**: Focus on high-volume pairs
3. **Optimize gas**: Use appropriate gas limits
4. **Low latency RPC**: Consider dedicated node

## Security Warnings

⚠️ **CRITICAL SECURITY PRACTICES**:

1. **Never commit private keys** to version control
2. **Use separate wallet** for bot (not your main wallet)
3. **Start with small amounts** on mainnet
4. **Test thoroughly** on testnet first
5. **Monitor closely** when running live
6. **Understand the risks** - you can lose money

## Legal Disclaimer

This software is provided for **educational purposes only**. The authors are not responsible for any financial losses incurred while using this bot. Cryptocurrency trading and arbitrage involve significant risk. Only use funds you can afford to lose.

## License

MIT

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## Support

For issues and questions:
- Open a GitHub issue
- Check existing documentation
- Review the code comments

## Acknowledgments

- Built with ethers.js v6
- Uses Aave V3 flash loans
- Pool data from GeckoTerminal
- Inspired by the DeFi community

---

**Remember**: Profitable arbitrage is extremely difficult. This bot is primarily educational. Start with dry-run mode, test extensively, and understand all risks before trading real money.
