# Free models for TallyBack

TallyBack runs on free tiers only. Its two AI jobs each walk a **chain** of free models until one
answers (`src/lib/models.ts`), skipping any provider the server has no key for. Free tiers get busy
and have daily caps, so the way to stay free *and* up is several free models in a row, not one.

The AI only reads and words. Every number the person sees comes from code (`checks.ts`,
`message.ts`), so a model is good enough when it **copies every printed number exactly**: a
misread number would become a false "you were overcharged".

## How they were picked

`Tallyback/scripts/bench-models.ts` runs each candidate through the same code the app uses:

- **Reading** the sample receipt. The candidate passes when the total is exact, all 13 line amounts are
  exact, and the checks then find nothing wrong (no false alarm).
- **Writing** the overcharge message. The candidate passes when it uses `{{placeholders}}` and no
  digits of its own.

```bash
npx tsx --env-file=.env.local Tallyback/scripts/bench-models.ts            # every candidate with a key
npx tsx --env-file=.env.local Tallyback/scripts/bench-models.ts vision gemini:gemini-3.5-flash-lite
```

### Results (8 Nov 2026, free tiers)

| Reading receipts | Passed | Time | Highlight boxes |
|---|---|---|---|
| `gemini:gemini-3.5-flash-lite` | 4/4 | 3.9–6.2 s | yes |
| `gemini:gemini-3.1-flash-lite` | 4/4 | 4.1–5.6 s | yes |
| `groq:qwen/qwen3.8-27b` | 3/4 (one malformed JSON) | 1.5–1.9 s | no |
| `gemini:gemini-3.5-flash` | 1/1 | 11.9 s | yes |
| `gemini:gemini-3.8-flash` (the old default) | 1/4 (timed out at 45 s three times) | 27.6 s when it answered | yes |
| `gemini:gemma-4-31b-it`, `gemma-4-26b-a4b-it` | 0/1 each (timed out; output cut off) | — | — |

| Writing messages | Passed | Time |
|---|---|---|
| `groq:openai/gpt-oss-20b` | yes | 0.9 s |
| `groq:openai/gpt-oss-120b` | yes | 0.6 s |
| `gemini:gemini-3.5-flash-lite` | yes | 0.9 s |
| `gemini:gemma-4-26b-a4b-it` | no (server error) | — |

On the real scan endpoint, a receipt now takes about 4–7 s instead of about 30 s.

## The default chains

| Job | Order (keyless providers are skipped) |
|---|---|
| Reading | Flash-Lite 3.5 → Flash-Lite 3.1 → Groq Qwen → OpenRouter Gemma 4 (free) → GitHub gpt-4.1-mini → Mistral Small → Flash 3.5 → Flash 3.8 |
| Writing | Groq gpt-oss-20b → Flash-Lite 3.5 → Groq gpt-oss-120b → Flash-Lite 3.1 → OpenRouter Gemma 4 (free) → GitHub gpt-4.1-mini → Mistral Small |

- Each Gemini model has its own free quota, so chaining several also means more free reads a day.
- Only Gemini models place highlight boxes on the photo. The others still read the receipt correctly;
  the review screen just shows no boxes.
- PDFs are read only by Gemini models (not Gemma); the chain skips the rest for PDFs.

Override either chain without code changes, e.g. in Vercel:

```
LLM_VISION_CHAIN=gemini:gemini-3.5-flash-lite,groq:qwen/qwen3.8-27b
LLM_TEXT_CHAIN=groq:openai/gpt-oss-20b,gemini:gemini-3.5-flash-lite
```

## More free providers (optional keys)

Each one adds more free capacity when Gemini and Groq are busy. Add a key and its models join the chain.
Run the benchmark after adding one, because free model lists change often.

| Provider | Variable(s) | Free tier, as reported Nov 2026 | Get a key |
|---|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | `:free` models: 20 requests/min, 50/day (1,000/day after a one-off $10 top-up). The free lineup rotates. | openrouter.ai/keys |
| GitHub Models | `GITHUB_MODELS_TOKEN` (a token with the `models` scope) | gpt-4.1-mini about 15 requests/min and 150/day, with input caps per request | github.com/settings/tokens |
| Mistral | `MISTRAL_API_KEY` | Free "Experiment" plan for prototyping; limits are shown in the console | console.mistral.ai |
| Cloudflare Workers AI | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | 10,000 "neurons" a day, shared across models. Not in the default chain; add it with `LLM_VISION_CHAIN`. | dash.cloudflare.com |

Claude has no free API tier, so it isn't in the chain.

Sources: [OpenRouter pricing](https://openrouter.ai/pricing),
[OpenRouter free tier limits](https://klymentiev.com/blog/openrouter-free-tier),
[GitHub Models free tier](https://freellm.net/providers/github-models),
[Mistral free tier](https://www.rapidevelopers.com/md/ai-api-limits-performance-matrix/mistral-large),
[Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/),
[Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
