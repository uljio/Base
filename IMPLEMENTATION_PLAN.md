# Arbitrage Bot Optimization Implementation Plan

## 📋 Project Context

**Branch**: `claude/test-arbitrage-detection-01EYQrro3j62nVF687sCseGq`
**Repository**: https://github.com/uljio/Base
**Objective**: Optimize pool discovery and profit calculation for $50 flashloan arbitrage on Base mainnet

---

## 🎯 Approved Strategy: OPTION 2 (Aggressive-Safe)

### Configuration Summary
- **Scan Frequency**: Every 60 seconds
- **Pages per Scan**: 25 pages
- **API Calls per Scan**: 25 calls to GeckoTerminal
- **API Utilization**: 83% (25 of 30 calls/minute)
- **Buffer**: 5 calls for retries/errors
- **Flashloan Size**: $50 USD
- **Minimum Net Profit**: $1.00 USD
- **Arbitrage Hops**: 2 hops (standard), 4 hops if highly profitable (>$5)

### Expected Results per Scan
- **Pools Fetched**: 500-750
- **Unique Tokens**: 120-180
- **Opportunities Detected**: 50-120
- **Profitable (>$1 net)**: 12-30
- **Scans per Hour**: 60

---

## 📊 Current State Analysis

### Issues Identified
1. **Limited Pool Discovery**: Only fetching page 1 (19 pools) from GeckoTerminal
2. **Inaccurate Profit Calculation**:
   - Hard-coded 1 token input instead of $50 USD
   - No real slippage calculation using pool reserves
   - Assumes fake token prices ($100)
   - Missing flashloan fee (0.09%)
3. **Database Connection Bottleneck**: Max 5 connections causing "Reached max connections" warnings
4. **High Liquidity Filter**: $50k might be too high for $50 trades (should be $25k)
5. **No Reserve Data**: Pools saved with reserve0='0', reserve1='0'

### GeckoTerminal API Details
- **Rate Limit**: 30 calls/minute (free tier)
- **Pool Refresh**: ~30 seconds
- **Current Implementation**: RateLimiter with 30 tokens, 0.5 refill/sec ✅
- **Retry Logic**: 3 attempts with exponential backoff ✅

---

## 🏗️ Implementation Phases

### Phase 1: Infrastructure & Configuration (30 min)
**Files to Modify:**
- `src/config/environment.ts`
- `src/database/sqlite.ts`
- `.env.example`

**Changes:**
1. Add new environment variables
2. Update database connection pool (5 → 15)
3. Update validation schema

### Phase 2: Multi-Page Pool Discovery (45 min)
**Files to Modify:**
- `src/services/discovery/GeckoTerminal.ts`

**New Files:**
- `src/services/discovery/PoolScorer.ts`

**Changes:**
1. Implement multi-page fetching (25 pages)
2. Add multiple sort strategies (volume, liquidity, tx_count)
3. Implement deduplication logic
4. Add pool scoring system
5. Add base token prioritization

### Phase 3: Accurate Profit Calculation (60 min)
**New Files:**
- `src/services/arbitrage/SwapCalculator.ts`
- `src/services/blockchain/ReserveFetcher.ts`

**Files to Modify:**
- `src/services/arbitrage/ProfitCalculator.ts`
- `src/services/arbitrage/OpportunityDetector.ts`
- `src/database/models/Pool.ts`

**Changes:**
1. Implement constant product formula (Uniswap V2/V3)
2. Add blockchain reserve fetching
3. Update profit calculation for $50 trades
4. Add price impact calculation
5. Account for all fees (DEX + flashloan + gas)

### Phase 4: Database & Model Updates (30 min)
**Files to Modify:**
- `src/database/models/Pool.ts`
- `src/database/migrations/`

**Changes:**
1. Add reserve fields to Pool model
2. Add last_reserve_update timestamp
3. Update pool upsert logic
4. Batch insert optimization

### Phase 5: Testing & Validation (30 min)
**Files to Test:**
- `scripts/test-opportunity.ts`
- `scripts/discover-pools.ts`

