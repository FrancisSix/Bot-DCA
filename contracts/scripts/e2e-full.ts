// e2e-full.ts — prove the full BOT DCA loop works without manual intervention.
//
// Creates a position, then WAITS FOR THE KEEPER to execute every interval.
// This script never calls execute() itself; that is the point of the test.
//
// Usage: hardhat run scripts/e2e-full.ts --network botchain-testnet
import { ethers } from "hardhat";

const DCA = process.env.DCA_ADDRESS ?? "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDT = "0x75edC9335175Fc0552D51D48439F229c10420fe3";
const QUOTER = "0x034A705b36067cff99ABf5C662Be881cBd8d0176";
const WBOT = "0xD5452816194a3784dBa983426cCe7c122F4abd30";

const DCA_ABI = [
  "function createPosition(address,address,uint256,uint256,uint256,uint256) payable returns (uint256)",
  "function withdraw(uint256)",
  "function cancel(uint256)",
  "function nextId() view returns (uint256)",
  "function positions(uint256) view returns (address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)",
  "function getExecutions(uint256) view returns ((uint256,uint256,uint256)[])",
];
const Q_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256)",
];
const USDT_ABI = ["function balanceOf(address) view returns (uint256)"];

const PER_INTERVAL = ethers.parseEther("0.5"); // 0.5 BOT
const NUM_INTERVALS = 3n;
const INTERVAL = 10n;
const TOTAL = PER_INTERVAL * NUM_INTERVALS;

async function main() {
  const [me] = await ethers.getSigners();
  const dca = new ethers.Contract(DCA, DCA_ABI, me);
  const usdt = new ethers.Contract(USDT, USDT_ABI, me);

  // Market reference (V3 spot) so we can judge the fill. NB: quote is the USDT out
  // for PER_INTERVAL BOT, so normalise to a per-1-BOT price.
  const quoter = new ethers.Contract(QUOTER, Q_ABI, me);
  const quote = (await quoter.quoteExactInputSingle({
    tokenIn: WBOT, tokenOut: USDT, amountIn: PER_INTERVAL, fee: 3000, sqrtPriceLimitX96: 0,
  })) as bigint;
  const marketPerBot = Number(quote) / 1e6 / Number(ethers.formatEther(PER_INTERVAL));

  console.log("=".repeat(58));
  console.log("BOT DCA end-to-end (keeper-driven)");
  console.log("=".repeat(58));
  console.log(`wallet          : ${me.address}`);
  console.log(`BOT balance     : ${ethers.formatEther(await ethers.provider.getBalance(me.address))}`);
  console.log(`market price    : $${marketPerBot.toFixed(4)} / BOT (V3 0.30%)`);
  console.log(`position        : ${ethers.formatEther(PER_INTERVAL)} BOT x ${NUM_INTERVALS} every ${INTERVAL}s`);

  const before = await usdt.balanceOf(me.address);
  const tx = await dca.createPosition(NATIVE, USDT, PER_INTERVAL, INTERVAL, NUM_INTERVALS, 1000, { value: TOTAL });
  await tx.wait();
  const id = (await dca.nextId()) - 1n;
  console.log(`created position #${id} (${tx.hash})`);
  console.log("\nwaiting for the keeper to execute intervals (no manual calls)...\n");

  let last = -1n;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const p = await dca.positions(id);
    const executed = p[6];
    if (executed !== last) {
      console.log(`  t+${((Date.now() - (deadline - 150_000)) / 1000).toFixed(0)}s  executed ${executed}/${p[5]}  accrued=${ethers.formatUnits(p[9], 6)} USDT`);
      last = executed;
    }
    if (executed === p[5]) break;
  }

  const p = await dca.positions(id);
  const ex = await dca.getExecutions(id);
  console.log(`\nfinal: executed ${p[6]}/${p[5]}, history entries ${ex.length}`);

  if (p[6] !== p[5]) {
    console.log("FAIL: the keeper did not execute every interval in time.");
    process.exitCode = 1;
    return;
  }

  const accrued = p[9] as bigint;
  const spent = PER_INTERVAL * NUM_INTERVALS;
  // accrued is USDT (6dp); spent is BOT (18dp). Normalise both to human units.
  const effectivePerBot = Number(ethers.formatUnits(accrued, 6)) / Number(ethers.formatEther(spent));
  console.log(`accrued         : ${ethers.formatUnits(accrued, 6)} USDT`);
  console.log(`effective price : $${effectivePerBot.toFixed(4)} / BOT`);
  console.log(`vs market       : ${((effectivePerBot / marketPerBot - 1) * 100).toFixed(2)}%  (fee + impact)`);

  await (await dca.withdraw(id)).wait();
  const after = await usdt.balanceOf(me.address);
  console.log(`withdrawn       : ${ethers.formatUnits(after - before, 6)} USDT`);
  console.log(`\nE2E PASS ✅  (keeper executed every interval, funds withdrawn)`);
}

main().catch((e) => {
  console.error("ERR:", e.reason ?? e.shortMessage ?? e.message);
  process.exitCode = 1;
});
