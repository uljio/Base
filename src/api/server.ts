import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { logger } from '../services/utils/Logger';

// Import routes
import statusRouter from './routes/status';
import opportunitiesRouter from './routes/opportunities';
import configRouter from './routes/config';

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigin?: string | string[];
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  host: '0.0.0.0',
  corsOrigin: '*',
  rateLimitWindowMs: 15 * 60 * 1000, // 15 minutes
  rateLimitMaxRequests: 100, // 100 requests per window
};

export class APIServer {
  private app: Express;
  // logger imported from utils
  private config: ServerConfig;
  private limiter: any;

  constructor(config: Partial<ServerConfig> = {}) {
    this.app = express();
this.config = { ...DEFAULT_CONFIG, ...config };

    // Configure rate limiter
    this.limiter = rateLimit({
      windowMs: this.config.rateLimitWindowMs,
      max: this.config.rateLimitMaxRequests,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Body parser middleware
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS middleware
    this.app.use(
      cors({
        origin: this.config.corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      })
    );

    // Rate limiting middleware
    this.app.use(this.limiter);

    // Request logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // API routes
    this.app.use('/api/status', statusRouter);
    this.app.use('/api/opportunities', opportunitiesRouter);
    this.app.use('/api/config', configRouter);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        path: req.path,
      });
    });
  }

  /**
   * Setup error handling middleware
   */
  private setupErrorHandling(): void {
    this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      logger.error(`Error: ${err.message}`);

      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal Server Error',
        statusCode: err.statusCode || 500,
      });
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.config.port, this.config.host, () => {
        logger.info(
          `Server running on http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    logger.info('Stopping server...');
  }

  /**
   * Get the Express app instance
   */
  getApp(): Express {
    return this.app;
  }
}
