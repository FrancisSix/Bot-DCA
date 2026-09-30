import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { formatUnits, parseEther, parseUnits, maxUint256 } from "viem";
import { BOT_DCA, NATIVE, USDT, WBOT, ROUTER, V3_FACTORY } from "./lib/constants";
import { BOT_DCA_ABI, ERC20_ABI, ROUTER_ABI, V3_ABI } from "./lib/abi";
import logo from "./logo.svg";
import botchainLogo from "./botchain-logo.png";

type Position = {
  id: number;
  owner: string;
  tokenIn: string;
  tokenOut: string;
  amountPerInterval: bigint;
  intervalSeconds: bigint;
  numIntervals: bigint;
  intervalsExecuted: bigint;
  lastExecutedAt: bigint;
  totalDeposited: bigint;
  accruedTokenOut: bigint;
  slippageBps: bigint;
  active: boolean;
  executions: { timestamp: bigint; amountIn: bigint; amountOut: bigint }[];
};

type Toast = { id: number; message: string; kind: "info" | "success" | "error" };

const FREQS: Record<string, string> = {
  "10": "Every 10 seconds",
  "30": "Every 30 seconds",
  "60": "Every minute",
  "3600": "Hourly",
  "86400": "Daily",
  "604800": "Weekly",
};

function tokenLabel(a: string) {
  if (a === NATIVE) return "BOT";
  if (a.toLowerCase() === USDT.toLowerCase()) return "USDT";
  if (a.toLowerCase() === WBOT.toLowerCase()) return "WBOT";
  return a.slice(0, 6) + "…";
}
function tokenDecimals(a: string) {
  return a.toLowerCase() === USDT.toLowerCase() ? 6 : 18;
}
function shortAddr(a?: string) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function trimAmount(s: string) {
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return "0";
  return n.toFixed(6).replace(/\.?0+$/, "");
}

function TokenIcon({ token, size = 20 }: { token: string; size?: number }) {
  const symbol = tokenLabel(token);
  const dims = { width: size, height: size, viewBox: "0 0 32 32" } as const;
  const clip = { flexShrink: 0, borderRadius: "50%" } as const;

  if (symbol === "USDT") {
    return (
      <svg {...dims} style={clip}>
        <circle cx="16" cy="16" r="16" fill="#26A17B" />
        <text
          x="16"
          y="21.5"
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill="#ffffff"
          fontFamily="'Segoe UI Symbol', 'Arial Unicode MS', 'Inter', sans-serif"
        >
          ₮
        </text>
      </svg>
    );
  }

  if (symbol === "BOT" || symbol === "WBOT") {
    const color = symbol === "BOT" ? "#10A37F" : "#0d8c6b";
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={clip}>
        <circle cx="12" cy="12" r="12" fill={color} />
        <path
          d="M9.83265 4.00092L17.2234 8.26405V11.3779C16.4895 11.717 15.7846 12.1368 15.0888 12.5506C14.9618 12.6265 14.7968 12.5354 14.8515 12.7897L17.216 14.0912L17.3222 17.0425L12.2807 20L7.3222 17.2168V14.1854L14.7322 18.5504V15.7006L9.83175 12.8509V9.8196L14.7322 12.6088V10.0021C14.7322 9.96678 14.903 9.86499 14.7412 9.76251L9.83175 6.84973V4L9.83265 4.00092Z"
          fill="#ffffff"
        />
      </svg>
    );
  }

  return (
    <svg {...dims} style={clip}>
      <circle cx="16" cy="16" r="16" fill="#3a3a44" />
      <text x="16" y="22" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="Inter, sans-serif">
        ?
      </text>
    </svg>
  );
}

