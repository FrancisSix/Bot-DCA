import { ethers } from "hardhat";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
];

// BOT Chain addresses (from the official Developer Docs).
const ADDRS: Record<number, { router: string; wbot: string; usdt: string }> = {
  677: {
    router: "0x1414eD29FdFD322c3c0a830330ed982E2D629e76",
    wbot: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
    usdt: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
  },
  968: {
    router: "0xD6425a02f0845B8D99e349C34D2E7A576E177345",
    wbot: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
    usdt: "0x75edC9335175Fc0552D51D48439F229c10420fe3",
  },
};

// Optional: DCA contract to inspect. Falls back to the testnet deployment.
const DCA =
  process.env.DCA_ADDRESS ??
  "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";

const DCA_ABI = [
  "function nextId() view returns (uint256)",
  "function minInterval() view returns (uint256)",
  "function keeperFeeBps() view returns (uint256)",
  "function positions(uint256) view returns (address owner, address tokenIn, address tokenOut, uint256 amountPerInterval, uint256 intervalSeconds, uint256 numIntervals, uint256 intervalsExecuted, uint256 lastExecutedAt, uint256 totalDeposited, uint256 accruedTokenOut, uint256 slippageBps, bool active)",
  "function getExecutions(uint256 id) view returns ((uint256 timestamp, uint256 amountIn, uint256 amountOut)[])",
];

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const a = ADDRS[chainId];
  if (!a) throw new Error(`No addresses configured for chain ${chainId}`);

  console.log(`\n== BOT Chain smoke (chain ${chainId}) ==`);
  console.log(`block number: ${await ethers.provider.getBlockNumber()}`);

  const usdt = new ethers.Contract(a.usdt, ERC20_ABI, ethers.provider);
  const wbot = new ethers.Contract(a.wbot, ERC20_ABI, ethers.provider);
  const router = new ethers.Contract(a.router, ROUTER_ABI, ethers.provider);

  console.log(`USDT: ${await usdt.symbol()} (${await usdt.decimals()} dp) @ ${a.usdt}`);
  console.log(`WBOT: ${await wbot.symbol()} (${await wbot.decimals()} dp) @ ${a.wbot}`);

  const weth = (await router.WETH()) as string;
  console.log(`router.WETH() = ${weth}`);
  console.log(`WETH == WBOT? ${weth.toLowerCase() === a.wbot.toLowerCase()}`);

  try {
    // 1 USDT (6 dp) -> WBOT via the V2 router
    const oneUsdt = 1_000_000n;
    const out = (await router.getAmountsOut(oneUsdt, [a.usdt, a.wbot])) as bigint[];
    console.log(`quote: 1 USDT -> ${ethers.formatEther(out[1])} WBOT`);
  } catch (e) {
    console.log("quote: USDT/WBOT pair may not exist yet (no liquidity) — skipping.");
  }

  // Deployed DCA contract, if deployed on this chain.
  const code = await ethers.provider.getCode(DCA);
  if (code === "0x") {
    console.log(`DCA ${DCA}: not deployed on chain ${chainId} — skipping.`);
  } else {
    const dca = new ethers.Contract(DCA, DCA_ABI, ethers.provider);
    const nextId = (await dca.nextId()) as bigint;
    console.log(`DCA ${DCA}: deployed. nextId=${nextId.toString()} minInterval=${(await dca.minInterval()).toString()}s keeperFeeBps=${(await dca.keeperFeeBps()).toString()}`);
    if (nextId > 0n) {
      const p = await dca.positions(0);
      const exs = (await dca.getExecutions(0)) as readonly (readonly [bigint, bigint, bigint])[];
      console.log(`  position 0: exec=${p[6]}/${p[5]} accrued=${p[9].toString()} history=${exs.length}`);
    }
  }

  console.log(`\nSmoke OK ✅`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
