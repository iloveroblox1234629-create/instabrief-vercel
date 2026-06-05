# InstaBrief Vercel

React + Tailwind version of InstaBrief with browser-local extraction and an optional Vercel API route for OpenRouter summaries.

Production: https://instabrief-vercel.vercel.app

## Environment

Set these in Vercel Project Settings, not in Git:

```sh
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/auto
```

`OPENROUTER_API_KEY` is used only by `api/summarize.js`.

The app still downloads a local Markdown fallback when the secret is missing or the OpenRouter request fails.

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

## Deployment

This repo is Vercel-ready. Push to GitHub, import the repo in Vercel or deploy with:

```sh
npx vercel --prod
```