---

## 📝 Detailed File Changes

### 1. Environment Configuration

**File**: `src/config/environment.ts`

**Add to schema (line 78)**:
```typescript
// Flash Loan Configuration
FLASH_LOAN_SIZE_USD: Joi.number().min(1).default(50),
MIN_NET_PROFIT_USD: Joi.number().min(0).default(1.00),

// Pool Discovery (Updated)
MIN_LIQUIDITY_USD: Joi.number().min(0).default(25000), // Changed from 50000
MAX_POOLS_TO_MONITOR: Joi.number().min(1).max(1000).default(750), // Changed from 50
POOL_UPDATE_INTERVAL_SECONDS: Joi.number().min(1).default(60), // New: was MINUTES
GECKO_PAGES_TO_FETCH: Joi.number().min(1).max(30).default(25), // New

// Token Filtering
MIN_TOKEN_POOL_COUNT: Joi.number().min(1).default(2), // New
PRIORITIZE_BASE_TOKENS: Joi.boolean().default(true), // New

// Profit Calculation
DEX_FEE_PERCENTAGE: Joi.number().min(0).max(100).default(0.3), // New
FLASHLOAN_FEE_PERCENTAGE: Joi.number().min(0).max(100).default(0.09), // New
ESTIMATED_GAS_COST_USD: Joi.number().min(0).default(0.30), // New

// Arbitrage Path
MAX_HOPS_STANDARD: Joi.number().min(1).max(10).default(2), // New
MAX_HOPS_HIGH_PROFIT: Joi.number().min(1).max(10).default(4), // New
HIGH_PROFIT_THRESHOLD_USD: Joi.number().min(0).default(5.00), // New
```

**Add to EnvironmentConfig interface (line 126)**:
```typescript
// Flash Loan Configuration
FLASH_LOAN_SIZE_USD: number;
MIN_NET_PROFIT_USD: number;

// Pool Discovery
POOL_UPDATE_INTERVAL_SECONDS: number;
GECKO_PAGES_TO_FETCH: number;

// Token Filtering
MIN_TOKEN_POOL_COUNT: number;
PRIORITIZE_BASE_TOKENS: boolean;

// Profit Calculation
DEX_FEE_PERCENTAGE: number;
FLASHLOAN_FEE_PERCENTAGE: number;
ESTIMATED_GAS_COST_USD: number;

// Arbitrage Path
MAX_HOPS_STANDARD: number;
MAX_HOPS_HIGH_PROFIT: number;
HIGH_PROFIT_THRESHOLD_USD: number;
```

---

### 2. Database Configuration

**File**: `src/database/sqlite.ts`

**Find database configuration** (search for `max:` or connection pool settings)

**Update to**:
```typescript
max: 15,  // Increased from 5
min: 3,   // Increased from 2
idle: 10000,
acquire: 30000,
evict: 1000,
```

---

### 3. Multi-Page GeckoTerminal Discovery

**File**: `src/services/discovery/GeckoTerminal.ts`

**Key Changes**:

1. **Update constructor** (around line 65):
```typescript
constructor(config?: {
  MIN_LIQUIDITY_USD?: number;
  MAX_POOLS_TO_MONITOR?: number;
  ACCEPT_ALL_TOKENS?: boolean;
  GECKO_PAGES_TO_FETCH?: number;
}) {
  this.config = {
    MIN_LIQUIDITY_USD: config?.MIN_LIQUIDITY_USD ?? 25000,
    MAX_POOLS_TO_MONITOR: config?.MAX_POOLS_TO_MONITOR ?? 750,
    ACCEPT_ALL_TOKENS: config?.ACCEPT_ALL_TOKENS ?? true,
    GECKO_PAGES_TO_FETCH: config?.GECKO_PAGES_TO_FETCH ?? 25,
  };
  // ... rest of constructor
}
```

