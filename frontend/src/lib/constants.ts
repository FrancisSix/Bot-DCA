export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
// Defaults to the live testnet deployment when VITE_DCA_ADDRESS is unset.
export const BOT_DCA = (import.meta.env.VITE_DCA_ADDRESS ??
  "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895") as `0x${string}`;
export const ROUTER = "0xD6425a02f0845B8D99e349C34D2E7A576E177345";
export const WBOT = "0xD5452816194a3784dBa983426cCe7c122F4abd30";
export const V3_FACTORY = "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419";
export const USDT = "0x75edC9335175Fc0552D51D48439F229c10420fe3";
