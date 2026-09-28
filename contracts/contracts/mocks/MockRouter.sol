// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/// @dev Deterministic router used in tests. `rate` is the quoted price, `fillRate`
///      is the actual fill price — set them differently to exercise slippage reverts.
contract MockRouter {
    using SafeERC20 for IERC20;

    address public immutable weth;
    uint256 public rate = 1e18;     // quote price (tokenOut per tokenIn)
    uint256 public fillRate = 1e18; // actual fill price

    constructor(address _weth) {
        weth = _weth;
    }

    receive() external payable {}

    function WETH() external view returns (address) {
        return weth;
    }

    function setRate(uint256 r) external { rate = r; }
    function setFillRate(uint256 r) external { fillRate = r; }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        for (uint256 i = 0; i < path.length; i++) {
            amounts[i] = i == 0 ? amountIn : amountIn * rate / 1e18;
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path,
        address to, uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 out = amountIn * fillRate / 1e18;
        require(out >= amountOutMin, "slippage");
        MockERC20(path[path.length - 1]).mint(to, out);
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = out;
    }

    function swapExactETHForTokens(
        uint256 amountOutMin, address[] calldata path,
        address to, uint256 /*deadline*/
    ) external payable returns (uint256[] memory amounts) {
        uint256 out = msg.value * fillRate / 1e18;
        require(out >= amountOutMin, "slippage");
        MockERC20(path[path.length - 1]).mint(to, out);
        amounts = new uint256[](path.length);
        amounts[0] = msg.value;
        amounts[amounts.length - 1] = out;
    }

    function swapExactTokensForETH(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path,
        address to, uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 out = amountIn * fillRate / 1e18;
        require(out >= amountOutMin, "slippage");
        (bool ok, ) = payable(to).call{value: out}("");
        require(ok, "eth send failed");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = out;
    }
}
