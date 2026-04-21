# Claude Code context — Shop AI

## What this project is

A private single-user Next.js 15 web app that takes product images (uploaded manually in V1, scraped in V2) and restyles them using Google's Gemini 2.5 Flash Image model (Nano Banana). The purpose is to apply a consistent brand aesthetic to product photos imported from marketplaces like Temu, AliExpress, and Amazon.

The owner (Trex) will use this across multiple Shopify stores he builds. Each store = one JSON preset file. The AI model edits (not generates) images, preserving the actual product while swapping backgrounds, lighting, and mood.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS v3
- `@google/genai` SDK for Gemini API calls
- Password-gated via middleware + cookie (single user, no Supabase/DB yet)
- Deploys to Vercel
- File-based presets in `/presets/*.json` (no DB)

## Key architectural decisions

1. **Hierarchical prompt engine** (`src/lib/prompt-engine.ts`). Each image gets a prompt composed of: base brand aesthetic → collection mood → image role (hero/detail/lifestyle) → product-specific notes → negative prompt. This is the core value of the app.

2. **Image-to-image editing, not text-to-image generation.** We send the original product photo as input along with the prompt so Gemini edits rather than hallucinates a new product. Critical for e-commerce integrity.

3. **Presets are JSON files**, not DB rows. Version-controlled, easy to fork per store, zero infrastructure.

4. **No auth system** — just a shared password via `APP_PASSWORD` env var. This is a single-user tool.

## What's NOT here yet (planned V2/V3)

- Chrome Extension for scraping Temu/Ali/Amazon (necessary because server-side scrapers get blocked by Cloudflare)
- Shopify Admin API integration (note: Shopify changed auth in Jan 2026 — uses client credentials grant now, tokens are 24h and must be auto-refreshed)
- Background removal step before Gemini call (optional optimization using `@imgly/background-removal-node`)
- Persistence layer (SQLite or Supabase) for import history
- Batch queue (BullMQ + Redis) when scaling beyond handful of products

## Important context on Gemini API

- Model: `gemini-2.5-flash-image` (cheap, fast, ~$0.04/image). Alternative: `gemini-3-pro-image-preview` (better quality, more expensive)
- SDK: `@google/genai` (NOT the older `@google/generative-ai`)
- Image output comes back in `response.candidates[0].content.parts[].inlineData.data` as base64
- Free tier: ~1500 requests/day in Google AI Studio

## When helping Trex

- He speaks European Portuguese, prefers direct copy-paste-ready commands
- He uses Claude Code with Node 24, npm 11
- NEVER echo his API key in terminal output — if confirmation is needed, say only "key saved successfully"
- If an error mentions his key or password, redact before showing

## Setup flow

```bash
npm install
cp .env.example .env.local
# edit .env.local with Google AI API key and chosen password
npm run dev
```

Then open http://localhost:3000, log in, upload images, pick a preset, process.

## Deploy

Vercel via GitHub import. Set env vars in Vercel dashboard (`GOOGLE_AI_API_KEY`, `APP_PASSWORD`, optionally `GEMINI_IMAGE_MODEL`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `ANTHROPIC_KEY`).

Note: Use `ANTHROPIC_KEY` (not `ANTHROPIC_API_KEY`) because Claude Code overrides the latter in its own environment.
