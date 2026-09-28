import "dotenv/config";

export const config = {
  chainId: Number(process.env.CHAIN_ID ?? 677),
  rpcUrl: process.env.RPC_URL ?? "https://rpc.botchain.ai",
  dcaAddress: (process.env.DCA_ADDRESS ?? "") as `0x${string}`,
  keeperPrivateKey: (process.env.KEEPER_PRIVATE_KEY ?? "") as `0x${string}`,
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 30_000),
  refreshIntervalMs: Number(process.env.REFRESH_INTERVAL_MS ?? 60_000),
};
