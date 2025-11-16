/**
 * Unit tests for PriceMonitor
 */

import { PriceMonitor } from '../../src/services/monitoring/PriceMonitor';
import { SwapEvent } from '../../src/types/dex.types';

describe('PriceMonitor', () => {
  let priceMonitor: PriceMonitor;

  beforeEach(() => {
    priceMonitor = new PriceMonitor();
  });

  afterEach(() => {
    priceMonitor.clearCache();
  });

  const createMockSwapEvent = (dex: string, price: bigint): SwapEvent => ({
    poolAddress: '0x1234567890123456789012345678901234567890',
    dex,
    token0: '0xtoken0',
    token1: '0xtoken1',
    amount0: 1000000n,
    amount1: 2000000n,
    price,
    blockNumber: 12345,
    txHash: '0xabc123',
    timestamp: Date.now(),
  });

  describe('updatePrice', () => {
    it('should update price from swap event', () => {
      const swapEvent = createMockSwapEvent('Uniswap V3', 2000000000n);

      priceMonitor.updatePrice(swapEvent);

      const price = priceMonitor.getPrice('0xtoken0', '0xtoken1', 'Uniswap V3');

      expect(price).not.toBeNull();
      expect(price?.price).toBe(2000000000n);
      expect(price?.dex).toBe('Uniswap V3');
    });

    it('should handle multiple DEXs for same pair', () => {
      const event1 = createMockSwapEvent('Uniswap V3', 2000000000n);
      const event2 = createMockSwapEvent('Aerodrome', 2010000000n);

      priceMonitor.updatePrice(event1);
      priceMonitor.updatePrice(event2);

      const prices = priceMonitor.getAllPrices('0xtoken0', '0xtoken1');

      expect(prices.size).toBe(2);
      expect(prices.get('Uniswap V3')?.price).toBe(2000000000n);
      expect(prices.get('Aerodrome')?.price).toBe(2010000000n);
    });
  });

  describe('getPrice', () => {
    it('should return null for non-existent price', () => {
      const price = priceMonitor.getPrice('0xtoken0', '0xtoken1', 'Uniswap V3');

      expect(price).toBeNull();
    });

    it('should return price info', () => {
      const swapEvent = createMockSwapEvent('Uniswap V3', 2000000000n);
      priceMonitor.updatePrice(swapEvent);

      const price = priceMonitor.getPrice('0xtoken0', '0xtoken1', 'Uniswap V3');

      expect(price).not.toBeNull();
      expect(price?.price).toBe(2000000000n);
      expect(price?.blockNumber).toBe(12345);
    });
  });

  describe('getPriceSpread', () => {
    it('should return null when less than 2 prices', () => {
      const spread = priceMonitor.getPriceSpread('0xtoken0', '0xtoken1');

      expect(spread).toBeNull();
    });

    it('should calculate price spread correctly', () => {
      const event1 = createMockSwapEvent('Uniswap V3', 2000000000n);
      const event2 = createMockSwapEvent('Aerodrome', 2020000000n);

      priceMonitor.updatePrice(event1);
      priceMonitor.updatePrice(event2);

      const spread = priceMonitor.getPriceSpread('0xtoken0', '0xtoken1');

      expect(spread).not.toBeNull();
      expect(spread?.lowDex).toBe('Uniswap V3');
      expect(spread?.highDex).toBe('Aerodrome');
      expect(spread?.spreadPercent).toBeCloseTo(1.0, 1);
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      const event1 = createMockSwapEvent('Uniswap V3', 2000000000n);
      const event2 = createMockSwapEvent('Aerodrome', 2020000000n);

      priceMonitor.updatePrice(event1);
      priceMonitor.updatePrice(event2);

      const stats = priceMonitor.getStatistics();

      expect(stats.totalPairs).toBe(1);
      expect(stats.totalPrices).toBe(2);
    });
  });
});
