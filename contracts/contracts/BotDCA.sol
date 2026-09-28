// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Router02} from "./interfaces/IUniswapV2Router02.sol";

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

    constructor(address _router) Ownable(msg.sender) {
        router = IUniswapV2Router02(_router);
        wbot = router.WETH();
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
        return _execute(id, _path(p.tokenIn, p.tokenOut));
    }

    /// @notice Execute one interval with a keeper-supplied multi-hop path (via the V2 router).
    ///         `path` must start/end at WBOT for native BOT, otherwise the ERC20 tokens themselves.
    function executeWithPath(uint256 id, address[] calldata path) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        Position storage p = positions[id];
        address expFirst = p.tokenIn == NATIVE ? wbot : p.tokenIn;
        address expLast = p.tokenOut == NATIVE ? wbot : p.tokenOut;
        require(path.length >= 2, "short path");
        require(path[0] == expFirst && path[path.length - 1] == expLast, "bad path");
        return _execute(id, path);
    }

    function _execute(uint256 id, address[] memory path) internal returns (uint256 amountOut) {
        Position storage p = positions[id];
        require(p.active, "inactive");
        require(p.intervalsExecuted < p.numIntervals, "done");
        require(block.timestamp >= p.lastExecutedAt + p.intervalSeconds, "not due");

        uint256 amountIn = p.amountPerInterval;
        uint256 minOut = _minOut(amountIn, p.slippageBps, path);

        uint256 before = _balance(p.tokenOut);
        _swap(p.tokenIn, p.tokenOut, amountIn, minOut, path);
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

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address[] memory path) internal {
        uint256 deadline = block.timestamp + 300;
        if (tokenIn == NATIVE) {
            router.swapExactETHForTokens{value: amountIn}(minOut, path, address(this), deadline);
        } else if (tokenOut == NATIVE) {
            _ensureAllowance(tokenIn, amountIn);
            router.swapExactTokensForETH(amountIn, minOut, path, address(this), deadline);
        } else {
            _ensureAllowance(tokenIn, amountIn);
            router.swapExactTokensForTokens(amountIn, minOut, path, address(this), deadline);
        }
    }

    function _ensureAllowance(address token, uint256 amount) internal {
        if (IERC20(token).allowance(address(this), address(router)) < amount) {
            IERC20(token).forceApprove(address(router), type(uint256).max);
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
    function setPaused(bool v) external onlyOwner { paused = v; }

    receive() external payable {}
}
