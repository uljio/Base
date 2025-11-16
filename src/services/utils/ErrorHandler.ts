/**
 * Error handling and retry logic utilities
 */

import { logger } from './Logger';

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Execute function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  context: string = 'operation'
): Promise<T> {
  const {
    maxAttempts,
    delayMs,
    backoffMultiplier = 2,
    onRetry,
  } = config;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        logger.error(`${context} failed after ${maxAttempts} attempts`, {
          error: lastError.message,
          stack: lastError.stack,
        });
        throw lastError;
      }

      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);

      logger.warn(`${context} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms`, {
        error: lastError.message,
      });

      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: any): boolean {
  const networkErrorCodes = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'ECONNRESET',
    'NETWORK_ERROR',
  ];

  return (
    networkErrorCodes.includes(error.code) ||
    error.message?.toLowerCase().includes('network') ||
    error.message?.toLowerCase().includes('timeout')
  );
}

/**
 * Check if error is a rate limit error
 */
export function isRateLimitError(error: any): boolean {
  return (
    error.status === 429 ||
    error.message?.toLowerCase().includes('rate limit') ||
    error.message?.toLowerCase().includes('too many requests')
  );
}

/**
 * Check if error is recoverable
 */
export function isRecoverableError(error: any): boolean {
  return (
    isNetworkError(error) ||
    isRateLimitError(error) ||
    error.code === 'NONCE_EXPIRED' ||
    error.code === 'REPLACEMENT_UNDERPRICED'
  );
}

/**
 * Parse error message from various error types
 */
export function parseErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.reason) return error.reason;
  if (error.error?.message) return error.error.message;
  return 'Unknown error';
}

/**
 * Extract revert reason from transaction error
 */
export function extractRevertReason(error: any): string | null {
  const message = parseErrorMessage(error);

  // Try to extract reason from common patterns
  const patterns = [
    /reverted with reason string '(.+?)'/,
    /reverted with custom error '(.+?)'/,
    /execution reverted: (.+)/,
    /revert (.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Handle async errors in event handlers
 */
export function asyncErrorHandler(
  handler: (...args: any[]) => Promise<void>,
  context: string
): (...args: any[]) => void {
  return (...args: any[]) => {
    handler(...args).catch((error) => {
      logger.error(`Uncaught error in ${context}`, {
        error: parseErrorMessage(error),
        stack: error.stack,
      });
    });
  };
}

/**
 * Circuit breaker for failing operations
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(fn: () => Promise<T>, context: string): Promise<T> {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.timeout) {
        this.state = 'half-open';
        logger.info(`Circuit breaker entering half-open state for ${context}`);
      } else {
        throw new Error(`Circuit breaker is OPEN for ${context}`);
      }
    }

    try {
      const result = await fn();

      if (this.state === 'half-open') {
        this.reset();
        logger.info(`Circuit breaker closed for ${context}`);
      }

      return result;
    } catch (error) {
      this.recordFailure(context);
      throw error;
    }
  }

  private recordFailure(context: string): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
      logger.error(`Circuit breaker OPENED for ${context} after ${this.failures} failures`);
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Rate limiter
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(cost: number = 1): Promise<void> {
    this.refill();

    while (this.tokens < cost) {
      const waitTime = ((cost - this.tokens) / this.refillRate) * 1000;
      await sleep(waitTime);
      this.refill();
    }

    this.tokens -= cost;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}
