/**
 * Structured logging service using Winston
 */

import winston from 'winston';
import { getConfig } from '../../config/environment';
import path from 'path';
import fs from 'fs';

const config = getConfig();

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Custom log format with colors for console
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = '\n' + JSON.stringify(meta, null, 2);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

/**
 * JSON format for file logging
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

/**
 * Logger instance
 */
export const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat,
    }),

    // Info and above to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      level: 'info',
    }),

    // Errors to error.log
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      format: fileFormat,
      level: 'error',
    }),

    // Opportunities to separate file for analysis
    new winston.transports.File({
      filename: path.join(logsDir, 'opportunities.log'),
      format: fileFormat,
      level: 'info',
    }),
  ],
});

/**
 * Log opportunity detection
 */
export function logOpportunity(
  opportunity: any,
  profitable: boolean = false
): void {
  const level = profitable ? 'info' : 'debug';
  logger.log(level, 'Arbitrage opportunity detected', {
    type: 'opportunity',
    profitable,
    ...opportunity,
  });
}

/**
 * Log transaction execution
 */
export function logTransaction(
  txHash: string,
  status: string,
  details: any
): void {
  logger.info('Transaction status update', {
    type: 'transaction',
    txHash,
    status,
    ...details,
  });
}

/**
 * Log price update
 */
export function logPriceUpdate(
  dex: string,
  token0: string,
  token1: string,
  price: string,
  blockNumber: number
): void {
  logger.debug('Price update', {
    type: 'price',
    dex,
    token0,
    token1,
    price,
    blockNumber,
  });
}

/**
 * Log service startup
 */
export function logServiceStart(serviceName: string, config?: any): void {
  logger.info(`${serviceName} started`, {
    type: 'service',
    service: serviceName,
    config,
  });
}

/**
 * Log service error
 */
export function logServiceError(
  serviceName: string,
  error: Error,
  context?: any
): void {
  logger.error(`${serviceName} error`, {
    type: 'error',
    service: serviceName,
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

/**
 * Log block processing
 */
export function logBlock(blockNumber: number, processingTime?: number): void {
  logger.debug('Block processed', {
    type: 'block',
    blockNumber,
    processingTime,
  });
}

export default logger;
