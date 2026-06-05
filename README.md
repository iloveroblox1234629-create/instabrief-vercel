# InstaBrief Vercel

React + Tailwind version of InstaBrief with browser-local extraction and an optional Vercel API route for OpenRouter summaries.

Production: https://instabrief-vercel.vercel.app

## Summary Modes

- Server-side: uses `OPENROUTER_API_KEY` from Vercel environment variables.
- Client-side: uncheck server-side summaries in the UI and paste a temporary OpenRouter key. The key stays in browser memory for that tab and is sent directly to OpenRouter.
- Local fallback: when no key is available, the app can generate a local Markdown file. When an AI request fails, the app asks before downloading the local fallback.

## Environment

Set these in Vercel Project Settings, not in Git:

```sh
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-oss-120b:free
```

`OPENROUTER_API_KEY` is used only by `api/summarize.js`.

The app offers a local Markdown fallback when the secret is missing or the OpenRouter request fails.

To set the secret with the Vercel CLI:

```sh
vercel env add OPENROUTER_API_KEY production
vercel env add OPENROUTER_MODEL production
vercel --prod
```

## Local Development

```sh
npm install
npm run dev
```

`npm run dev` starts only the Vite frontend. To test the server-side `/api/summarize` route locally, use Vercel's local runtime instead:

```sh
npx vercel dev
```

## Deployment

This repo is Vercel-ready. Push to GitHub, import the repo in Vercel or deploy with:

```sh
npx vercel --prod
```
