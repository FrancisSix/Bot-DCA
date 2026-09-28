import { ethers } from "hardhat";

// BOT Chain V2 Router02 addresses (from the official Developer Docs).
const ROUTERS: Record<number, string> = {
  677: "0x1414eD29FdFD322c3c0a830330ed982E2D629e76", // mainnet
  968: "0xD6425a02f0845B8D99e349C34D2E7A576E177345", // testnet
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const router = ROUTERS[chainId];
  if (!router) throw new Error(`No V2 Router02 configured for chain ${chainId}`);

  console.log(`Deploying BotDCA on chain ${chainId} (router ${router}, deployer ${deployer.address})`);

  const factory = await ethers.getContractFactory("BotDCA");
  const dca = await factory.deploy(router);
  await dca.waitForDeployment();

  console.log(`BotDCA deployed at: ${await dca.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
