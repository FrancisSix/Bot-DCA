import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY
  ? process.env.PRIVATE_KEY
  : "0x0000000000000000000000000000000000000000000000000000000000000001";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    "botchain-mainnet": {
      url: process.env.MAINNET_RPC || "https://rpc.botchain.ai",
      chainId: 677,
      accounts: [PRIVATE_KEY],
    },
    "botchain-testnet": {
      url: process.env.TESTNET_RPC || "https://rpc.bohr.life",
      chainId: 968,
      accounts: [PRIVATE_KEY],
    },
  },
};

export default config;
