# Multiplicity Reconciliation OpenAI Proxy

This Cloudflare Worker keeps the OpenAI API key out of the GitHub Pages frontend. The browser calls `POST /negotiate`; the Worker reads `OPENAI_API_KEY` from a Cloudflare secret and calls the OpenAI Responses API.

## Node version

Wrangler 4 requires Node.js 22 or newer. If your system Node is older, run Wrangler through a temporary Node 22 package:

```bash
npx -p node@22 -p wrangler@4.107.0 wrangler --version
```

## Local development

```bash
cd worker
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste your real key locally only
npx -p node@22 -p wrangler@4.107.0 wrangler dev
```

## Deploy

```bash
cd worker
npx -p node@22 -p wrangler@4.107.0 wrangler secret put OPENAI_API_KEY
npx -p node@22 -p wrangler@4.107.0 wrangler deploy
```

After deploy, open the frontend once with:

```text
https://yvonnefanf.github.io/MultiplicityReconciliation/?proxy=https://multiplicity-reconciliation-proxy.yifan-multiplicity.workers.dev/negotiate
```

The frontend stores that Worker URL in `localStorage`. The API key is never stored in `index.html`, `data/*.json`, or GitHub Pages.
