// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockERC20.sol";
import {IUniswapV3SwapRouter} from "../interfaces/IUniswapV3.sol";

/// @dev 1:1 mock of the BDEX V3 SwapRouter (payable, native handled like the real one).
contract MockV3Router {
    using SafeERC20 for IERC20;

    address public immutable weth;

    constructor(address _weth) {
        weth = _weth;
    }

    receive() external payable {}

    function WETH() external view returns (address) {
        return weth;
    }

    function exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams calldata p)
        external payable returns (uint256 amountOut)
    {
        require(p.sqrtPriceLimitX96 == 0, "mock: no price limit");
        require(p.deadline >= block.timestamp, "mock: expired");
        require(p.recipient != address(0), "mock: no recipient");
        uint256 inAmt;
        if (p.tokenIn == weth) {
            require(msg.value == p.amountIn, "mock: native value mismatch");
            inAmt = msg.value;
        } else {
            IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
            inAmt = p.amountIn;
        }
        amountOut = inAmt; // 1:1
        require(amountOut >= p.amountOutMinimum, "mock: slippage");
        if (p.tokenOut == weth) {
            // real V3 unwraps WETH9 to native on output
            (bool ok, ) = payable(p.recipient).call{value: amountOut}("");
            require(ok, "mock: native send");
        } else {
            MockERC20(p.tokenOut).mint(p.recipient, amountOut);
        }
    }
}

/// @dev 1:1 mock V3 pool. sqrtPriceX96 encodes price 1.0 (raw 1:1) for any token pair,
///      so the DCA's slot0-based minOut resolves to amountIn for both orderings.
contract MockV3Pool {
    uint160 public constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2**96

    function slot0()
        external
        pure
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (SQRT_PRICE_1_1, 0, 0, 0, 0, 0, true);
    }

    function token0() external pure returns (address) {
        return address(0);
    }
}

/// @dev Factory that returns one shared 1:1 pool for any (tokenA, tokenB, fee).
contract MockV3Factory {
    MockV3Pool public pool;

    constructor() {
        pool = new MockV3Pool();
    }

    function getPool(address, address, uint24) external view returns (address) {
        return address(pool);
    }
}
