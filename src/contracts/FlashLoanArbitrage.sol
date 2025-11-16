// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);

    function getAmountsOut(uint amountIn, address[] calldata path)
        external
        view
        returns (uint[] memory amounts);
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/**
 * @title FlashLoanArbitrage
 * @notice Execute flash loan arbitrage between different DEXs on Base chain
 * @dev Uses Aave V3 flash loans to execute arbitrage without upfront capital
 */
contract FlashLoanArbitrage is FlashLoanSimpleReceiverBase, ReentrancyGuard {
    address payable public owner;

    // Events
    event ArbitrageExecuted(
        address indexed asset,
        uint256 amount,
        uint256 profit,
        uint256 timestamp
    );

    event ArbitrageFailed(
        address indexed asset,
        uint256 amount,
        string reason,
        uint256 timestamp
    );

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // Arbitrage parameters structure
    struct ArbitrageParams {
        address tokenBorrow;      // Token to borrow via flash loan
        address tokenIntermediate; // Intermediate token (if needed)
        uint256 amountBorrow;     // Amount to borrow
        address dexBuy;           // DEX router address for buying
        address dexSell;          // DEX router address for selling
        uint24 feeBuy;            // Fee for V3 buy (0 for V2)
        uint24 feeSell;           // Fee for V3 sell (0 for V2)
        bool isV3Buy;             // Is buy DEX V3?
        bool isV3Sell;            // Is sell DEX V3?
        uint256 minProfit;        // Minimum profit required (safety check)
    }

    constructor(address _addressProvider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
    {
        owner = payable(msg.sender);
    }

    /**
     * @notice Execute flash loan arbitrage
     * @param asset Token address to borrow
     * @param amount Amount to borrow
     * @param params Encoded arbitrage parameters
     */
    function executeFlashLoanArbitrage(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner nonReentrant {
        // Request flash loan from Aave V3
        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0 // referral code
        );
    }

    /**
     * @notice Called by Aave pool after flash loan is received
     * @param asset The asset being flash borrowed
     * @param amount The amount being flash borrowed
     * @param premium The fee to be paid
     * @param initiator The address initiating the flash loan
     * @param params Encoded arbitrage parameters
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller must be Pool");
        require(initiator == address(this), "Initiator must be this contract");

        // Decode arbitrage parameters
        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));

        require(arbParams.tokenBorrow == asset, "Asset mismatch");
        require(arbParams.amountBorrow == amount, "Amount mismatch");

        // Execute arbitrage trades
        uint256 amountAfterTrades = _executeArbitrageTrades(arbParams);

        // Calculate total amount to repay (borrowed + premium)
        uint256 amountOwed = amount + premium;

        // Ensure we have enough to repay the flash loan
        require(
            amountAfterTrades >= amountOwed,
            "Insufficient funds to repay flash loan"
        );

        // Calculate profit
        uint256 profit = amountAfterTrades - amountOwed;

        // Ensure minimum profit is met
        require(profit >= arbParams.minProfit, "Profit below minimum");

        // Approve pool to pull the owed amount
        IERC20(asset).approve(address(POOL), amountOwed);

        // Emit success event
        emit ArbitrageExecuted(asset, amount, profit, block.timestamp);

        return true;
    }

    /**
     * @notice Execute the arbitrage trades
     * @param params Arbitrage parameters
     * @return Final amount after all trades
     */
    function _executeArbitrageTrades(ArbitrageParams memory params)
        internal
        returns (uint256)
    {
        uint256 currentAmount = params.amountBorrow;
        address currentToken = params.tokenBorrow;

        // First trade: Buy on DEX 1
        if (params.isV3Buy) {
            currentAmount = _executeV3Swap(
                params.dexBuy,
                currentToken,
                params.tokenIntermediate,
                params.feeBuy,
                currentAmount,
                0 // minAmountOut (calculated off-chain)
            );
        } else {
            currentAmount = _executeV2Swap(
                params.dexBuy,
                currentToken,
                params.tokenIntermediate,
                currentAmount,
                0
            );
        }

        currentToken = params.tokenIntermediate;

        // Second trade: Sell on DEX 2
        if (params.isV3Sell) {
            currentAmount = _executeV3Swap(
                params.dexSell,
                currentToken,
                params.tokenBorrow,
                params.feeSell,
                currentAmount,
                0
            );
        } else {
            currentAmount = _executeV2Swap(
                params.dexSell,
                currentToken,
                params.tokenBorrow,
                currentAmount,
                0
            );
        }

        return currentAmount;
    }

    /**
     * @notice Execute Uniswap V2 style swap
     */
    function _executeV2Swap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256) {
        // Approve router to spend tokens
        IERC20(tokenIn).approve(router, amountIn);

        // Create swap path
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        // Execute swap
        uint[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            address(this),
            block.timestamp + 300
        );

        return amounts[amounts.length - 1];
    }

    /**
     * @notice Execute Uniswap V3 swap
     */
    function _executeV3Swap(
        address router,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256) {
        // Approve router to spend tokens
        IERC20(tokenIn).approve(router, amountIn);

        // Execute swap
        IUniswapV3Router.ExactInputSingleParams memory swapParams =
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            });

        return IUniswapV3Router(router).exactInputSingle(swapParams);
    }

    /**
     * @notice Withdraw ERC20 tokens from contract
     * @param token Token address to withdraw
     */
    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance to withdraw");

        IERC20(token).transfer(owner, balance);
    }

    /**
     * @notice Withdraw ETH from contract
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        owner.transfer(balance);
    }

    /**
     * @notice Get balance of specific token
     */
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Get ETH balance
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address payable newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    /**
     * @notice Receive ETH
     */
    receive() external payable {}
}
