// One-off: verify the deployed BotDCA source on BOTScan's Etherscan-compatible API.
// Usage: hardhat run scripts/verify.ts --network botchain-testnet
import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const DCA = process.env.DCA_ADDRESS ?? "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";
const API = "https://scan.bohr.life/api";
const BUILD_INFO_DIR = path.join(__dirname, "..", "artifacts", "build-info");

async function main() {
  const provider = ethers.provider;

  // 1. Load the build-info that compiled BotDCA.sol.
  const file = fs
    .readdirSync(BUILD_INFO_DIR)
    .find((f) => {
      const bi = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, f), "utf8"));
      return bi.input?.sources?.["contracts/BotDCA.sol"];
    });
  if (!file) throw new Error("build-info for contracts/BotDCA.sol not found");
  const bi = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, file), "utf8"));
  const input = bi.input;
  const solcVersion = `v${bi.solcLongVersion}`;
  const settings = input.settings ?? {};
  const runs = settings.optimizer?.runs ?? 200;
  console.log(`build-info: ${file}`);
  console.log(`solc: ${solcVersion} | optimizer runs: ${runs} | evm: ${settings.evmVersion ?? "default"}`);

  // 2. Sanity-check our compiled runtime against the live deployed bytecode.
  //    Immutable variables (router/wbot/v3Router/v3Factory) are zeroed in the artifact and
  //    baked in at deploy time, so mask them out of the on-chain copy before comparing.
  const IMMUTABLES = [
    "0xD6425a02f0845B8D99e349C34D2E7A576E177345", // V2 router
    "0xD5452816194a3784dBa983426cCe7c122F4abd30", // wbot
    "0x07032d47A1b9f8460cBeE9dC17c1d3E438693929", // V3 SwapRouter
    "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419", // V3 factory
  ];
  let onchainRuntime = ((await provider.getCode(DCA)).slice(2)).toLowerCase();
  for (const a of IMMUTABLES) {
    onchainRuntime = onchainRuntime.split(a.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("0".repeat(64));
  }
  const localRuntime = (
    bi.output?.contracts?.["contracts/BotDCA.sol"]?.BotDCA?.evm?.deployedBytecode?.object ?? ""
  ).toLowerCase();
  if (onchainRuntime !== localRuntime) {
    console.log("RUNTIME MISMATCH — aborting (do not submit)");
    let i = 0;
    while (i < onchainRuntime.length && onchainRuntime[i] === localRuntime[i]) i++;
    console.log(`  first diff at ${i} of ${onchainRuntime.length}`);
    process.exitCode = 1;
    return;
  }
  console.log(`deployed runtime matches on-chain (immutables masked) ✓ (${localRuntime.length} hex chars)`);

  // 3. Constructor args, ABI-encoded as 3 left-padded addresses.
  const args = IMMUTABLES.slice(0, 1).concat(IMMUTABLES.slice(2));
  const ctorArgs =
    "0x" + args.map((a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0")).join("");
  console.log(`constructor args: ${ctorArgs}`);

  // 4. Submit for verification.
  const params = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    codeformat: "solidity-standard-json-input",
    sourceCode: JSON.stringify(input),
    contractaddress: DCA,
    contractname: "contracts/BotDCA.sol:BotDCA",
    compilerversion: solcVersion,
    optimizationUsed: settings.optimizer?.enabled ? "1" : "0",
    runs: String(runs),
    evmversion: settings.evmVersion ?? "paris",
    constructorArguements: ctorArgs,
  });
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const submitted = (await res.json()) as any;
  console.log("submitted:", JSON.stringify(submitted));
  if (submitted.status !== "1") return;

  // 4. Poll until the explorer finishes.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = (await (await fetch(`${API}?module=contract&action=checkverifystatus&guid=${submitted.result}`)).json()) as any;
    console.log(`  [${i}] ${st.result}`);
    if (st.result && !st.result.includes("Pending")) break;
  }

  const final = (await (await fetch(`${API}/v2/smart-contracts/${DCA}`)).json()) as any;
  console.log(`\nis_verified: ${final.is_verified} | fully_verified: ${final.is_fully_verified}`);
  console.log(`name: ${final.name} | compiler: ${final.compiler_version}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
