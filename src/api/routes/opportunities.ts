import { Router, Request, Response } from 'express';
import { logger } from '../../services/utils/Logger';

export interface ArbitrageOpportunity {
  id: string;
  token: string;
  dexA: string;
  dexB: string;
  priceA: string;
  priceB: string;
  profitPercentage: number;
  estimatedProfit: string;
  liquidity: string;
  timestamp: string;
  estimatedGasPrice?: string;
}

class OpportunitiesController {
  // logger imported from utils
  private opportunities: ArbitrageOpportunity[] = [];

  constructor() {
}

  /**
   * GET /api/opportunities
   * Returns list of current arbitrage opportunities
   */
  async getOpportunities(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Fetching arbitrage opportunities');

      // Optional query parameters for filtering
      const minProfit = req.query.minProfit ? parseFloat(req.query.minProfit as string) : 0;
      const token = req.query.token ? (req.query.token as string).toLowerCase() : null;

      // Filter opportunities
      let filtered = this.opportunities;

      if (minProfit > 0) {
        filtered = filtered.filter((opp) => opp.profitPercentage >= minProfit);
      }

      if (token) {
        filtered = filtered.filter((opp) => opp.token.toLowerCase() === token);
      }

      const response = {
        success: true,
        data: {
          count: filtered.length,
          opportunities: filtered,
          timestamp: new Date().toISOString(),
        },
      };

      res.status(200).json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get opportunities: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Add an opportunity
   */
  addOpportunity(opportunity: ArbitrageOpportunity): void {
    this.opportunities.push(opportunity);
    logger.debug(`Added opportunity: ${opportunity.id}`);
  }

  /**
   * Clear all opportunities
   */
  clearOpportunities(): void {
    this.opportunities = [];
    logger.debug('Cleared all opportunities');
  }

  /**
   * Get all opportunities
   */
  getAllOpportunities(): ArbitrageOpportunity[] {
    return this.opportunities;
  }

  /**
   * Get opportunities count
   */
  getCount(): number {
    return this.opportunities.length;
  }

  /**
   * Remove opportunity by id
   */
  removeOpportunity(id: string): boolean {
    const index = this.opportunities.findIndex((opp) => opp.id === id);
    if (index !== -1) {
      this.opportunities.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Filter opportunities by profit percentage
   */
  filterByProfit(minProfit: number): ArbitrageOpportunity[] {
    return this.opportunities.filter((opp) => opp.profitPercentage >= minProfit);
  }

  /**
   * Filter opportunities by token
   */
  filterByToken(token: string): ArbitrageOpportunity[] {
    return this.opportunities.filter((opp) => opp.token.toLowerCase() === token.toLowerCase());
  }
}

// Create a singleton instance
const opportunitiesController = new OpportunitiesController();

const router = Router();

/**
 * GET /api/opportunities
 */
router.get('/', (req: Request, res: Response) => {
  opportunitiesController.getOpportunities(req, res);
});

export default router;
export { opportunitiesController };
