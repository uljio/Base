import { Contract, ContractTransactionResponse, ethers } from 'ethers';
import { Logger } from '../../utils/logger';

export interface FlashLoanParams {
  token: string;
  amount: string;
  dexA: string;
  dexB: string;
  minProfit: string;
}

export interface FlashLoanResult {
  success: boolean;
  txHash?: string;
  gasUsed?: string;
  profit?: string;
  error?: string;
}

export class FlashLoanExecutor {
  private contract: Contract;
  private signer: ethers.Signer;
  private dryRunMode: boolean;
  private logger: Logger;

  constructor(
    contract: Contract,
    signer: ethers.Signer,
    dryRunMode: boolean = false
  ) {
    this.contract = contract;
    this.signer = signer;
    this.dryRunMode = dryRunMode;
    this.logger = new Logger('FlashLoanExecutor');
  }

  /**
   * Execute a flash loan with encoded parameters
   */
  async executeFlashLoan(params: FlashLoanParams): Promise<FlashLoanResult> {
    try {
      this.logger.info(`Executing flash loan with params: ${JSON.stringify(params)}`);

      if (this.dryRunMode) {
        this.logger.info('DRY RUN MODE - Simulating transaction');
        return this.simulateFlashLoan(params);
      }

      const encodedParams = this.encodeParameters(params);
      this.logger.debug(`Encoded parameters: ${encodedParams}`);

      const tx = await this.contract.executeFlashLoan(
        params.token,
        params.amount,
        params.dexA,
        params.dexB,
        params.minProfit,
        { gasLimit: 500000 }
      );

      this.logger.info(`Transaction submitted: ${tx.hash}`);

      const receipt = await tx.wait(1);

      if (!receipt) {
        return {
          success: false,
          error: 'Transaction receipt not found',
        };
      }

      this.logger.info(`Transaction confirmed in block ${receipt.blockNumber}`);

      return {
        success: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Flash loan execution failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Encode flash loan parameters for contract call
   */
  private encodeParameters(params: FlashLoanParams): string {
    try {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'address', 'address', 'uint256'],
        [params.token, params.amount, params.dexA, params.dexB, params.minProfit]
      );
      return encoded;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Parameter encoding failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Simulate flash loan execution without sending transaction
   */
  private async simulateFlashLoan(params: FlashLoanParams): Promise<FlashLoanResult> {
    try {
      const result = await this.contract.executeFlashLoan.staticCall(
        params.token,
        params.amount,
        params.dexA,
        params.dexB,
        params.minProfit,
        { gasLimit: 500000 }
      );

      this.logger.info(`Simulation successful: ${JSON.stringify(result)}`);

      return {
        success: true,
        profit: result.toString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Flash loan simulation failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Set dry run mode
   */
  setDryRunMode(enabled: boolean): void {
    this.dryRunMode = enabled;
    this.logger.info(`Dry run mode set to: ${enabled}`);
  }

  /**
   * Check if dry run mode is enabled
   */
  isDryRunMode(): boolean {
    return this.dryRunMode;
  }
}
