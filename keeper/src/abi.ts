import { parseAbi } from "viem";

export const BOT_DCA_ABI = parseAbi([
  "function positions(uint256) view returns (address owner, address tokenIn, address tokenOut, uint256 amountPerInterval, uint256 intervalSeconds, uint256 numIntervals, uint256 intervalsExecuted, uint256 lastExecutedAt, uint256 totalDeposited, uint256 accruedTokenOut, uint256 slippageBps, bool active)",
  "function isDue(uint256) view returns (bool)",
  "function execute(uint256)",
  "function executeWithPath(uint256 id, address[] path) returns (uint256)",
  "function nextId() view returns (uint256)",
]);