2. **Add new method** `fetchMultiplePages()`:
```typescript
private async fetchMultiplePages(
  pageCount: number
): Promise<GeckoPoolData[]> {
  const allPools: GeckoPoolData[] = new Map();

  // Strategy 1: High volume (pages 1-15)
  const volumePages = Math.min(15, pageCount);
  for (let page = 1; page <= volumePages; page++) {
    await this.rateLimiter.acquire();
    const pools = await this.fetchPage(page, 'h24_volume_usd_desc');
    pools.forEach(pool => allPools.set(pool.id, pool));
  }

  // Strategy 2: High liquidity (pages 1-7)
  const liquidityPages = Math.min(7, pageCount - volumePages);
  if (liquidityPages > 0) {
    for (let page = 1; page <= liquidityPages; page++) {
      await this.rateLimiter.acquire();
      const pools = await this.fetchPage(page, 'liquidity_usd_desc');
      pools.forEach(pool => allPools.set(pool.id, pool));
    }
  }

  // Strategy 3: High tx count (pages 1-3)
  const txPages = Math.min(3, pageCount - volumePages - liquidityPages);
  if (txPages > 0) {
    for (let page = 1; page <= txPages; page++) {
      await this.rateLimiter.acquire();
      const pools = await this.fetchPage(page, 'h24_tx_count_desc');
      pools.forEach(pool => allPools.set(pool.id, pool));
    }
  }

  return Array.from(allPools.values());
}

private async fetchPage(
  page: number,
  sort: string
): Promise<GeckoPoolData[]> {
  try {
    const response = await withRetry(
      async () => {
        const res = await this.client.get<GeckoResponse>(
          '/networks/base/pools',
          {
            params: { sort, page },
          }
        );
        return this.parsePools(res.data);
      },
      { maxAttempts: 3, delayMs: 2000 },
      'GeckoTerminal API request'
    );

    logger.debug(`Fetched page ${page} with sort=${sort}`, {
      count: response.length
    });

    return response;
  } catch (error) {
    logger.warn(`Failed to fetch page ${page}: ${error}`);
    return [];
  }
}
```

3. **Update `discoverPools()` method** (around line 79):
```typescript
public async discoverPools(): Promise<PoolInfo[]> {
  try {
    const cacheKey = 'base-pools';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug('Returning cached pools', { count: cached.data.length });
      return cached.data;
    }

    logger.info('Discovering pools from GeckoTerminal...');

    // Fetch multiple pages
    const rawPools = await this.fetchMultiplePages(
      this.config.GECKO_PAGES_TO_FETCH
    );

    logger.info(`Fetched ${rawPools.length} pools from ${this.config.GECKO_PAGES_TO_FETCH} pages`);

    // Convert to PoolInfo
    const pools = await Promise.all(
      rawPools.map(pool => this.convertToPoolInfo(pool))
    );

    // Filter by minimum liquidity
    const filteredPools = pools
      .filter(p => p !== null)
      .filter(pool => pool.liquidityUSD >= this.config.MIN_LIQUIDITY_USD);

    // Build token connectivity map
    const tokenConnectivity = this.buildTokenConnectivity(filteredPools);

    // Score pools
    const scoredPools = filteredPools.map(pool => ({
      pool,
      score: this.scorePool(pool, tokenConnectivity)
    }));

    // Sort by score and take top N
    const topPools = scoredPools
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.MAX_POOLS_TO_MONITOR)
      .map(sp => sp.pool);

    logger.info('Pools discovered', {
      total: rawPools.length,
      filtered: filteredPools.length,
      selected: topPools.length,
    });

    // Cache results
    this.cache.set(cacheKey, { data: topPools, timestamp: Date.now() });

    return topPools;
  } catch (error) {
    logServiceError('GeckoTerminal', error as Error);
    throw error;
  }
}
```

