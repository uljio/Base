import sqlite from '../src/database/sqlite';

async function main() {
  await sqlite.initialize();

  const pools = sqlite.prepare('SELECT id, token0, token1, reserve0, reserve1 FROM pools LIMIT 20').all();
  console.log('Pools in database:', pools.length);
  pools.forEach((p: any) => {
    console.log(`  ${p.id}`);
    console.log(`    token0: ${p.token0}`);
    console.log(`    token1: ${p.token1}`);
    console.log(`    reserves: ${p.reserve0}, ${p.reserve1}`);
  });

  // Check for token pairs
  const tokens = new Set();
  pools.forEach((p: any) => {
    tokens.add(p.token0);
    tokens.add(p.token1);
  });
  console.log(`\nUnique tokens: ${tokens.size}`);

  // Check for pools between same token pairs
  const tokenPairs = new Map();
  pools.forEach((p: any) => {
    const pair = `${p.token0}|${p.token1}`;
    if (!tokenPairs.has(pair)) {
      tokenPairs.set(pair, []);
    }
    tokenPairs.get(pair).push(p.id);
  });

  console.log(`\nToken pairs with multiple pools:`);
  let multiPoolCount = 0;
  tokenPairs.forEach((poolIds, pair) => {
    if (poolIds.length > 1) {
      console.log(`  ${pair}: ${poolIds.length} pools`);
      multiPoolCount++;
    }
  });

  if (multiPoolCount === 0) {
    console.log('  None - each token pair has only 1 pool (no direct arbitrage possible)');
  }

  sqlite.close();
}

main().catch(console.error);
