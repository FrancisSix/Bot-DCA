import { ethers } from "hardhat";

const DCA = process.env.DCA_ADDRESS ?? "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDT = "0x75edC9335175Fc0552D51D48439F229c10420fe3";

const DCA_ABI = [
  "function createPosition(address,address,uint256,uint256,uint256,uint256) payable returns (uint256)",
  "function execute(uint256) returns (uint256)",
  "function getExecutions(uint256) view returns ((uint256,uint256,uint256)[])",
  "function withdraw(uint256)",
  "function nextId() view returns (uint256)",
];
const USDT_ABI = ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const QUOTER_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const dca = new ethers.Contract(DCA, DCA_ABI, deployer);
  const usdt = new ethers.Contract(USDT, USDT_ABI, deployer);
  const quoter = new ethers.Contract("0x034A705b36067cff99ABf5C662Be881cBd8d0176", QUOTER_ABI, deployer);

  const perInterval = ethers.parseUnits("1", 6); // 1 USDT per interval
  const numIntervals = 3n;
  const total = perInterval * numIntervals;

  const bal = (await usdt.balanceOf(deployer.address)) as bigint;
  if (bal < total) throw new Error(`need ${total} testnet USDT, have ${bal}`);
  await (await usdt.approve(DCA, total)).wait();

  // Market reference BEFORE the fill (V3 0.30% pool).
  const quote = (await quoter.quoteExactInputSingle({
    tokenIn: USDT,
    tokenOut: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
    amountIn: perInterval,
    fee: 3000,
    sqrtPriceLimitX96: 0,
  })) as bigint;
  const botPerUsdt = Number(quote) / 1e18;

  const rc = await (await dca.createPosition(USDT, NATIVE, perInterval, 10, numIntervals, 1000)).wait();
  const id = (await dca.nextId()) - 1n;
  console.log(`position ${id} created (10s interval, ${numIntervals} intervals) tx=${rc?.hash}`);

  await new Promise((r) => setTimeout(r, 12_000));
  await (await dca.execute(id)).wait();

  const e = (await dca.getExecutions(id))[0];
  const inNum = Number(e[1]) / 1e6;
  const outNum = Number(e[2]) / 1e18;
  const actualRate = inNum / outNum;
  const quoteRate = 1 / botPerUsdt;
  console.log(`fill: ${inNum.toFixed(6)} USDT -> ${outNum.toFixed(8)} BOT`);
  console.log(`  actual rate      : ${actualRate.toFixed(4)} USDT/BOT`);
  console.log(`  V3 quote (pre-fill): ${quoteRate.toFixed(4)} USDT/BOT`);
  console.log(`  drift: ${(Math.abs(actualRate / quoteRate - 1) * 100).toFixed(2)}%  (0.30% pool fee + 0.10% keeper + impact)`);

  await (await dca.withdraw(id)).wait();
  console.log("withdrawn OK");
  console.log("\nE2E OK (V3 venue)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});