4. **Add helper methods**:
```typescript
private buildTokenConnectivity(pools: PoolInfo[]): Map<string, number> {
  const connectivity = new Map<string, number>();

  pools.forEach(pool => {
    const token0 = pool.token0.address.toLowerCase();
    const token1 = pool.token1.address.toLowerCase();

    connectivity.set(token0, (connectivity.get(token0) || 0) + 1);
    connectivity.set(token1, (connectivity.get(token1) || 0) + 1);
  });

  return connectivity;
}

private scorePool(
  pool: PoolInfo,
  tokenConnectivity: Map<string, number>
): number {
  const BASE_TOKENS = [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', // cbBTC
  ];

  let score = 0;

  // 1. Liquidity score (30 points)
  if (pool.liquidityUSD >= 500000) score += 30;
  else if (pool.liquidityUSD >= 100000) score += 25;
  else if (pool.liquidityUSD >= 50000) score += 20;
  else if (pool.liquidityUSD >= 25000) score += 15;

  // 2. Volume/Liquidity ratio (20 points)
  const ratio = pool.volume24hUSD / Math.max(pool.liquidityUSD, 1);
  if (ratio >= 0.5) score += 20;
  else if (ratio >= 0.1) score += 15;
  else if (ratio >= 0.05) score += 10;
  else score += 5;

  // 3. Token connectivity (30 points)
  const token0Conn = tokenConnectivity.get(pool.token0.address.toLowerCase()) || 0;
  const token1Conn = tokenConnectivity.get(pool.token1.address.toLowerCase()) || 0;
  const avgConn = (token0Conn + token1Conn) / 2;
  score += Math.min(30, avgConn * 3);

  // 4. Base token bonus (20 points)
  const hasBaseToken = BASE_TOKENS.some(
    base => base.toLowerCase() === pool.token0.address.toLowerCase() ||
            base.toLowerCase() === pool.token1.address.toLowerCase()
  );
  if (hasBaseToken) score += 20;

  return score;
}
```

---

### 4. Swap Calculator (NEW FILE)

**File**: `src/services/arbitrage/SwapCalculator.ts`

```typescript
'use strict';

import { logger } from '../utils/Logger';

/**
 * Swap Calculator Service
 * Calculates swap outputs using constant product formula (Uniswap V2/V3)
 */
export interface SwapHop {
  reserveIn: bigint;
  reserveOut: bigint;
  fee: number; // Fee in percentage (e.g., 0.3 for 0.3%)
}

export class SwapCalculator {
  /**
   * Calculate swap output using constant product formula
   * Formula: amountOut = (reserveOut * amountIn * (10000 - fee)) / (reserveIn * 10000 + amountIn * (10000 - fee))
   */
  static calculateSwapOutput(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
    feePercent: number = 0.3
  ): bigint {
    try {
      if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
        return 0n;
      }

      // Convert fee percentage to basis points (0.3% = 30 bps)
      const feeBps = BigInt(Math.floor(feePercent * 100));
      const amountInWithFee = amountIn * (10000n - feeBps);

      const numerator = amountInWithFee * reserveOut;
      const denominator = (reserveIn * 10000n) + amountInWithFee;

      return numerator / denominator;
    } catch (error) {
      logger.error(`Failed to calculate swap output: ${error}`);
      return 0n;
    }
  }

  /**
   * Calculate price impact percentage
   */
  static calculatePriceImpact(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint
  ): number {
    try {
      if (reserveIn <= 0n || reserveOut <= 0n) {
        return 100; // 100% impact if no reserves
      }

      // Spot price before swap
      const spotPrice = Number(reserveOut * BigInt(1e8) / reserveIn) / 1e8;

      // Amount out with 0 fee to get execution price
      const amountOut = this.calculateSwapOutput(amountIn, reserveIn, reserveOut, 0);
      if (amountOut === 0n) return 100;

      const executionPrice = Number(amountOut * BigInt(1e8) / amountIn) / 1e8;

      // Price impact = (spotPrice - executionPrice) / spotPrice * 100
      return ((spotPrice - executionPrice) / spotPrice) * 100;
    } catch (error) {
      logger.error(`Failed to calculate price impact: ${error}`);
      return 100;
    }
  }

  /**
   * Calculate output through multiple swap hops
   */
  static calculateMultiHopOutput(
    amountIn: bigint,
    path: SwapHop[]
  ): bigint {
    try {
      let currentAmount = amountIn;

      for (const hop of path) {
        currentAmount = this.calculateSwapOutput(
          currentAmount,
          hop.reserveIn,
          hop.reserveOut,
          hop.fee
        );

        if (currentAmount === 0n) {
          return 0n;
        }
      }

      return currentAmount;
    } catch (error) {
      logger.error(`Failed to calculate multi-hop output: ${error}`);
      return 0n;
    }
  }

  /**
   * Calculate total price impact across path
   */
  static calculatePathPriceImpact(
    amountIn: bigint,
    path: SwapHop[]
  ): number {
    try {
      let totalImpact = 0;
      let currentAmount = amountIn;

      for (const hop of path) {
        const impact = this.calculatePriceImpact(
          currentAmount,
          hop.reserveIn,
          hop.reserveOut
        );
        totalImpact += impact;

        currentAmount = this.calculateSwapOutput(
          currentAmount,
          hop.reserveIn,
          hop.reserveOut,
          hop.fee
        );

        if (currentAmount === 0n) break;
      }

      return totalImpact;
    } catch (error) {
      logger.error(`Failed to calculate path price impact: ${error}`);
      return 100;
    }
  }
}

export default SwapCalculator;
```

