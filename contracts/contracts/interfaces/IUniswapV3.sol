// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IV3Factory / IV3Pool
/// @notice Minimal BDEX V3 pool surface. `slot0` is a pure view read (unlike QuoterV2,
///         which returns its value by reverting and therefore only works off-chain via eth_call).
interface IV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/// @title IWETH9
/// @notice WETH9 wrapper used to unwrap V3 WETH9 output back to native BOT.
interface IWETH9 {
    function withdraw(uint256) external;
}

interface IV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

/// @title IUniswapV3SwapRouter
/// @notice Minimal BDEX V3 SwapRouter surface used for direct (single-pool) swaps.
/// @dev NOTE: the BDEX V3 SwapRouter struct is
///      (tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96)
///      — note `recipient`/`deadline` and the absence of `data` (differs from canonical Uniswap V3).
interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
    function WETH() external pure returns (address);
}

/// @title IQuoterV2
/// @notice Minimal BDEX QuoterV2 surface used to price a V3 single-pool swap on-chain.
interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        view
        returns (uint256 amountOut);
}
