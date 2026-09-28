import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { BOT_DCA_ABI } from "./abi";

if (!config.dcaAddress) {
  throw new Error("Set DCA_ADDRESS in keeper/.env (address of the deployed BotDCA contract)");
}
if (!config.keeperPrivateKey) {
  throw new Error("Set KEEPER_PRIVATE_KEY in keeper/.env");
}

const account = privateKeyToAccount(config.keeperPrivateKey);
const publicClient = createPublicClient({ transport: http(config.rpcUrl) });
const walletClient = createWalletClient({ account, transport: http(config.rpcUrl) });

// Note: eth_getLogs is disabled on BOT Chain mainnet public RPC, so we poll
// `nextId()` / `isDue()` on-chain instead of subscribing to events.
const ids = new Set<number>();
let executed = 0;
let errors = 0;

async function refreshIds() {
  const nextId = await publicClient.readContract({
    address: config.dcaAddress,
    abi: BOT_DCA_ABI,
    functionName: "nextId",
  });
  for (let i = 0; i < Number(nextId); i++) ids.add(i);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function executeOne(id: number) {
  // Simulate first to catch reverts (e.g. transient slippage) cheaply.
  const { request } = await publicClient.simulateContract({
    address: config.dcaAddress,
    abi: BOT_DCA_ABI,
    functionName: "execute",
    args: [BigInt(id)],
    account,
  });
  const tx = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  return tx;
}

async function sweep() {
  for (const id of ids) {
    let due = false;
    try {
      due = await publicClient.readContract({
        address: config.dcaAddress,
        abi: BOT_DCA_ABI,
        functionName: "isDue",
        args: [BigInt(id)],
      });
    } catch {
      continue; // transient read error; retry next sweep
    }
    if (!due) continue;

    // Retry with exponential backoff on transient failures (e.g. RPC hiccups).
    let delay = 1000;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const tx = await executeOne(id);
        executed += 1;
        console.log(`[keeper] executed position ${id} (${tx})`);
        break;
      } catch {
        errors += 1;
        if (attempt < 3) {
          console.log(`[keeper] execute ${id} attempt ${attempt} failed, retrying in ${delay}ms`);
          await sleep(delay);
          delay *= 2;
        } else {
          console.log(`[keeper] execute ${id} failed after 3 attempts`);
        }
      }
    }
  }
}

function heartbeat() {
  console.log(`[keeper] heartbeat — positions=${ids.size} executed=${executed} errors=${errors}`);
}

async function main() {
  console.log(`[keeper] starting — chain ${config.chainId}, DCA ${config.dcaAddress}`);
  await refreshIds();
  setInterval(refreshIds, config.refreshIntervalMs);
  setInterval(sweep, config.sweepIntervalMs);
  setInterval(heartbeat, 60_000);
  heartbeat();
}

main().catch(console.error);
