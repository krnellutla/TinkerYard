# Review Scout

Type a product you're deciding on. Review Scout finds YouTube reviews, reads the transcripts, and summarises them so that every claim links to the channel and the moment in the video. Then ask follow-ups about the same videos.

Next.js rewrite of the course's Gradio app (100xEngineers C8, "Replay Before You Render").

## Run
Review Scout is a module of the Tinkeryard app: run everything from the repo root.
```bash
cp .env.example .env.local   # GEMINI_API_KEY; GROQ_API_KEY and DATABASE_URL optional
npm install
npm run dev                  # http://localhost:3000/reviewscout
npm test                     # caption parsing and conversation turns (+ TallyBack's)
npm run build
```
With no AI key, a search lists the videos it collected instead of a summary. Without `DATABASE_URL`, searches go to `.data/reviewscout.json`.

## Environment
| Variable | Needed | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Writes the summary and answers |
| `GEMINI_MODEL` | no | Default `gemini-3.8-flash`; falls back to `gemini-3.5-flash`, then `gemini-flash-latest` |
| `GROQ_API_KEY` | no | Backup when Gemini fails or is busy |
| `GROQ_TEXT_MODEL` | no | Default `openai/gpt-oss-20b` |
| `DATABASE_URL` | no | Neon Postgres. The `scout_searches` table is created on first use |

## How it works
INPUT → PROCESS → OUTPUT, as in the original:

| Step | What happens | File |
|---|---|---|
| Input | The product question, how many videos (2–8), and whether to read top comments | `src/ui/Home.tsx`, served by `app/(apps)/reviewscout/page.tsx` |
| Process 1 | Search YouTube for "‹question› review", read each video's captions (and top comments) at the same time. No API key | `src/api/searches.ts` (at `/api/reviewscout/searches`), `src/lib/youtube.ts`, `captions.ts` |
| Process 2 | Save the search with its transcripts, so follow-ups never ask YouTube again | `src/lib/store.ts` |
| Process 3 | Summarise, or answer a follow-up, using only the transcripts: Gemini, then Groq | `src/api/ask.ts`, `src/lib/llm.ts`, `prompts.ts`, `turns.ts` |
| Output | The cited chat; every citation opens the video at that timestamp. Past searches reopen from the list | `src/ui/Home.tsx`, `Markdown.tsx` |

Transcripts come from the caption tracks YouTube lists for its phone apps (the web client hides them). YouTube sometimes blocks these requests from cloud servers; a blocked video shows as skipped.

Known issue carried over: some citations land on a round minute, because the transcript carries a time marker about once a minute.