---

### 5. Reserve Fetcher (NEW FILE)

**File**: `src/services/blockchain/ReserveFetcher.ts`

```typescript
'use strict';

import { ethers } from 'ethers';
import { logger } from '../utils/Logger';

const UNISWAP_V2_PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

export interface PoolReserves {
  reserve0: string;
  reserve1: string;
  timestamp: number;
}

export class ReserveFetcher {
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  /**
   * Fetch reserves for a single pool
   */
  async fetchReserves(poolAddress: string): Promise<PoolReserves | null> {
    try {
      const contract = new ethers.Contract(
        poolAddress,
        UNISWAP_V2_PAIR_ABI,
        this.provider
      );

      const [reserve0, reserve1, timestamp] = await contract.getReserves();

      return {
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        timestamp: Number(timestamp),
      };
    } catch (error) {
      logger.debug(`Failed to fetch reserves for ${poolAddress}: ${error}`);
      return null;
    }
  }

  /**
   * Batch fetch reserves for multiple pools
   * TODO: Implement multicall for efficiency
   */
  async batchFetchReserves(
    poolAddresses: string[]
  ): Promise<Map<string, PoolReserves>> {
    const results = new Map<string, PoolReserves>();

    // Fetch in parallel with concurrency limit
    const BATCH_SIZE = 10;
    for (let i = 0; i < poolAddresses.length; i += BATCH_SIZE) {
      const batch = poolAddresses.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (address) => {
        const reserves = await this.fetchReserves(address);
        if (reserves) {
          results.set(address.toLowerCase(), reserves);
        }
      });

      await Promise.all(promises);

      // Small delay to avoid RPC rate limits
      if (i + BATCH_SIZE < poolAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    logger.info(`Fetched reserves for ${results.size}/${poolAddresses.length} pools`);

    return results;
  }
}

export default ReserveFetcher;
```

---

### 6. Update OpportunityDetector

**File**: `src/services/arbitrage/OpportunityDetector.ts`

**Key Changes**:

1. **Update constructor** (line 36):
```typescript
constructor(
  chainId: number,
  minProfitUsd: number = 1.00,        // Changed default from 10
  minProfitPercentage: number = 0.1,
  opportunityTtlMs: number = 60000,
  tradeSizeUsd: number = 50,          // NEW
  maxHopsStandard: number = 2,        // NEW
  maxHopsHighProfit: number = 4,      // NEW
  highProfitThreshold: number = 5.00  // NEW
) {
  this.chainId = chainId;
  this.minProfitUsd = minProfitUsd;
  this.minProfitPercentage = minProfitPercentage;
  this.opportunityTtlMs = opportunityTtlMs;
  this.tradeSizeUsd = tradeSizeUsd;
  this.maxHopsStandard = maxHopsStandard;
  this.maxHopsHighProfit = maxHopsHighProfit;
  this.highProfitThreshold = highProfitThreshold;
}
```

