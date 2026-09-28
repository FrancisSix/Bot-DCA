// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";
import {IUniswapV3SwapRouter, IV3Factory, IV3Pool, IWETH9} from "./interfaces/IUniswapV3.sol";

/// @title BotDCA
/// @notice Permissionless dollar-cost averaging on BOT Chain.
///         A user deposits a budget of `tokenIn`; anyone can call `execute` to swap
///         `amountPerInterval` into `tokenOut` at each interval until the budget ends.
contract BotDCA is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Sentinel for native BOT (same convention as 1inch/Paraswap).
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 public constant BPS = 10_000;

    IUniswapV2Router02 public immutable router;
    address public immutable wbot; // WBOT == router.WETH()
    IUniswapV3SwapRouter public immutable v3Router;
    IV3Factory public immutable v3Factory;

    /// @dev Execution venue. Defaults to V3 (0.30% pool): the V2 WBOT/USDT pool can be
    ///      materially stale/mispriced on a thin chain, so V3 is the safer default.
    bool public useV3 = true;
    uint24 public v3FeeTier = 3000;

    uint256 public minInterval = 1 hours;
    uint256 public maxIntervals = 1000;
    uint256 public maxSlippageBps = 1000; // 10% ceiling
    uint256 public keeperFeeBps = 0;      // e.g. 10 == 0.1% of tokenOut
    bool public paused;

    struct Position {
        address owner;
        address tokenIn;  // ERC20 or NATIVE
        address tokenOut; // ERC20 or NATIVE
        uint256 amountPerInterval; // tokenIn spent per execute
        uint256 intervalSeconds;
        uint256 numIntervals;
        uint256 intervalsExecuted;
        uint256 lastExecutedAt;   // set to creation time on create
        uint256 totalDeposited;   // tokenIn put in
        uint256 accruedTokenOut;  // tokenOut available to withdraw
        uint256 slippageBps;
        bool active;
    }

    struct Execution {
        uint256 timestamp;
        uint256 amountIn;
        uint256 amountOut;
    }

    uint256 public nextId;
    mapping(uint256 => Position) public positions;
    mapping(uint256 => Execution[]) private executions;

    event PositionCreated(
        uint256 indexed id,
        address indexed owner,
        address tokenIn,
        address tokenOut,
        uint256 amountPerInterval,
        uint256 intervalSeconds,
        uint256 numIntervals
    );
    event Executed(uint256 indexed id, uint256 amountIn, uint256 amountOut, uint256 keeperFee, address keeper);
    event Withdrawn(uint256 indexed id, uint256 amount, address token);
    event Cancelled(uint256 indexed id, uint256 refundedTokenIn);

    constructor(address _router, address _v3Router, address _v3Factory) Ownable(msg.sender) {
        router = IUniswapV2Router02(_router);
        wbot = router.WETH();
        v3Router = IUniswapV3SwapRouter(_v3Router);
        v3Factory = IV3Factory(_v3Factory);
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    /// @notice Create a DCA position, funding it up front with the full budget.
    function createPosition(
        address tokenIn,
        address tokenOut,
        uint256 amountPerInterval,
        uint256 intervalSeconds,
        uint256 numIntervals,
        uint256 slippageBps
    ) external payable whenNotPaused returns (uint256 id) {
        require(tokenIn != tokenOut, "same token");
        require(!(tokenIn == NATIVE && tokenOut == NATIVE), "native-native");
        require(amountPerInterval > 0, "zero amount");
        require(intervalSeconds >= minInterval, "interval too short");
        require(numIntervals >= 1 && numIntervals <= maxIntervals, "bad count");
        require(slippageBps <= maxSlippageBps, "slippage too high");

        uint256 total = amountPerInterval * numIntervals;
        if (tokenIn == NATIVE) {
            require(msg.value == total, "wrong native amount");
        } else {
            require(msg.value == 0, "no native for erc20");
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), total);
        }

        id = nextId++;
        positions[id] = Position({
            owner: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountPerInterval: amountPerInterval,
            intervalSeconds: intervalSeconds,
            numIntervals: numIntervals,
            intervalsExecuted: 0,
            lastExecutedAt: block.timestamp,
            totalDeposited: total,
            accruedTokenOut: 0,
            slippageBps: slippageBps,
            active: true
        });
        emit PositionCreated(id, msg.sender, tokenIn, tokenOut, amountPerInterval, intervalSeconds, numIntervals);
    }

    /// @notice Execute one interval for a position using the default direct pair. Permissionless.
    function execute(uint256 id) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Position storage p = positions[id];
        return _execute(id, _path(p.tokenIn, p.tokenOut), useV3);
    }

    /// @notice Execute one interval with a keeper-supplied multi-hop path (via the V2 router).
    ///         `path` must start/end at WBOT for native BOT, otherwise the ERC20 tokens themselves.
    function executeWithPath(uint256 id, address[] calldata path) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Position storage p = positions[id];
        address expFirst = p.tokenIn == NATIVE ? wbot : p.tokenIn;
        address expLast = p.tokenOut == NATIVE ? wbot : p.tokenOut;
        require(path.length >= 2, "short path");
        require(path[0] == expFirst && path[path.length - 1] == expLast, "bad path");
        return _execute(id, path, false);
    }

    function _execute(uint256 id, address[] memory path, bool viaV3) internal returns (uint256 amountOut) {
        Position storage p = positions[id];
        require(p.active, "inactive");
        require(p.intervalsExecuted < p.numIntervals, "done");
        require(block.timestamp >= p.lastExecutedAt + p.intervalSeconds, "not due");
        // The V3 router unwraps WETH9 to native on output, so it can never deliver the
        // WBOT ERC-20. Guard against silently crediting native to a wbot-denominated position.
        require(!(viaV3 && p.tokenOut == wbot), "v3 cannot deliver wbot erc20");

        uint256 amountIn = p.amountPerInterval;
        uint256 minOut = viaV3
            ? _minOutV3(p.tokenIn, p.tokenOut, amountIn, p.slippageBps)
            : _minOut(amountIn, p.slippageBps, path);

        uint256 before = _balance(p.tokenOut);
        if (viaV3) {
            _swapV3(p.tokenIn, p.tokenOut, amountIn, minOut);
        } else {
            _swap(p.tokenIn, p.tokenOut, amountIn, minOut, path);
        }
        uint256 received = _balance(p.tokenOut) - before;

        uint256 keeperFee = received * keeperFeeBps / BPS;
        uint256 net = received - keeperFee;
        if (keeperFee > 0) _transferOut(p.tokenOut, msg.sender, keeperFee);

        p.accruedTokenOut += net;
        p.intervalsExecuted += 1;
        p.lastExecutedAt = block.timestamp;
        if (p.intervalsExecuted == p.numIntervals) p.active = false;

        executions[id].push(Execution({ timestamp: block.timestamp, amountIn: amountIn, amountOut: net }));

        emit Executed(id, amountIn, net, keeperFee, msg.sender);
        return net;
    }

    /// @notice Withdraw accrued tokenOut.
    function withdraw(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        require(p.owner == msg.sender, "not owner");
        uint256 amount = p.accruedTokenOut;
        require(amount > 0, "nothing");
        p.accruedTokenOut = 0;
        _transferOut(p.tokenOut, msg.sender, amount);
        emit Withdrawn(id, amount, p.tokenOut);
    }

    /// @notice Cancel and refund unspent tokenIn (and any accrued tokenOut).
    function cancel(uint256 id) external nonReentrant {
        Position storage p = positions[id];
        require(p.owner == msg.sender, "not owner");
        require(p.active, "inactive");

        uint256 remaining = (p.numIntervals - p.intervalsExecuted) * p.amountPerInterval;
        p.active = false;

        if (remaining > 0) _transferOut(p.tokenIn, msg.sender, remaining);

        uint256 out = p.accruedTokenOut;
        if (out > 0) {
            p.accruedTokenOut = 0;
            _transferOut(p.tokenOut, msg.sender, out);
        }

        emit Cancelled(id, remaining);
    }

    /* ------------------------- internals ------------------------- */

    function _path(address tokenIn, address tokenOut) internal view returns (address[] memory path) {
        path = new address[](2);
        path[0] = tokenIn == NATIVE ? wbot : tokenIn;
        path[1] = tokenOut == NATIVE ? wbot : tokenOut;
    }

    function _minOut(uint256 amountIn, uint256 slippageBps, address[] memory path) internal view returns (uint256) {
        uint256[] memory amounts = router.getAmountsOut(amountIn, path);
        uint256 expected = amounts[amounts.length - 1];
        return expected * (BPS - slippageBps) / BPS;
    }

    /// @dev On BOT Chain the V3 QuoterV2/router reject `address(0)` and require the real
    ///      WETH address (WBOT), so map native BOT -> wbot. The router unwraps to native on
    ///      output, and the DCA only ever trades BOT <-> USDT, so this is unambiguous.
    function _v3Token(address token) internal view returns (address) {
        return token == NATIVE ? wbot : token;
    }

    /// @dev V3 minOut from the pool's live spot price (slot0), NOT QuoterV2: QuoterV2 returns
    ///      its value by reverting, so it is only callable off-chain via eth_call and would revert
    ///      inside a transaction. slot0 is a pure view read, safe on-chain.
    function _minOutV3(address tokenIn, address tokenOut, uint256 amountIn, uint256 slippageBps)
        internal view returns (uint256)
    {
        address pool = IV3Factory(v3Factory).getPool(_v3Token(tokenIn), _v3Token(tokenOut), v3FeeTier);
        (uint160 sqrtPriceX96,,,,,,) = IV3Pool(pool).slot0();
        require(sqrtPriceX96 > 0, "bad pool price");

        uint256 amountOut;
        if (_v3Token(tokenIn) < _v3Token(tokenOut)) {
            // tokenIn is token0: amountOut = amountIn * (sqrtPrice/2^96)^2
            amountOut = _mulDiv(amountIn, uint256(sqrtPriceX96), 1 << 96);
            amountOut = _mulDiv(amountOut, uint256(sqrtPriceX96), 1 << 96);
        } else {
            // tokenIn is token1: amountOut = amountIn / (sqrtPrice/2^96)^2
            amountOut = _mulDiv(amountIn, 1 << 96, uint256(sqrtPriceX96));
            amountOut = _mulDiv(amountOut, 1 << 96, uint256(sqrtPriceX96));
        }
        return amountOut * (BPS - slippageBps) / BPS;
    }

    function _mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b) / d;
    }

    function _swapV3(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal {
        if (tokenIn != NATIVE) _ensureAllowance(tokenIn, address(v3Router), amountIn);

        // For native output the V3 router returns WETH9 (WBOT) to this contract; we unwrap it
        // to native BOT below. For native input we send the native value and the router wraps it.
        address routerOut = tokenOut == NATIVE ? wbot : tokenOut;

        v3Router.exactInputSingle{value: tokenIn == NATIVE ? amountIn : 0}(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: _v3Token(tokenIn),
                tokenOut: routerOut,
                fee: v3FeeTier,
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );

        if (tokenOut == NATIVE) {
            uint256 wethBal = IERC20(wbot).balanceOf(address(this));
            if (wethBal > 0) {
                _ensureAllowance(wbot, wbot, wethBal); // withdraw() pulls from msg.sender allowance
                IWETH9(wbot).withdraw(wethBal);
            }
        }
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address[] memory path) internal {
        uint256 deadline = block.timestamp + 300;
        if (tokenIn == NATIVE) {
            router.swapExactETHForTokens{value: amountIn}(minOut, path, address(this), deadline);
        } else if (tokenOut == NATIVE) {
            _ensureAllowance(tokenIn, address(router), amountIn);
            router.swapExactTokensForETH(amountIn, minOut, path, address(this), deadline);
        } else {
            _ensureAllowance(tokenIn, address(router), amountIn);
            router.swapExactTokensForTokens(amountIn, minOut, path, address(this), deadline);
        }
    }

    function _ensureAllowance(address token, address spender, uint256 amount) internal {
        if (IERC20(token).allowance(address(this), spender) < amount) {
            IERC20(token).forceApprove(spender, type(uint256).max);
        }
    }

    function _balance(address token) internal view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _transferOut(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /* ------------------------- view helpers ------------------------- */

    function isDue(uint256 id) external view returns (bool) {
        Position storage p = positions[id];
        return p.active
            && p.intervalsExecuted < p.numIntervals
            && block.timestamp >= p.lastExecutedAt + p.intervalSeconds;
    }

    function preview(uint256 id) external view returns (uint256 expectedOut, uint256 minOut) {
        Position storage p = positions[id];
        address[] memory path = _path(p.tokenIn, p.tokenOut);
        uint256[] memory amounts = router.getAmountsOut(p.amountPerInterval, path);
        expectedOut = amounts[amounts.length - 1];
        minOut = expectedOut * (BPS - p.slippageBps) / BPS;
    }

    function getExecutions(uint256 id) external view returns (Execution[] memory) {
        return executions[id];
    }

    /* ------------------------- admin ------------------------- */

    function setMinInterval(uint256 v) external onlyOwner { minInterval = v; }
    function setMaxIntervals(uint256 v) external onlyOwner { maxIntervals = v; }
    function setMaxSlippageBps(uint256 v) external onlyOwner { maxSlippageBps = v; }
    function setKeeperFeeBps(uint256 v) external onlyOwner { require(v <= 100, "too high"); keeperFeeBps = v; }
    function setVenue(bool _useV3, uint24 _feeTier) external onlyOwner { useV3 = _useV3; v3FeeTier = _feeTier; }
    function setPaused(bool v) external onlyOwner { paused = v; }

    receive() external payable {}
}
