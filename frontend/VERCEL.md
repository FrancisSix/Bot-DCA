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

or trigger a fresh deployment from the Vercel dashboard. No environment variables are required — the two `VITE_*` values (DCA contract address, RPC URL) are public and already baked into `frontend/.env.example`.
