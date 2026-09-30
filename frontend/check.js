// Ad-hoc: inspect live DCA positions and their execution history.
const { createPublicClient, http, parseAbi, formatEther, formatUnits } = require("viem");
const DCA = "0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895";
const c = createPublicClient({ transport: http("https://rpc.bohr.life") });
const abi = parseAbi([
  "function nextId() view returns (uint256)",
  "function positions(uint256) view returns (address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)",
  "function getExecutions(uint256) view returns ((uint256,uint256,uint256)[])",
]);
(async () => {
  const nextId = await c.readContract({ address: DCA, abi, functionName: "nextId" });
  console.log("nextId:", nextId.toString(), "\n");
  for (let i = 0n; i < nextId; i++) {
    const p = await c.readContract({ address: DCA, abi, functionName: "positions", args: [i] });
    const ex = await c.readContract({ address: DCA, abi, functionName: "getExecutions", args: [i] });
    console.log(`pos ${i}: owner=${p[0]}`);
    console.log(`  in=${p[1]} -> out=${p[2]} | perInt=${formatEther(p[3])} every=${p[4]}s x${p[5]}`);
    console.log(`  active=${p[11]} executed=${p[6]}/${p[5]} ACCRUED=${formatEther(p[9])} USDT/BOT`);
    console.log(`  history entries: ${ex.length}`);
    for (let j = ex.length - 1; j >= 0 && j >= ex.length - 3; j--) {
      const e = ex[j];
      const inT = p[1] === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? formatEther(e[1]) + " BOT" : formatUnits(e[1], 6) + " USDT";
      const outT = p[2] === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ? formatEther(e[2]) + " BOT" : formatUnits(e[2], 6) + " USDT";
      console.log(`    [${j}] ${inT} -> ${outT}`);
    }
    console.log();
  }
})();
