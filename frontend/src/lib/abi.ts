import { parseAbi } from "viem";

export const BOT_DCA_ABI = parseAbi([
  "function createPosition(address tokenIn, address tokenOut, uint256 amountPerInterval, uint256 intervalSeconds, uint256 numIntervals, uint256 slippageBps) payable returns (uint256)",
  "function execute(uint256 id) returns (uint256)",
  "function executeWithPath(uint256 id, address[] path) returns (uint256)",
  "function withdraw(uint256 id)",
  "function cancel(uint256 id)",
  "function nextId() view returns (uint256)",
  "function positions(uint256) view returns (address owner, address tokenIn, address tokenOut, uint256 amountPerInterval, uint256 intervalSeconds, uint256 numIntervals, uint256 intervalsExecuted, uint256 lastExecutedAt, uint256 totalDeposited, uint256 accruedTokenOut, uint256 slippageBps, bool active)",
  "function getExecutions(uint256 id) view returns ((uint256 timestamp, uint256 amountIn, uint256 amountOut)[])",
  "function isDue(uint256) view returns (bool)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256, address[]) view returns (uint256[])",
  "function WETH() view returns (address)",
]);

// BDEX V3: used for the *market* price (what the explorer shows).
export const V3_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
]);

