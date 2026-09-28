import { ethers } from "hardhat";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const TESTNET_ROUTER = "0xD6425a02f0845B8D99e349C34D2E7A576E177345";
const TESTNET_USDT = "0x75edC9335175Fc0552D51D48439F229c10420fe3";

const USDT_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 968) throw new Error("Run with --network botchain-testnet");

  const bot = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`BOT bal  : ${ethers.formatEther(bot)} BOT`);

  // 1. Deploy
  const factory = await ethers.getContractFactory("BotDCA");
  const dca = await factory.deploy(TESTNET_ROUTER);
  await dca.waitForDeployment();
  const dcaAddr = await dca.getAddress();
  console.log(`BotDCA   : ${dcaAddr}`);

  // 2. Lower min interval to 0 (demo only, owner-only) so we can execute immediately.
  await (await dca.setMinInterval(0)).wait();
  console.log("minInterval -> 0");

  // 3. Create a BOT -> USDT DCA: 0.01 BOT per interval, 2 intervals.
  const amountPerInterval = ethers.parseEther("0.01");
  const numIntervals = 2n;
  const total = amountPerInterval * numIntervals;
  const usdt = new ethers.Contract(TESTNET_USDT, USDT_ABI, deployer);

  await (await dca.createPosition(NATIVE, TESTNET_USDT, amountPerInterval, 0, numIntervals, 100, { value: total })).wait();
  console.log(`Position 0 created (deposited ${ethers.formatEther(total)} BOT)`);

  // 4. Execute each interval (intervalSeconds = 0, so due immediately).
  for (let i = 0; i < Number(numIntervals); i++) {
    await (await dca.execute(0)).wait();
    console.log(`executed interval ${i + 1}/${numIntervals}`);
  }

  const pos = await dca.positions(0);
  console.log(`accrued tokenOut: ${pos.accruedTokenOut.toString()} (raw USDT)`);

  // 5. Withdraw USDT.
  const before = await usdt.balanceOf(deployer.address);
  await (await dca.withdraw(0)).wait();
  const after = await usdt.balanceOf(deployer.address);
  console.log(`Withdrew: ${ethers.formatUnits(after - before, 6)} USDT`);

  console.log(`\nDCA_ADDRESS=${dcaAddr}`);
  console.log(`E2E OK ✅`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
