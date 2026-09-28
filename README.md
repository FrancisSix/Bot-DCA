# bot-dca

[![CI](https://github.com/FrancisSix/Bot-DCA/actions/workflows/ci.yml/badge.svg)](https://github.com/FrancisSix/Bot-DCA/actions/workflows/ci.yml)

Permissionless dollar-cost averaging on BOT Chain (EVM L1, 0.75s blocks, ~$0.06 gas).

A user escrows a `BOT`/`USDT` budget in `BotDCA.sol`. A permissionless keeper swaps
`amountPerInterval` of `tokenIn` every `intervalSeconds` until the budget is spent.
Every swap is recorded on-chain and readable via `getExecutions(id)`.

Contract (testnet): [`0x71D3E22e60Fa9f6f2d6A3347c7Bb49D25da9FA98`](https://scan.bohr.life/address/0x71D3E22e60Fa9f6f2d6A3347c7Bb49D25da9FA98?tab=contract) · chain `968` (`https://rpc.bohr.life`).

## Problem

- Manual DCA requires discipline, and users routinely miss cadence, drifting their average price.
- Centralized "auto-invest" holds user funds and hides execution.
- On-chain schedules still need a trigger; a single designated executor is a single point of failure.
- Without per-interval records, users cannot verify what price they received or when.

## Solution

`BotDCA.sol` is a self-contained DCA primitive:

- Budget escrowed at creation — no custody beyond the user's own deposit.
- `execute(id)` is permissionless — anyone can run a due interval.
- `keeperFeeBps` (0.1%) pays whoever executes — the network funds its own automation.
- `minOut` derived on-chain (`getAmountsOut` → `slippageBps` ceiling) — keeper can't push worse-than-ceiling fills.
- Every swap appended to `Execution[]` — readable from `getExecutions(id)`, no indexer required.
- `executeWithPath(id, path)` accepts a multi-hop V2 route with endpoint checks.
- Low gas makes small, frequent buys viable (~$0.06/tx vs $1-5 on L1s).

## Architecture

```
bot-dca/
├── contracts/          Solidity + Hardhat
│   ├── contracts/      BotDCA.sol, IUniswapV2Router02, mocks/
│   ├── scripts/        deploy.ts, smoke.ts, e2e.ts
│   └── test/           BotDCA.ts (9 tests)
├── keeper/             Node + viem bot, polls isDue
└── frontend/           Vite + React + wagmi dApp
```

Frontend -> BotDCA.sol: createPosition / withdraw / cancel (write), positions / getExecutions (read)
Keeper   -> BotDCA.sol: isDue (read), execute (write)
BotDCA   -> BDEX V2 Router: swapExactTokensForTokens / swapExactETHForTokens / swapExactTokensForETH

## Contract API

`createPosition(tokenIn, tokenOut, amountPerInterval, intervalSeconds, numIntervals, slippageBps)`
: Opens a position, escrowing `amountPerInterval * numIntervals` of `tokenIn`. `tokenIn`/`tokenOut` are ERC-20 or native BOT (`0xEeee...EEeE`). Subsequent executions and deposits are strictly exact-in; use the frontend estimate during quote confirmation if you rebroadcast.

`execute(id)` / `executeWithPath(id, path)`
: Runs one due interval. Attaches `keeperFeeBps` of the `tokenOut` proceeds; stores `Execution{timestamp, amountIn, amountOut}`. `executeWithPath` validates `path` endpoints (WBOT for native legs) before swapping.

`withdraw(id)` / `cancel(id)`
: Withdraw accrued `tokenOut` (owner only) / cancel and refund remaining `tokenIn` plus accrued `tokenOut` (owner only, active positions only).

`isDue(id)` / `preview(id)` / `positions(id)` / `getExecutions(id)` / `nextId`
: Read helpers for scheduler decisions, UI display, full position struct, full execution history, and the next position id.

Admin (owner): `setMinInterval` · `setMaxIntervals` · `setMaxSlippageBps` · `setKeeperFeeBps` · `setPaused`


Contract verified with `contracts/BotDCA.sol:BotDCA`, `solc 0.8.20+commit.a1b79de6`, optimizer on (200 runs), `evmVersion: paris`. Testnet constructor arg: V2 Router `0xD6425a02f0845B8D99e349C34D2E7A576E177345`.

Live admin settings on the deployed contract: `minInterval = 10s`, `keeperFeeBps = 10` (0.1%), `maxSlippageBps = 1000` (10%).

Testnet assets:

- USDT (6dp): `0x75edC9335175Fc0552D51D48439F229c10420fe3`
- WBOT (18dp): `0xD5452816194a3784dBa983426cCe7c122F4abd30`
- V2 Router02: `0xD6425a02f0845B8D99e349C34D2E7A576E177345`
- Faucet: https://faucet.botchain.ai/basic (10 tBOT / 24h)

## Notes

- **Reentrancy**: every state-moving method is `nonReentrant`; state is updated before external transfers.
- **No custody**: users can always `withdraw` / `cancel`; contract holds only the user's escrowed budget.
- **Keeper is replaceable**: frontend and keeper are conveniences; any address can call `execute` from an explorer.
- **Fee-on-transfer tokens** out of scope for v1 (supported only via V2 router mechanics; standard `BOT`/`WBOT`/`USDT` used).
- **Ordering**: one interval per `execute` call; a keeper that is down for N intervals can catch up by looping `execute`.

## Run

Prereqs: Node.js >= 20, npm >= 10. Each package has a matching `.env.example`.

```bash
npm --prefix contracts install
npm --prefix keeper install
npm --prefix frontend install

cp contracts/.env.example contracts/.env   # PRIVATE_KEY
cp keeper/.env.example keeper/.env         # KEEPER_PRIVATE_KEY (+ DCA_ADDRESS)
cp frontend/.env.example frontend/.env     # VITE_DCA_ADDRESS
```

Tests (9 passing):

```bash
cd contracts && npx hardhat test
```

Read-only pair health:

```bash
cd contracts && npx hardhat run scripts/smoke.ts --network botchain-testnet
```

Deploy your own contract:

```bash
cd contracts && npx hardhat run scripts/deploy.ts --network botchain-testnet
```

Then point `keeper/.env` (`DCA_ADDRESS`) and `frontend/.env` (`VITE_DCA_ADDRESS`) at it.

Full lifecycle on live testnet (deploy/create/execute/withdraw):

```bash
cd contracts && npx hardhat run scripts/e2e.ts --network botchain-testnet
```

Keeper:

```bash
cd keeper && npm run start
```

Polls `isDue`, retries with backoff, logs a 60s heartbeat (`positions / executed / errors`).

Frontend:

```bash
cd frontend && npm run dev   # http://localhost:5173
```

Testnet wallets: use faucet tBOT (10/24h). Chain `968`, RPC `https://rpc.bohr.life`.

## CI

`.github/workflows/ci.yml` — on every push/PR to `main` (concurrency-cancelled, `contents: read`):

| Job | Gate |
|---|---|
| `contracts` | `hardhat compile` + `hardhat test` (9 tests) |
| `keeper` | `tsc --noEmit` |
| `frontend` | `tsc --noEmit` + `vite build` |
| `testnet-smoke` | keyless `smoke.ts` against testnet — asserts RPC, router/WBOT/USDT, live quote, and the deployed contract's `nextId` / admin settings / position history |

Contracts typecheck is not a separate job (Hardhat runs TS in transpile mode for tests); the test run is the gate. Dependabot (`.github/dependabot.yml`) opens grouped weekly updates for `contracts`/`keeper`/`frontend` and GitHub Actions.

## Deploy the frontend

The dApp is a static Vite build. `frontend/vercel.json` pins the framework, build (`npm run build`), output (`dist`), and SPA rewrites.

```bash
cd frontend
npx vercel login          # authenticate yourself
npx vercel                # preview
npx vercel --prod         # production
```

Or import the repo in the Vercel dashboard: root directory `frontend`, framework preset Vite, output `dist`. The two `VITE_*` values (contract address, RPC URL — both public) come from `frontend/.env.example`; no secrets are required, and `contracts/.env` / `keeper/.env` are never in the frontend build. Point `VITE_DCA_ADDRESS` at whichever deployment the UI should read.

Deploying is safe to do without the keeper or deployer keys — the frontend only reads public chain state.

## Status

Testnet-scoped. Not audited. Admin functions (`setMinInterval`, `setKeeperFeeBps`, `setPaused`) are currently single-key owner; move to multisig before mainnet. `keeperFeeBps` encourages third-party execution but does not guarantee liveness; run your own keeper in production.

## License

MIT
