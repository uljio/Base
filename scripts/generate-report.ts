/**
 * Generate arbitrage test report from database
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

interface Pool {
  id: string;
  chain_id: number;
  token0: string;
  token1: string;
  reserve0: string | null;
  reserve1: string | null;
  liquidity: string;
  price: number;
  fee: number;
}

interface Opportunity {
  id: number;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out_predicted: string;
  profit_usd: number;
  profit_percentage: number;
  route: string;
  created_at: number;
}

async function generateReport() {
  const dbPath = path.join(__dirname, '../data/arbitrage.db');

  if (!fs.existsSync(dbPath)) {
    console.error('Database not found at:', dbPath);
    return;
  }

  const db = new Database(dbPath);

  // Get pool statistics
  const totalPools = db.prepare('SELECT COUNT(*) as count FROM pools').get() as { count: number };
  const poolsWithReserves = db.prepare(
    "SELECT COUNT(*) as count FROM pools WHERE reserve0 IS NOT NULL AND reserve0 != '0'"
  ).get() as { count: number };

  // Get all pools with reserves
  const pools = db.prepare(`
    SELECT * FROM pools
    WHERE reserve0 IS NOT NULL AND reserve0 != '0'
    ORDER BY CAST(liquidity AS REAL) DESC
    LIMIT 20
  `).all() as Pool[];

  // Get opportunities
  const opportunities = db.prepare(`
    SELECT * FROM opportunities
    ORDER BY profit_usd DESC
  `).all() as Opportunity[];

  // Generate report
  console.log('\n' + '='.repeat(80));
  console.log('📊 ENHANCED ARBITRAGE TEST REPORT');
  console.log('='.repeat(80));
  console.log(`Test Date: ${new Date().toISOString()}`);
  console.log(`Configuration: Enhanced with V3 Support + Increased Capital`);
  console.log('='.repeat(80));

  console.log('\n📈 POOL DISCOVERY RESULTS');
  console.log('-'.repeat(80));
  console.log(`Total Pools Discovered: ${totalPools.count}`);
  console.log(`Pools with Valid Reserves: ${poolsWithReserves.count} (${((poolsWithReserves.count / totalPools.count) * 100).toFixed(1)}%)`);
  console.log(`Improvement: ${poolsWithReserves.count} vs 18 (previous test)`);

  console.log('\n💰 ARBITRAGE OPPORTUNITIES');
  console.log('-'.repeat(80));
  console.log(`Total Opportunities Found: ${opportunities.length}`);

  if (opportunities.length > 0) {
    console.log('\n🎯 TOP OPPORTUNITIES:');
    opportunities.slice(0, 10).forEach((opp, idx) => {
      console.log(`\n${idx + 1}. Opportunity #${opp.id}`);
      console.log(`   Token In: ${opp.token_in}`);
      console.log(`   Token Out: ${opp.token_out}`);
      console.log(`   Amount In: ${opp.amount_in}`);
      console.log(`   Expected Out: ${opp.amount_out_predicted}`);
      console.log(`   Profit: $${opp.profit_usd.toFixed(4)} (${opp.profit_percentage.toFixed(2)}%)`);
      console.log(`   Route: ${opp.route}`);
      console.log(`   Found At: ${new Date(opp.created_at).toISOString()}`);
    });
  } else {
    console.log('❌ No profitable arbitrage opportunities found');
  }

  console.log('\n🏊 TOP 20 POOLS BY LIQUIDITY (WITH VALID RESERVES)');
  console.log('-'.repeat(80));
  pools.forEach((pool, idx) => {
    console.log(`\n${idx + 1}. Pool ID: ${pool.id}`);
    console.log(`   Token0: ${pool.token0}`);
    console.log(`   Token1: ${pool.token1}`);
    console.log(`   Reserve0: ${pool.reserve0}`);
    console.log(`   Reserve1: ${pool.reserve1}`);
    console.log(`   Liquidity: ${pool.liquidity}`);
    console.log(`   Price: ${pool.price}`);
    console.log(`   Fee: ${pool.fee} bps`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Pool Coverage: ${((poolsWithReserves.count / totalPools.count) * 100).toFixed(1)}%`);
  console.log(`Opportunities Found: ${opportunities.length}`);
  console.log(`V3 Support: ✅ Enabled`);
  console.log(`Flash Loan Size: $500 (increased from $50)`);
  console.log(`Min Profit Threshold: $0.10 (lowered from $0.50)`);
  console.log('='.repeat(80));

  db.close();
}

generateReport().catch(console.error);
