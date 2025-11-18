/**
 * Curl-based RPC Provider
 * Workaround for ethers.js JsonRpcProvider connectivity issues in certain environments
 * Uses curl for HTTP requests which works reliably
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/Logger';
import { withRetry } from '../utils/ErrorHandler';

const execAsync = promisify(exec);

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: any[];
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class CurlRpcProvider {
  private rpcUrl: string;
  private requestId: number = 1;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
    logger.info('CurlRpcProvider initialized', { rpcUrl: this.maskApiKey(rpcUrl) });
  }

  /**
   * Mask API key in URL for logging
   */
  private maskApiKey(url: string): string {
    return url.replace(/\/v2\/[a-zA-Z0-9]+/, '/v2/***');
  }

  /**
   * Make a JSON-RPC call
   */
  async call(method: string, params: any[] = []): Promise<any> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: this.requestId++,
    };

    try {
      const response = await withRetry(
        async () => {
          // Escape the JSON payload for shell
          const payload = JSON.stringify(request).replace(/"/g, '\\"');

          // Use curl which works reliably in this environment
          const { stdout, stderr } = await execAsync(
            `curl -s -X POST "${this.rpcUrl}" ` +
            `-H "Content-Type: application/json" ` +
            `-H "Accept: application/json" ` +
            `--data "${payload}"`,
            { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer for large responses
          );

          if (stderr && !stdout) {
            throw new Error(`curl error: ${stderr}`);
          }

          const response: JsonRpcResponse = JSON.parse(stdout);

          if (response.error) {
            throw new Error(
              `RPC error ${response.error.code}: ${response.error.message}`
            );
          }

          return response.result;
        },
        {
          maxAttempts: 3,
          delayMs: 1000,
        },
        `RPC call: ${method}`
      );

      logger.debug(`RPC call successful: ${method}`, {
        params: params.slice(0, 2), // Log first 2 params only
      });

      return response;
    } catch (error) {
      logger.error(`RPC call failed: ${method}`, {
        error: (error as Error).message,
        params: params.slice(0, 2),
      });
      throw error;
    }
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const result = await this.call('eth_blockNumber', []);
    return parseInt(result, 16);
  }

  /**
   * Get balance of an address
   */
  async getBalance(address: string, blockTag: string = 'latest'): Promise<string> {
    return await this.call('eth_getBalance', [address, blockTag]);
  }

  /**
   * Get code at an address (to verify if it's a contract)
   */
  async getCode(address: string, blockTag: string = 'latest'): Promise<string> {
    return await this.call('eth_getCode', [address, blockTag]);
  }

  /**
   * Call a contract method (read-only)
   */
  async ethCall(
    to: string,
    data: string,
    blockTag: string = 'latest'
  ): Promise<string> {
    return await this.call('eth_call', [{ to, data }, blockTag]);
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<any> {
    return await this.call('eth_getTransactionReceipt', [txHash]);
  }

  /**
   * Get gas price
   */
  async getGasPrice(): Promise<string> {
    return await this.call('eth_gasPrice', []);
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(transaction: {
    from?: string;
    to: string;
    data?: string;
    value?: string;
  }): Promise<string> {
    return await this.call('eth_estimateGas', [transaction]);
  }

  /**
   * Get chain ID
   */
  async getChainId(): Promise<number> {
    const result = await this.call('eth_chainId', []);
    return parseInt(result, 16);
  }

  /**
   * Batch multiple RPC calls
   */
  async batchCall(calls: Array<{ method: string; params: any[] }>): Promise<any[]> {
    const requests: JsonRpcRequest[] = calls.map((call, index) => ({
      jsonrpc: '2.0',
      method: call.method,
      params: call.params,
      id: this.requestId + index,
    }));

    this.requestId += calls.length;

    try {
      const payload = JSON.stringify(requests).replace(/"/g, '\\"');

      const { stdout, stderr } = await execAsync(
        `curl -s -X POST "${this.rpcUrl}" ` +
        `-H "Content-Type: application/json" ` +
        `-H "Accept: application/json" ` +
        `--data "${payload}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      );

      if (stderr && !stdout) {
        throw new Error(`curl error: ${stderr}`);
      }

      const responses: JsonRpcResponse[] = JSON.parse(stdout);

      return responses.map((response) => {
        if (response.error) {
          throw new Error(
            `RPC error ${response.error.code}: ${response.error.message}`
          );
        }
        return response.result;
      });
    } catch (error) {
      logger.error('Batch RPC call failed', {
        error: (error as Error).message,
        callCount: calls.length,
      });
      throw error;
    }
  }
}
