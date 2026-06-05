# InstaBrief Vercel

React + Tailwind version of InstaBrief with browser-local extraction and an optional Vercel API route for OpenRouter summaries.

## Environment

Set these in Vercel Project Settings, not in Git:

```sh
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openrouter/auto
```

`OPENROUTER_API_KEY` is used only by `api/summarize.js`.

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
