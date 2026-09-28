import { createConfig, http } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

export const botChainTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.bohr.life"] } },
  blockExplorers: { default: { name: "BOTScan Testnet", url: "https://scan.bohr.life" } },
});

export const botChainMainnet = defineChain({
  id: 677,
  name: "BOT Chain Mainnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.botchain.ai"] } },
  blockExplorers: { default: { name: "BOTScan", url: "https://scan.botchain.ai" } },
});

const rpcUrl = import.meta.env.VITE_RPC_URL ?? "https://rpc.bohr.life";

export const wagmiConfig = createConfig({
  chains: [botChainTestnet, botChainMainnet],
  connectors: [injected()],
  transports: {
    [botChainTestnet.id]: http(rpcUrl),
    [botChainMainnet.id]: http("https://rpc.botchain.ai"),
  },
});
