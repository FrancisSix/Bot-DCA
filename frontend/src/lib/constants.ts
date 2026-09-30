export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Live BOT Chain testnet deployment (V3-routed). Used as the fallback whenever
// VITE_DCA_ADDRESS is absent or unusable.
const LIVE_TESTNET_DCA = "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Vite inlines `import.meta.env.VITE_*` at build time. A host (e.g. Vercel) can
// define VITE_DCA_ADDRESS as an empty string or the zero address; a plain `??`
// does not catch those, and the app would then submit transactions with no `to`
// target (they revert as contract-creation calls). Only honour a well-formed,
// non-zero address and otherwise fall back to the live deployment.
const configuredAddress = (import.meta.env.VITE_DCA_ADDRESS ?? "") as string;

/** True when the configured address was missing/invalid and we fell back. */
export const DCA_ADDRESS_IS_FALLBACK = !(
  ADDRESS_RE.test(configuredAddress) && configuredAddress.toLowerCase() !== ZERO_ADDRESS
);

export const BOT_DCA = (
  DCA_ADDRESS_IS_FALLBACK ? LIVE_TESTNET_DCA : configuredAddress
) as `0x${string}`;

export const ROUTER = "0xD6425a02f0845B8D99e349C34D2E7A576E177345";
export const WBOT = "0xD5452816194a3784dBa983426cCe7c122F4abd30";
export const V3_FACTORY = "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419";
export const USDT = "0x75edC9335175Fc0552D51D48439F229c10420fe3";
