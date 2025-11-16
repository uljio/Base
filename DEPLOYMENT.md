# Deployment Guide

Complete guide for deploying and running the Base Chain DEX Arbitrage Bot.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Testing on Base Sepolia](#testing-on-base-sepolia)
4. [Deploying to Base Mainnet](#deploying-to-base-mainnet)
5. [Running the Bot](#running-the-bot)
6. [Monitoring and Maintenance](#monitoring-and-maintenance)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Accounts and Services

1. **Alchemy Account**
   - Sign up at https://alchemy.com
   - Create a Base Mainnet app
   - Create a Base Sepolia app (for testing)
   - Get API keys for both

2. **Base Wallet**
   - Create a new wallet (DO NOT use your main wallet)
   - Export the private key
   - Fund with ETH for gas

3. **BaseScan Account** (Optional but recommended)
   - Sign up at https://basescan.org
   - Get API key for contract verification

### System Requirements

- Linux/Mac/Windows with WSL
- Node.js >= 18.0.0
- At least 1GB RAM
- Stable internet connection
- SSD storage recommended

## Initial Setup

### 1. Install Dependencies

```bash
# Clone repository
git clone <repository-url>
cd base-arbitrage-bot

# Install Node.js dependencies
npm install

# Build TypeScript
npm run build
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Alchemy Configuration
ALCHEMY_API_KEY=<your-alchemy-api-key>

# Wallet (keep this secure!)
PRIVATE_KEY=<your-private-key>

# Network (start with testnet)
NETWORK=base-sepolia

# Bot Configuration
MIN_PROFIT_USD=5
MAX_GAS_PRICE_GWEI=10
EXECUTION_MODE=dry-run
LOG_LEVEL=debug

# Database
DATABASE_PATH=./data/arbitrage.db

# API
API_PORT=3000
API_KEY=<generate-random-key>
```

### 3. Verify Setup

```bash
# Test configuration
npm run build

# Discover pools (should work even without contract)
npm run discover
```

## Testing on Base Sepolia

Always test on testnet before mainnet!

### 1. Get Testnet ETH

Get Base Sepolia ETH from:
- [Alchemy Base Faucet](https://www.alchemy.com/faucets/base-sepolia)
- Bridge from Sepolia ETH: https://bridge.base.org

You'll need at least 0.1 ETH for deployment and testing.

### 2. Deploy Contract to Testnet

```bash
# Ensure .env has NETWORK=base-sepolia
npm run deploy
```

Expected output:
```
Deploying FlashLoanArbitrage contract...
Network: Base Sepolia
Chain ID: 84532
Deployer address: 0x...
Deployer balance: 0.1 ETH

✅ FlashLoanArbitrage deployed to: 0x...
Explorer: https://sepolia.basescan.org/address/0x...
```

**Save the contract address!**

### 3. Update .env with Contract Address

```env
FLASH_LOAN_CONTRACT_ADDRESS=<deployed-address>
```

### 4. Fund the Contract

Send some ETH to the contract for gas:

```bash
# Using cast (foundry)
cast send <contract-address> --value 0.01ether --private-key $PRIVATE_KEY --rpc-url https://sepolia.base.org
```

Or use MetaMask to send 0.01 ETH to the contract address.

### 5. Run in Dry-Run Mode

```bash
npm start
```

Monitor the logs:
- Should connect to Base Sepolia
- Discover pools
- Subscribe to swap events
- Detect opportunities (logged but not executed)

Let it run for at least 1 hour to verify stability.

### 6. Test Flash Loan Execution

⚠️ This will execute a real transaction on testnet!

```bash
# In .env, change:
EXECUTION_MODE=live

# Restart bot
npm start
```

Monitor for successful arbitrage executions. On testnet, liquidity is lower so opportunities may be rare.

## Deploying to Base Mainnet

⚠️ **DANGER ZONE**: Real money at risk!

### 1. Prepare Mainnet Wallet

1. Create a **new** wallet (never reuse your main wallet)
2. Fund with ETH:
   - At least 0.05 ETH for contract deployment
   - Additional 0.1-0.5 ETH for trading capital
   - Keep extra ETH for gas

### 2. Update Configuration

```env
# Change network
NETWORK=base-mainnet

# Increase safety thresholds
MIN_PROFIT_USD=20
MAX_GAS_PRICE_GWEI=5
MAX_SLIPPAGE_PERCENT=0.5
MAX_POSITION_SIZE_USD=500

# Start in dry-run
EXECUTION_MODE=dry-run

# Reduce logging
LOG_LEVEL=info
```

### 3. Deploy to Mainnet

```bash
npm run deploy
```

⚠️ This costs real ETH!

**Verify the deployment:**
1. Check contract on BaseScan
2. Verify source code if API key is set
3. Test contract functions manually

### 4. Fund the Contract

Send initial trading capital:

```bash
# Start small - 0.05 ETH recommended
cast send <contract-address> --value 0.05ether --private-key $PRIVATE_KEY --rpc-url https://mainnet.base.org
```

### 5. Dry-Run on Mainnet

**CRITICAL**: Run in dry-run mode for 24-48 hours first!

```bash
EXECUTION_MODE=dry-run npm start
```

Monitor:
- Are opportunities being detected?
- Are profit calculations accurate?
- Are gas estimates reasonable?
- Is the bot stable?

Check logs in `logs/opportunities.log` for detected trades.

### 6. Enable Live Trading

⚠️ **FINAL WARNING**: You can lose money!

Only proceed if:
- [ ] Dry-run has been stable for 48+ hours
- [ ] You've reviewed the code thoroughly
- [ ] You understand all risks
- [ ] You're using a separate wallet
- [ ] You're starting with small amounts

```env
EXECUTION_MODE=live
```

```bash
npm start
```

## Running the Bot

### Production Deployment

For 24/7 operation, use a process manager:

#### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start bot
pm2 start dist/bot.js --name arbitrage-bot

# View logs
pm2 logs arbitrage-bot

# Monitor
pm2 monit

# Auto-restart on reboot
pm2 startup
pm2 save
```

#### Using systemd (Linux)

Create `/etc/systemd/system/arbitrage-bot.service`:

```ini
[Unit]
Description=Base Arbitrage Bot
After=network.target

[Service]
Type=simple
User=<your-user>
WorkingDirectory=/path/to/base-arbitrage-bot
ExecStart=/usr/bin/node dist/bot.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/arbitrage-bot.log
StandardError=append:/var/log/arbitrage-bot-error.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable arbitrage-bot
sudo systemctl start arbitrage-bot
sudo systemctl status arbitrage-bot
```

### Running on VPS

Recommended VPS specs:
- 2 vCPUs
- 2GB RAM
- 20GB SSD
- Stable network connection

Providers:
- DigitalOcean
- AWS EC2
- Google Cloud
- Linode

## Monitoring and Maintenance

### Monitoring Tools

1. **Logs**

```bash
# Real-time logs
tail -f logs/combined.log

# Opportunities
tail -f logs/opportunities.log

# Errors only
tail -f logs/error.log
```

2. **API Endpoints**

```bash
# Bot status
curl http://localhost:3000/status

# Recent opportunities
curl http://localhost:3000/opportunities?limit=10

# Current configuration
curl http://localhost:3000/config
```

3. **Database Queries**

```bash
# Install sqlite3
npm install -g sqlite3

# Query opportunities
sqlite3 data/arbitrage.db "SELECT * FROM opportunities ORDER BY timestamp DESC LIMIT 10;"

# Query executions
sqlite3 data/arbitrage.db "SELECT * FROM executions ORDER BY timestamp DESC LIMIT 10;"
```

### Daily Maintenance

1. **Check Logs**
   - Review error logs daily
   - Verify bot is detecting opportunities
   - Check for any anomalies

2. **Monitor Profitability**
   - Review successful trades
   - Calculate actual vs expected profit
   - Adjust MIN_PROFIT_USD if needed

3. **Update Pools**
   - Pool discovery runs every hour automatically
   - Manually refresh if needed:

```bash
# In code, call:
await geckoTerminal.clearCache();
```

4. **Check Gas Prices**
   - Monitor Base gas prices
   - Adjust MAX_GAS_PRICE_GWEI if needed

5. **Verify Contract Balance**

```bash
# Check contract ETH balance
cast balance <contract-address> --rpc-url https://mainnet.base.org

# Withdraw profits
cast send <contract-address> "withdrawETH()" --private-key $PRIVATE_KEY --rpc-url https://mainnet.base.org
```

### Weekly Maintenance

1. **Update Dependencies**

```bash
npm outdated
npm update
npm audit
```

2. **Backup Database**

```bash
cp data/arbitrage.db backups/arbitrage-$(date +%Y%m%d).db
```

3. **Review Performance**
   - Analyze logged opportunities
   - Check success rate
   - Optimize parameters

4. **Rotate Logs**

```bash
# Archive old logs
gzip logs/combined.log
mv logs/combined.log.gz archives/
```

## Troubleshooting

### Bot Won't Start

**Error**: `Environment validation failed`

- Check `.env` file for missing variables
- Ensure ALCHEMY_API_KEY is set
- Verify NETWORK is valid

**Error**: `Provider not connected`

- Check internet connection
- Verify Alchemy API key is correct
- Check Alchemy dashboard for rate limits

### No Opportunities Detected

This is normal! Reasons:
- High competition from other bots
- Low market volatility
- Liquidity fragmentation
- Your MIN_PROFIT_USD is too high

Try:
- Lower MIN_PROFIT_USD (carefully!)
- Monitor more pools
- Check during high-volume periods

### Transactions Failing

**Reason**: "Insufficient funds to repay flash loan"

- Price moved before execution (frontrun)
- Calculation error
- Slippage exceeded

**Reason**: "Transaction underpriced"

- Gas price too low
- Network congestion
- Increase MAX_GAS_PRICE_GWEI

**Reason**: "Nonce too low"

- Transaction conflict
- Bot will auto-retry

### High Gas Usage

- Reduce MAX_POOLS_TO_MONITOR
- Optimize trade routes
- Wait for lower gas prices

### WebSocket Disconnections

- Normal - bot auto-reconnects
- Check Alchemy status
- Consider upgrading Alchemy plan

## Security Best Practices

1. **Private Key Security**
   - Never commit to git
   - Use environment variables
   - Consider hardware wallet integration

2. **Server Security**
   - Use firewall
   - Disable unused ports
   - Keep system updated
   - Use SSH keys, not passwords

3. **API Security**
   - Set strong API_KEY
   - Use HTTPS (nginx reverse proxy)
   - Implement rate limiting

4. **Monitoring**
   - Set up alerts for errors
   - Monitor wallet balance
   - Track unusual activity

## Performance Optimization

1. **Network Latency**
   - Use VPS close to Alchemy servers
   - Consider dedicated node

2. **Database**
   - Regularly VACUUM database
   - Archive old records

3. **Memory Usage**
   - Restart bot weekly
   - Monitor with `htop`

4. **Code Optimization**
   - Profile critical paths
   - Reduce unnecessary calculations

## Scaling

To increase profitability:

1. **Monitor More Pairs**
   - Increase MAX_POOLS_TO_MONITOR
   - Add more tokens to config

2. **Reduce Latency**
   - Use dedicated node
   - Optimize code paths

3. **Increase Capital**
   - Fund contract with more ETH
   - Enable larger trades

4. **Multi-Chain**
   - Deploy to other chains
   - Share infrastructure

---

## Emergency Procedures

### Stop the Bot Immediately

```bash
# If using PM2
pm2 stop arbitrage-bot

# If using systemd
sudo systemctl stop arbitrage-bot

# If running in terminal
Ctrl+C
```

### Withdraw All Funds

```bash
# Withdraw ETH
cast send <contract-address> "withdrawETH()" --private-key $PRIVATE_KEY --rpc-url https://mainnet.base.org

# Withdraw specific token
cast send <contract-address> "withdrawToken(address)" <token-address> --private-key $PRIVATE_KEY --rpc-url https://mainnet.base.org
```

### Contract Issues

If contract is behaving unexpectedly:
1. Stop the bot immediately
2. Withdraw all funds
3. Do NOT redeploy without identifying issue
4. Review all transactions on BaseScan
5. Seek help if needed

---

**Final Reminder**: Arbitrage trading is highly competitive and risky. This bot is educational. Most users will not profit. Trade responsibly and never risk more than you can afford to lose.
