import { Router, Request, Response } from 'express';
import { logger } from '../../services/utils/Logger';
import { Opportunity, OpportunityData } from '../../database/models/Opportunity';
import sqlite from '../../database/sqlite';

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
  constructor() {}

  /**
   * GET /api/opportunities
   * Returns list of current arbitrage opportunities from database
   */
  async getOpportunities(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Fetching arbitrage opportunities from database');

      // Optional query parameters for filtering
      const minProfit = req.query.minProfit ? parseFloat(req.query.minProfit as string) : 0;
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

      // Build SQL query dynamically
      let query = 'SELECT * FROM opportunities WHERE 1=1';
      const params: any[] = [];

      if (minProfit > 0) {
        query += ' AND profit_usd >= ?';
        params.push(minProfit);
      }

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const stmt = sqlite.prepare(query);
      const opportunities = stmt.all(...params) as OpportunityData[];

      const response = {
        success: true,
        data: {
          count: opportunities.length,
          opportunities,
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
   * GET /api/opportunities/:id
   * Get a single opportunity by ID
   */
  async getOpportunityById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const opportunity = await Opportunity.findById(id);

      if (!opportunity) {
        res.status(404).json({
          success: false,
          error: 'Opportunity not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: opportunity,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get opportunity: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * POST /api/opportunities
   * Create a new opportunity manually
   */
  async createOpportunity(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body;

      // Validate required fields
      if (!data.chain_id || !data.token_in || !data.token_out || !data.amount_in) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: chain_id, token_in, token_out, amount_in',
        });
        return;
      }

      // Set defaults
      const opportunityData: Omit<OpportunityData, 'id' | 'created_at' | 'updated_at'> = {
        chain_id: data.chain_id,
        token_in: data.token_in,
        token_out: data.token_out,
        amount_in: data.amount_in,
        amount_out_predicted: data.amount_out_predicted || '0',
        profit_usd: data.profit_usd || 0,
        profit_percentage: data.profit_percentage || 0,
        route: data.route || JSON.stringify([]),
        status: data.status || 'pending',
        expires_at: data.expires_at || Date.now() + 60000, // 1 minute default
      };

      const opportunity = await Opportunity.create(opportunityData);

      res.status(201).json({
        success: true,
        data: opportunity,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to create opportunity: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * PUT /api/opportunities/:id
   * Update an opportunity
   */
  async updateOpportunity(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { status, profit_usd, profit_percentage } = req.body;

      // Check if opportunity exists
      const existing = await Opportunity.findById(id);
      if (!existing) {
        res.status(404).json({
          success: false,
          error: 'Opportunity not found',
        });
        return;
      }

      // Update status if provided
      if (status) {
        const executedAt = status === 'executed' ? Date.now() : undefined;
        await Opportunity.updateStatus(id, status, executedAt);
      }

      // Update profit if provided
      if (profit_usd !== undefined && profit_percentage !== undefined) {
        await Opportunity.updateProfit(id, profit_usd, profit_percentage);
      }

      const updated = await Opportunity.findById(id);

      res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to update opportunity: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * DELETE /api/opportunities/:id
   * Delete an opportunity
   */
  async deleteOpportunity(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const deleted = await Opportunity.delete(id);

      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Opportunity not found',
        });
        return;
      }

      res.status(200).json({
        success: true,
        message: 'Opportunity deleted successfully',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to delete opportunity: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * GET /api/opportunities/export/csv
   * Export opportunities as CSV
   */
  async exportCSV(req: Request, res: Response): Promise<void> {
    try {
      logger.info('Exporting opportunities to CSV');

      // Get filter parameters
      const minProfit = req.query.minProfit ? parseFloat(req.query.minProfit as string) : 0;
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 1000;

      // Build SQL query
      let query = 'SELECT * FROM opportunities WHERE 1=1';
      const params: any[] = [];

      if (minProfit > 0) {
        query += ' AND profit_usd >= ?';
        params.push(minProfit);
      }

      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const stmt = sqlite.prepare(query);
      const opportunities = stmt.all(...params) as OpportunityData[];

      // Generate CSV
      const headers = [
        'ID',
        'Chain ID',
        'Token In',
        'Token Out',
        'Amount In',
        'Amount Out (Predicted)',
        'Profit USD',
        'Profit %',
        'Route',
        'Status',
        'Created At',
        'Expires At',
        'Executed At',
      ];

      const csvRows = [headers.join(',')];

      for (const opp of opportunities) {
        const row = [
          opp.id || '',
          opp.chain_id.toString(),
          opp.token_in,
          opp.token_out,
          opp.amount_in,
          opp.amount_out_predicted,
          opp.profit_usd.toString(),
          opp.profit_percentage.toString(),
          `"${opp.route.replace(/"/g, '""')}"`, // Escape quotes in JSON
          opp.status || 'pending',
          new Date(opp.created_at || 0).toISOString(),
          new Date(opp.expires_at).toISOString(),
          opp.executed_at ? new Date(opp.executed_at).toISOString() : '',
        ];
        csvRows.push(row.join(','));
      }

      const csv = csvRows.join('\n');

      // Set headers for file download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="opportunities_${Date.now()}.csv"`);
      res.status(200).send(csv);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to export CSV: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * GET /api/opportunities/stats
   * Get opportunity statistics
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await Opportunity.getStats();

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to get stats: ${errorMessage}`);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
}

// Create a singleton instance
const opportunitiesController = new OpportunitiesController();

const router = Router();

/**
 * GET /api/opportunities/export/csv - Must be before /:id route
 */
router.get('/export/csv', (req: Request, res: Response) => {
  opportunitiesController.exportCSV(req, res);
});

/**
 * GET /api/opportunities/stats
 */
router.get('/stats', (req: Request, res: Response) => {
  opportunitiesController.getStats(req, res);
});

/**
 * GET /api/opportunities
 */
router.get('/', (req: Request, res: Response) => {
  opportunitiesController.getOpportunities(req, res);
});

/**
 * GET /api/opportunities/:id
 */
router.get('/:id', (req: Request, res: Response) => {
  opportunitiesController.getOpportunityById(req, res);
});

/**
 * POST /api/opportunities
 */
router.post('/', (req: Request, res: Response) => {
  opportunitiesController.createOpportunity(req, res);
});

/**
 * PUT /api/opportunities/:id
 */
router.put('/:id', (req: Request, res: Response) => {
  opportunitiesController.updateOpportunity(req, res);
});

/**
 * DELETE /api/opportunities/:id
 */
router.delete('/:id', (req: Request, res: Response) => {
  opportunitiesController.deleteOpportunity(req, res);
});

export default router;
export { opportunitiesController };