export default function App() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [direction, setDirection] = useState<"in" | "out">("in"); // in = BOT -> USDT
  const [amount, setAmount] = useState("0.1");
  const [freq, setFreq] = useState("30");
  const [intervals, setIntervals] = useState("3");
  const [slippage, setSlippage] = useState("1.0");
  const [positions, setPositions] = useState<Position[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const { data: botBalance } = useBalance({ address, query: { refetchInterval: 15000 } });
  const { data: usdtRaw } = useReadContract({
    address: USDT,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
    query: { enabled: !!address, refetchInterval: 15000 },
  });
  // Market price from the BDEX V3 0.30% pool (deepest; matches explorer).
  const { data: v3Pool } = useReadContract({
    address: V3_FACTORY,
    abi: V3_ABI,
    functionName: "getPool",
    args: [WBOT, USDT, 3000],
    query: { refetchInterval: 15000 },
  });

  // V2 route price: what the contract actually gets when it executes.
  const { data: priceData } = useReadContract({
    address: ROUTER,
    abi: ROUTER_ABI,
    functionName: "getAmountsOut",
    args: [parseEther("1"), [WBOT, USDT]],
    query: { refetchInterval: 15000 },
  });

  // V3 pool internals -> market price (USDT per BOT).
  const { data: slot0 } = useReadContract({
    address: v3Pool as `0x${string}`,
    abi: V3_ABI,
    functionName: "slot0",
    query: { enabled: !!v3Pool, refetchInterval: 15000 },
  });
  const { data: token0 } = useReadContract({
    address: v3Pool as `0x${string}`,
    abi: V3_ABI,
    functionName: "token0",
    query: { enabled: !!v3Pool, refetchInterval: 15000 },
  });

  // USDT per BOT = (sqrtPriceX96^2 / 2^192), decimal-adjusted for token ordering.
  const marketPrice = useMemo(() => {
    if (!slot0 || !token0) return null;
    const sp = (slot0 as readonly unknown[])[0] as bigint;
    if (!sp) return null;
    const Q96 = 2n ** 96n;
    const raw = Number((sp * sp) / (Q96 * Q96));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const usdPerBot = token0.toLowerCase() === WBOT.toLowerCase() ? raw * 1e12 : (1 / raw) * 1e12;
    return Number.isFinite(usdPerBot) && usdPerBot > 0 ? usdPerBot : null;
  }, [slot0, token0]);

  const usdtBal = usdtRaw ? formatUnits(usdtRaw as bigint, 6) : "0";

  // Price the contract's V2 execution would actually get (1 BOT -> USDT).
  const routePrice = priceData ? Number((priceData as bigint[])[1]) / 1e6 : null;
  // Prefer the V3 market price; fall back to the V2 route quote if V3 is unavailable.
  const displayPrice = marketPrice ?? routePrice;
  const price = displayPrice != null ? displayPrice.toFixed(4) : "—";
  // Divergence between market and the V2 route the contract uses.
  const routePenalty =
    marketPrice != null && routePrice != null && marketPrice > 0
      ? (routePrice - marketPrice) / marketPrice
      : null;
  const routeWarning = routePenalty != null && routePenalty > 0.02;

  const load = useCallback(async () => {
    if (!publicClient || !address) return;
    setLoading(true);
    try {
      const nextId = (await publicClient.readContract({
        address: BOT_DCA,
        abi: BOT_DCA_ABI,
        functionName: "nextId",
      })) as bigint;
      const list: Position[] = [];
      for (let i = 0; i < Number(nextId); i++) {
        const raw = (await publicClient.readContract({
          address: BOT_DCA,
          abi: BOT_DCA_ABI,
          functionName: "positions",
          args: [BigInt(i)],
        })) as readonly [
          string, string, string, bigint, bigint, bigint, bigint, bigint,
          bigint, bigint, bigint, boolean,
        ];
        if (raw[0].toLowerCase() === address.toLowerCase()) {
          const exs =
            raw[6] > 0n
              ? ((await publicClient.readContract({
                  address: BOT_DCA,
                  abi: BOT_DCA_ABI,
                  functionName: "getExecutions",
                  args: [BigInt(i)],
                })) as readonly { timestamp: bigint; amountIn: bigint; amountOut: bigint }[])
              : [];
          list.push({
            id: i,
            owner: raw[0],
            tokenIn: raw[1],
            tokenOut: raw[2],
            amountPerInterval: raw[3],
            intervalSeconds: raw[4],
            numIntervals: raw[5],
            intervalsExecuted: raw[6],
            lastExecutedAt: raw[7],
            totalDeposited: raw[8],
            accruedTokenOut: raw[9],
            slippageBps: raw[10],
            active: raw[11],
            executions: exs.map((e) => ({
              timestamp: e.timestamp ?? 0n,
              amountIn: e.amountIn ?? 0n,
              amountOut: e.amountOut ?? 0n,
            })),
          });
        }
      }
      setPositions(list.reverse());
    } catch {
      /* ignore transient read errors */
    } finally {
      setLoading(false);
    }
  }, [publicClient, address]);

  useEffect(() => {
    if (isConnected) load();
  }, [isConnected, load]);

  useEffect(() => {
    if (!isConnected) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [isConnected, load]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const numIntervals = Math.max(1, Math.floor(Number(intervals) || 1));
  const amountNum = Number(amount || "0");
  const totalNum = amountNum * numIntervals;
  const total = totalNum.toString();

  const usdtPerBot = priceData ? Number((priceData as bigint[])[1]) / 1e6 : null;
  const estOutput =
    usdtPerBot && amountNum > 0
      ? direction === "in"
        ? amountNum * usdtPerBot
        : amountNum / usdtPerBot
      : null;
  const estOutputLabel = estOutput != null ? trimAmount(String(estOutput)) : null;

  const hasAddress = !!address;
  const balanceNum = direction === "in"
    ? Math.max(0, Number(botBalance?.formatted ?? "0") - 0.01)
    : Number(usdtBal);
  const insufficient = hasAddress && totalNum > balanceNum;
  const canCreate = hasAddress && amountNum > 0 && !insufficient;

  const slippageBps = Math.max(1, Math.min(1000, Math.round(Number(slippage || "0") * 100)));

  function usdOf(token: string, amount: number): number | null {
    if (amount <= 0) return null;
    if (token === "USDT") return amount;
    if (usdtPerBot == null) return null;
    return amount * usdtPerBot;
  }
  function fmtUsd(usd: number) {
    return usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2);
  }

  const depositUsd = usdOf(direction === "in" ? "BOT" : "USDT", totalNum);

  function setMax() {
    if (direction === "in") {
      const bal = botBalance?.value ?? 0n;
      const gas = parseEther("0.01");
      const usable = bal > gas ? bal - gas : 0n;
      setAmount(trimAmount(formatUnits(usable / BigInt(numIntervals), 18)));
    } else {
      const bal = (usdtRaw as bigint) ?? 0n;
      setAmount(trimAmount(formatUnits(bal / BigInt(numIntervals), 6)));
    }
  }

  function pushToast(message: string, kind: Toast["kind"]) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }

  async function run(action: () => Promise<`0x${string}`>, successMsg: string) {
    pushToast("Waiting for confirmation…", "info");
    try {
      const hash = await action();
      pushToast("Transaction submitted", "info");
      await publicClient!.waitForTransactionReceipt({ hash });
      pushToast(successMsg, "success");
      load();
    } catch (e: any) {
      // Surface the real reason so failures are diagnosable instead of a generic "failed".
      const rejected = e?.code === 4001 || String(e?.shortMessage || "").toLowerCase().includes("rejected");
      const reason =
        e?.shortMessage || e?.reason || e?.details || e?.message || String(e);
      console.error("[tx]", { fn: successMsg, error: e });
      pushToast(rejected ? "Transaction rejected" : `Failed: ${reason.slice(0, 140)}`, "error");
    }
  }

  async function create() {
    if (chain && chain.id !== 968) {
      pushToast(`Wrong network (chain ${chain.id}). Switch to BOT Chain Testnet (968).`, "error");
      return;
    }
    // Pre-flight: confirm a contract is actually deployed at the configured address,
    // otherwise the write targets an empty address and reverts for an opaque reason.
    try {
      const code = await publicClient?.getCode({ address: BOT_DCA });
      if (!code || code === "0x") {
        pushToast(
          `No DCA contract at ${BOT_DCA.slice(0, 10)}… on chain ${chain?.id ?? "?"} — check VITE_DCA_ADDRESS.`,
          "error"
        );
        return;
      }
    } catch {
      /* fall through; the write will surface any real error */
    }

    // Amount is denominated in the input token: BOT is 18dp, USDT is 6dp.
    const tokenIn = direction === "in" ? NATIVE : USDT;
    const tokenOut = direction === "in" ? USDT : NATIVE;
    const amt = parseUnits(amount || "0", tokenDecimals(tokenIn));
    const n = BigInt(numIntervals);
    run(
      () =>
        writeContractAsync({
          address: BOT_DCA,
          abi: BOT_DCA_ABI,
          functionName: "createPosition",
          args: [tokenIn, tokenOut, amt, BigInt(freq), n, BigInt(slippageBps)],
          value: tokenIn === NATIVE ? amt * n : 0n,
        }),
      "DCA position created"
    );
  }

  function approve() {
    run(
      () =>
        writeContractAsync({
          address: USDT,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [BOT_DCA, maxUint256],
        }),
      "USDT approved"
    );
  }

  function withdraw(id: number) {
    run(
      () => writeContractAsync({ address: BOT_DCA, abi: BOT_DCA_ABI, functionName: "withdraw", args: [BigInt(id)] }),
      "Withdrawal confirmed"
    );
  }

  function cancel(id: number) {
    run(
      () => writeContractAsync({ address: BOT_DCA, abi: BOT_DCA_ABI, functionName: "cancel", args: [BigInt(id)] }),
      "Position cancelled"
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner container">
          <div className="brand">
            <img src={logo} className="brand-mark" alt="BOT DCA logo" />
            <span>BOT <span className="grad-text">DCA</span></span>
          </div>
          <div className="header-right">
            <button
              className="btn btn-ghost btn-sm theme-toggle"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <span className={`net-badge ${chain?.id === 968 ? "ok" : "warn"}`}>
              {chain?.id === 968 ? "BOT Chain Testnet" : isConnected ? "Wrong network" : "Not connected"}
            </span>
            {!isConnected ? (
              <button className="btn btn-primary" onClick={() => connect({ connector: connectors[0] })}>
                Connect Wallet
              </button>
            ) : (
              <>
                <span className="addr">{shortAddr(address)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => disconnect()}>
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container content">
        {isConnected && chain && chain.id !== 968 && (
          <div className="banner">
            <span>
              You're on {chain.name ?? "an unsupported network"}. This dApp runs on BOT Chain Testnet.
            </span>
            <button onClick={() => switchChain({ chainId: 968 })}>Switch network</button>
          </div>
        )}

        <section className="hero">
          <h1>
            Dollar-cost averaging, <span className="grad-text">on autopilot</span>
          </h1>
          <p className="subtitle">
            Automate recurring buys on BOT Chain — 0.75s blocks, ~$0.06 gas, fully verifiable on-chain.
          </p>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">BOT price · live</span>
              <span className="stat-value">
                {price !== "—" ? `$${price}` : "—"} <span style={{ color: "var(--faint)", fontSize: 13, fontWeight: 500 }}>/ BOT</span>
              </span>
            </div>
            {routeWarning && (
              <div className="stat">
                <span className="stat-label">V2 route vs market</span>
                <span className="stat-value" style={{ color: "var(--amber)" }}>
                  +{(routePenalty! * 100).toFixed(1)}% worse
                </span>
              </div>
            )}
            <div className="stat">
              <span className="stat-label">Your positions</span>
              <span className="stat-value">{positions.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Gas per swap</span>
              <span className="stat-value">~$0.06</span>
            </div>
          </div>
        </section>

        <div className="layout">
          <section className="card">
            <h2 className="card-title">Create a DCA</h2>

            <div className="segmented">
              <button className={direction === "in" ? "active" : ""} onClick={() => setDirection("in")}>
                BOT → USDT
              </button>
              <button className={direction === "out" ? "active" : ""} onClick={() => setDirection("out")}>
                USDT → BOT
              </button>
            </div>
            <p className="dir-hint">
              {direction === "in"
                ? "Spend BOT periodically to build up USDT."
                : "Spend USDT periodically to build up BOT."}
            </p>

            <label className="field">
              <span className="field-label">Amount per interval</span>
              <div className="token-input">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.0"
                />
                <span className="token">
                  <TokenIcon token={direction === "in" ? NATIVE : USDT} size={16} />
                  {direction === "in" ? "BOT" : "USDT"}
                </span>
              </div>
              <span className="field-hint">
                {hasAddress
                  ? `Balance: ${direction === "in" ? `${botBalance?.formatted ?? "0"} BOT` : `${usdtBal} USDT`}`
                  : "Connect wallet to check balance"}{" "}
                {hasAddress && (
                  <button type="button" onClick={setMax}>MAX</button>
                )}
              </span>
            </label>

            <label className="field">
              <span className="field-label">Frequency</span>
              <select className="select" value={freq} onChange={(e) => setFreq(e.target.value)}>
                {Object.entries(FREQS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Number of intervals</span>
              <input
                className="input"
                value={intervals}
                onChange={(e) => setIntervals(e.target.value)}
                inputMode="numeric"
              />
            </label>

            <label className="field">
              <span className="field-label">Slippage tolerance</span>
              <div className="token-input">
                <input
                  value={slippage}
                  onChange={(e) => setSlippage(e.target.value)}
                  inputMode="decimal"
                />
                <span className="token">%</span>
              </div>
            </label>

            <p className="keeper-note">Keeper fee 0.1% · permissionless execution</p>

            <div className="summary">
              <span>Total deposit</span>
              <span className="summary-value">
                {total} {direction === "in" ? "BOT" : "USDT"}{" "}
                {depositUsd != null && <span className="usd">≈ ${fmtUsd(depositUsd)}</span>}
              </span>
            </div>

            {estOutputLabel && (
              <div className="summary">
                <span>Est. per interval</span>
                <span className="summary-value">≈ {estOutputLabel} {direction === "in" ? "USDT" : "BOT"}</span>
              </div>
            )}

            {insufficient && (
              <div className="insufficient-hint">
                Insufficient {direction === "in" ? "BOT" : "USDT"} balance for this deposit.
              </div>
            )}

            {direction === "out" ? (
              <div className="actions">
                <button className="btn btn-ghost" onClick={approve}>Approve USDT</button>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={!canCreate} onClick={create}>Create DCA</button>
              </div>
            ) : (
              <button className="btn btn-primary btn-block" disabled={!canCreate} onClick={create}>Create DCA</button>
            )}
          </section>

          <section>
            <div className="section-head">
              <h2>Your positions</h2>
              <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
            </div>

            {loading && positions.length === 0 ? (
              <div>
                {[0, 1, 2].map((i) => (
                  <div className="card position-card" key={i}>
                    <div className="skeleton-line" style={{ width: "40%" }} />
                    <div className="skeleton-line" style={{ width: "70%" }} />
                    <div className="skeleton-line" style={{ width: "100%" }} />
                  </div>
                ))}
              </div>
            ) : positions.length === 0 ? (
              <div className="empty">No positions yet. Create your first DCA to get started.</div>
            ) : (
              positions.map((p, i) => {
                const pct = p.numIntervals > 0n ? Number((p.intervalsExecuted * 100n) / p.numIntervals) : 0;
                const accAmt = Number(formatUnits(p.accruedTokenOut, tokenDecimals(p.tokenOut)));
                const accUsd = usdOf(tokenLabel(p.tokenOut), accAmt);
                const totalIn = p.executions.reduce((s, e) => s + e.amountIn, 0n);
                const totalOut = p.executions.reduce((s, e) => s + e.amountOut, 0n);
                const avgRate =
                  totalIn > 0n
                    ? Number(formatUnits(totalOut, tokenDecimals(p.tokenOut))) /
                      Number(formatUnits(totalIn, tokenDecimals(p.tokenIn)))
                    : null;
                return (
                  <div className="card position-card" key={p.id} style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="pos-head">
                      <span className="pos-id">Position #{p.id}</span>
                      <span className={`badge ${p.active ? "badge-active" : "badge-done"}`}>
                        {p.active ? "Active" : "Completed"}
                      </span>
                    </div>
                    <div className="pos-pair">
                      <TokenIcon token={p.tokenIn} />
                      {tokenLabel(p.tokenIn)} <span className="arrow">→</span>{" "}
                      <TokenIcon token={p.tokenOut} />
                      {tokenLabel(p.tokenOut)}
                    </div>
                    <div className="progress">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="pos-meta">
                      <span>{p.intervalsExecuted.toString()} / {p.numIntervals.toString()} intervals</span>
                      <span>{FREQS[p.intervalSeconds.toString()] ?? `${p.intervalSeconds.toString()}s`}</span>
                    </div>
                    <div className="pos-accrued">
                      Accumulated:{" "}
                      <b>
                        {accAmt.toFixed(4)} {tokenLabel(p.tokenOut)}
                      </b>
                      {accUsd != null && <span className="usd"> ≈ ${fmtUsd(accUsd)}</span>}
                    </div>

                    {avgRate != null && (
                      <div className="pos-avg">
                        Avg. rate: 1 {tokenLabel(p.tokenIn)} ≈ {avgRate.toFixed(4)} {tokenLabel(p.tokenOut)}
                      </div>
                    )}

                    {p.executions.length > 0 && (
                      <details className="history">
                        <summary>History ({p.executions.length})</summary>
                        <div className="history-list">
                          {[...p.executions].reverse().map((e, j) => (
                            <div className="history-row" key={j}>
                              <span>{new Date(Number(e.timestamp) * 1000).toLocaleString()}</span>
                              <span>
                                {Number(formatUnits(e.amountIn, tokenDecimals(p.tokenIn))).toFixed(4)}{" "}
                                {tokenLabel(p.tokenIn)} →{" "}
                                {Number(formatUnits(e.amountOut, tokenDecimals(p.tokenOut))).toFixed(4)}{" "}
                                {tokenLabel(p.tokenOut)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    <div className="pos-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={p.accruedTokenOut === 0n}
                        onClick={() => withdraw(p.id)}
                      >
                        Withdraw
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!p.active}
                        onClick={() => cancel(p.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <img src={logo} className="brand-mark" alt="" />
            <span>BOT DCA</span>
          </div>
          <div className="footer-links">
            <a href="https://dev-docs.botchain.ai" target="_blank" rel="noreferrer">Docs</a>
            <a href="https://scan.bohr.life" target="_blank" rel="noreferrer">Explorer</a>
            <a href="https://www.botchain.ai" target="_blank" rel="noreferrer">BOT Chain</a>
          </div>
          <div className="footer-note">
            <span>Built on</span>
            <a href="https://www.botchain.ai" target="_blank" rel="noreferrer" className="footer-powered">
              <img src={botchainLogo} alt="BOT Chain" />
            </a>
          </div>
        </div>
      </footer>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span className="toast-dot" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
