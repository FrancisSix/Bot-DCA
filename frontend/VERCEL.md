# Vercel

This is a 3-package repo; only the dApp is deployed. The deploy target is **`frontend/`**.

## One-time project setting

In the Vercel project → **Settings → Build & Development Settings**:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend`  ← this is the fix |
| Framework Preset | Vite (auto) |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm ci` |

`frontend/vercel.json` already pins build/output/rewrites, so once **Root Directory = `frontend`** the build is correct and every route serves `index.html` (SPA rewrite).

## The 404 you're seeing

If Root Directory is left at the repo root, Vercel looks for `dist/` there — but the build output lives at `frontend/dist`, so there is no `index.html` and Vercel returns `404 NOT_FOUND`. Set Root Directory to `frontend` and redeploy.

## Redeploy

```bash
cd bot-dca/frontend
npx vercel --prod --force
```

or trigger a fresh deployment from the Vercel dashboard.

## Environment variables

`.env.example` is **not** read by Vite — it is only a template. With no Vercel
environment variables the build bakes in the safe defaults from
`frontend/src/lib/constants.ts` and `frontend/src/wagmi.ts` (the live testnet
contract `0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895` and `https://rpc.bohr.life`).

If you *do* set them in the Vercel project, they must be valid:

| Variable | Required value |
|---|---|
| `VITE_DCA_ADDRESS` | a real deployed address, e.g. `0x6eB819d09EfAF3Eb3ce52C4D6db3da6B2Fa37895` |
| `VITE_RPC_URL` | `https://rpc.bohr.life` |

> **Do not** leave `VITE_DCA_ADDRESS` empty or set it to the zero address.
> Vite inlines `VITE_*` values at build time, so an empty/zero value would make
> the app submit `createPosition` with no `to` target; the transaction is treated
> as a contract creation and always reverts. The code now rejects an empty, zero,
> or malformed value and falls back to the built-in testnet address, and the footer
> shows which contract is in use.