2. **Update `findDirectArbitrage()` method** (line 123):
Replace lines 153-156 with:
```typescript
// Calculate potential profit using real reserves
const amountIn = BigInt(Math.floor(this.tradeSizeUsd * 1e18)); // Assume stablecoin (1:1 USD)

// Find best buy pool (lowest price) and sell pool (highest price)
const bestBuy = connectingPools.reduce((best, pool) => {
  const price = poolPrices.get(`${pool.id}`) || pool.price;
  const bestPrice = poolPrices.get(`${best.id}`) || best.price;
  return price < bestPrice ? pool : best;
});

const bestSell = connectingPools.reduce((best, pool) => {
  const price = poolPrices.get(`${pool.id}`) || pool.price;
  const bestPrice = poolPrices.get(`${best.id}`) || best.price;
  return price > bestPrice ? pool : best;
});

if (bestBuy.id === bestSell.id) {
  return null; // Same pool, no arbitrage
}

// Check if we have reserves
if (!bestBuy.reserve0 || !bestBuy.reserve1 || bestBuy.reserve0 === '0') {
  logger.debug('Missing reserves for pools, skipping');
  return null;
}

// Calculate swap output using SwapCalculator
// Note: This is simplified - needs proper reserve ordering
const reserveIn0 = BigInt(bestBuy.reserve0);
const reserveOut0 = BigInt(bestBuy.reserve1);
const amountOut = SwapCalculator.calculateSwapOutput(
  amountIn,
  reserveIn0,
  reserveOut0,
  0.3
);

const reserveIn1 = BigInt(bestSell.reserve1);
const reserveOut1 = BigInt(bestSell.reserve0);
const amountFinal = SwapCalculator.calculateSwapOutput(
  amountOut,
  reserveIn1,
  reserveOut1,
  0.3
);

// Calculate net profit
const grossProfit = amountFinal - amountIn;
const flashloanFee = amountIn * 9n / 10000n; // 0.09%
const gasCost = BigInt(Math.floor(0.30 * 1e18)); // $0.30
const netProfit = grossProfit - flashloanFee - gasCost;
const netProfitUsd = Number(netProfit) / 1e18;

if (netProfitUsd < this.minProfitUsd) {
  return null;
}

const profitPercentage = (Number(grossProfit) / Number(amountIn)) * 100;

return {
  tokenIn,
  tokenOut,
  amountIn: amountIn.toString(),
  amountOutPredicted: amountFinal.toString(),
  profitUsd: netProfitUsd,
  profitPercentage,
  route: {
    pools: [bestBuy.id, bestSell.id],
    tokenIn,
    tokenOut,
    amounts: [amountIn.toString(), amountOut.toString(), amountFinal.toString()],
    path: [tokenIn, tokenOut, tokenIn],
  },
  confidence: Math.min(1, Math.abs(profitPercentage) / 2),
};
```

---

### 7. Update Pool Model

**File**: `src/database/models/Pool.ts`

**Add to CREATE TABLE statement** (find the table creation):
```sql
last_reserve_update INTEGER,
price_impact_50usd REAL
```

**Update the Pool interface** to include:
```typescript
last_reserve_update?: number;
price_impact_50usd?: number;
```

---

### 8. Update .env.example

**File**: `.env.example`

Add:
```env
# === Flash Loan Configuration ===
FLASH_LOAN_SIZE_USD=50
MIN_NET_PROFIT_USD=1.00

# === Pool Discovery ===
MIN_LIQUIDITY_USD=25000
MAX_POOLS_TO_MONITOR=750
POOL_UPDATE_INTERVAL_SECONDS=60
GECKO_PAGES_TO_FETCH=25

# === Token Filtering ===
MIN_TOKEN_POOL_COUNT=2
PRIORITIZE_BASE_TOKENS=true

# === Profit Calculation ===
DEX_FEE_PERCENTAGE=0.3
FLASHLOAN_FEE_PERCENTAGE=0.09
ESTIMATED_GAS_COST_USD=0.30

# === Arbitrage Path ===
MAX_HOPS_STANDARD=2
MAX_HOPS_HIGH_PROFIT=4
HIGH_PROFIT_THRESHOLD_USD=5.00
```

