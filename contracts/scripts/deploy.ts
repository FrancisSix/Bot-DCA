import { ethers } from "hardhat";

// BOT Chain BDEX addresses (from the official Developer Docs).
const ROUTERS: Record<number, string> = {
  677: "0x1414eD29FdFD322c3c0a830330ed982E2D629e76", // mainnet
  968: "0xD6425a02f0845B8D99e349C34D2E7A576E177345", // testnet
};
const V3_ROUTERS: Record<number, string> = {
  677: "0x07032d47A1b9f8460cBeE9dC17c1d3E438693929",
  968: "0x07032d47A1b9f8460cBeE9dC17c1d3E438693929",
};
const QUOTERS: Record<number, string> = {
  677: "0x034A705b36067cff99ABf5C662Be881cBd8d0176",
  968: "0x034A705b36067cff99ABf5C662Be881cBd8d0176",
};
const V3_FACTORIES: Record<number, string> = {
  677: "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419",
  968: "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const router = ROUTERS[chainId];
  const v3Router = V3_ROUTERS[chainId];
  const v3Factory = V3_FACTORIES[chainId];
  if (!router || !v3Router || !v3Factory) throw new Error(`BDEX addresses not configured for chain ${chainId}`);

  console.log(`Deploying BotDCA on chain ${chainId} (v2 ${router}, v3 ${v3Router}, v3Factory ${v3Factory})`);

  const factory = await ethers.getContractFactory("BotDCA");
  const dca = await factory.deploy(router, v3Router, v3Factory);
  await dca.waitForDeployment();

  console.log(`BotDCA deployed at: ${await dca.getAddress()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
