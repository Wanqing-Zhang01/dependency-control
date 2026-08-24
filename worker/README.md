# Dependency Control — AI Coach Worker

A Cloudflare Worker that proxies between the Gantt dependency tool
frontend and the Gemini API. It holds the Gemini API key as a Worker
secret, rate-limits by IP, and evaluates each submission independently
(no conversation memory).

This step is **proxy-only** — nothing in the frontend (`index.html`,
`style.css`, `script.js`) calls this Worker yet.

## What it expects

`POST /` with a JSON body:

```json
{
  "dependencyType": "finish-to-start",
  "lag": -2,
  "legalStart": 4,
  "legalEnd": 7,
  "launchDay": 8,
  "deadlineMet": true,
  "daysOverBy": 0,
  "learnerReasoning": "I set the lag to -2 days..."
}
```

It returns:

```json
{
  "feedback": "...Gemini's coaching response...",
  "declined": false,
  "rateLimit": { "remaining": 9, "resetAt": 1732471200000 }
}
```

`declined` is `true` when the learner's `learnerReasoning` wasn't a
genuine attempt to explain their scheduling decision (a non-answer, a
request for the answer, a prompt-injection attempt, etc.) — in that
case `feedback` is only the coach's decline/redirect message, and no
schedule evaluation happened. This is a real field Gemini itself sets
(via a JSON response schema on the API call), not something inferred
by pattern-matching the reply text. Callers should not count a
`declined: true` response as a genuine evaluation attempt.

or, on failure, `{ "error": "...", "detail"?: "..." }` with an
appropriate status code (400 invalid input, 429 rate-limited, 500/502
server or upstream error).

## Deploy it

From `worker/`:

1. **Install dependencies**
   ```
   npm install
   ```

2. **Log in to Cloudflare** (opens a browser to authorize; alternatively
   set `CLOUDFLARE_API_TOKEN` in the environment for non-interactive auth)
   ```
   npx wrangler login
   ```

3. **Create the KV namespace used for rate limiting**
   ```
   npx wrangler kv namespace create RATE_LIMIT_KV
   npx wrangler kv namespace create RATE_LIMIT_KV --preview
   ```
   Copy the `id` and `preview_id` each command prints into
   `wrangler.toml`, replacing the `REPLACE_WITH_...` placeholders.

4. **Set the Gemini API key as a secret** (you'll be prompted to paste
   it; it is never written to the repo or to `wrangler.toml`)
   ```
   npx wrangler secret put GEMINI_API_KEY
   ```

5. **Deploy**
   ```
   npx wrangler deploy
   ```
   This prints the Worker's live URL, e.g.
   `https://dependency-control-coach.<your-subdomain>.workers.dev`.

## Test it directly

```bash
WORKER_URL="https://dependency-control-coach.<your-subdomain>.workers.dev"

# Miss case
curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "dependencyType": "finish-to-start",
    "lag": 0,
    "legalStart": 6,
    "legalEnd": 9,
    "launchDay": 10,
    "deadlineMet": false,
    "daysOverBy": 2,
    "learnerReasoning": "I fixed the Legal review so it happens after design finishes."
  }'

# Success case
curl -s -X POST "$WORKER_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "dependencyType": "finish-to-start",
    "lag": -2,
    "legalStart": 4,
    "legalEnd": 7,
    "launchDay": 8,
    "deadlineMet": true,
    "daysOverBy": 0,
    "learnerReasoning": "I set the lag to -2 days so Legal starts reviewing early batches while still finishing after Design wraps up."
  }'
```

## Notes / things to revisit before wiring up the frontend

- `ALLOWED_ORIGIN` in `wrangler.toml` is `"*"` for now (no frontend is
  deployed yet). Once the frontend has a real URL, narrow this to that
  origin.
- `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite` and can be changed
  in `wrangler.toml` without touching code, in case the exact model ID
  needs adjusting after live testing.
- Rate limiting uses a Workers KV fixed window (10 req/hour/IP). KV
  writes are eventually consistent, not atomic — under heavy concurrent
  requests from the *same* IP a few extra could slip through. Fine at
  this tool's scale; a Durable Object would be the fix if that ever
  matters.
- Local dev: `npm run dev` runs `wrangler dev`, which needs the same KV
  namespace + secret set up (wrangler will prompt to create a local/dev
  version as needed).