---

## 🧪 Testing Plan

### 1. Unit Tests
```bash
# Test multi-page fetching
npm run test -- GeckoTerminal.test.ts

# Test swap calculations
npm run test -- SwapCalculator.test.ts

# Test profit calculations
npm run test -- ProfitCalculator.test.ts
```

### 2. Integration Test
```bash
npm run test:opportunity
```

**Expected Output**:
- Pools fetched: 400-700
- Unique tokens: 100-180
- Opportunities found: 10-50
- Profitable (>$1): 5-30

### 3. Validation Checklist
- [ ] GeckoTerminal fetches 25 pages
- [ ] No rate limit errors (check logs for 429)
- [ ] Database connections stay below 15
- [ ] Pools have non-zero reserves
- [ ] Profit calculations use $50 input
- [ ] Net profit accounts for all fees
- [ ] API calls stay at 25/minute

---

## 📊 Success Metrics

### Technical
- API utilization: 80-85% (25 calls/min)
- Pools per scan: 500-750
- Scan frequency: 60 seconds
- Database connections: <15
- No rate limit errors

### Business
- Opportunities detected: >20/scan
- Profitable opportunities (>$1): >10/scan
- Average net profit: $1-5
- Execution candidates: >3/scan

---

## 🔧 Troubleshooting

### Issue: Rate limit errors (429)
**Solution**: Reduce GECKO_PAGES_TO_FETCH from 25 to 20

### Issue: Database connection errors
**Solution**: Increase max connections in sqlite.ts

### Issue: No reserves fetched
**Solution**: Check RPC provider, implement retry logic

### Issue: No profitable opportunities
**Solution**:
- Lower MIN_NET_PROFIT_USD to 0.50
- Check pool reserves are non-zero
- Verify profit calculation logic

---

## 📦 Dependencies

### Required Packages
All already installed:
- `ethers` - For blockchain interactions
- `axios` - For API calls
- `dotenv` - For environment variables
- `joi` - For validation

### No New Dependencies Required

---

## 🚀 Deployment Steps

1. **Update .env file**:
```bash
cp .env.example .env
# Edit .env with new variables
```

2. **Run migration** (if database schema changed):
```bash
npm run migrate
```

3. **Test discovery**:
```bash
npm run test:opportunity
```

4. **Monitor logs**:
```bash
tail -f logs/arbitrage.log
```

5. **Commit and push**:
```bash
git add .
git commit -m "Optimize pool discovery and profit calculation for $50 flashloans"
git push -u origin claude/test-arbitrage-detection-01EYQrro3j62nVF687sCseGq
```

---

## 📝 Notes for Continuation

### Current Progress Tracker
- [ ] Phase 1: Infrastructure & Configuration
- [ ] Phase 2: Multi-Page Pool Discovery
- [ ] Phase 3: Accurate Profit Calculation
- [ ] Phase 4: Database & Model Updates
- [ ] Phase 5: Testing & Validation

### Key Files Modified (Check these first)
1. `src/config/environment.ts` - Configuration
2. `src/services/discovery/GeckoTerminal.ts` - Multi-page fetching
3. `src/services/arbitrage/SwapCalculator.ts` - NEW FILE
4. `src/services/blockchain/ReserveFetcher.ts` - NEW FILE
5. `src/services/arbitrage/OpportunityDetector.ts` - Profit calculation
6. `src/database/sqlite.ts` - Connection pool
7. `src/database/models/Pool.ts` - Reserve fields

### Quick Context Recovery
```bash
# Check current branch
git branch --show-current

# See recent changes
git status

# View implementation plan
cat IMPLEMENTATION_PLAN.md

# Test current state
npm run test:opportunity
```

---

**Document Created**: 2025-11-17
**Last Updated**: 2025-11-17
**Status**: Ready for implementation
**Approved Strategy**: Option 2 (25 pages, 60-second scans, 83% API utilization)
