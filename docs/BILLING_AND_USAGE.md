# Billing, BYOK, and Usage Tracking

This app is BYOK-only (Bring Your Own Key). Each user supplies their own provider API keys; the app never stores keys on the server. Defaults now target OpenAI’s `gpt-5-mini` for inexpensive, high-quality testing, with Gemini and other providers remaining opt-in alternates.

## Defaults
- Provider: `openai`
- Model: `gpt-5-mini`
- Quick Switch: `gpt-5-nano`
- Gemini remains available as an alternate free-tier option; we will re-enable Gemini defaults after OpenAI wiring is stable.

## Where Keys Live
- Client: Android Keystore (via RN Keychain). Not synced; removable by clearing app data.
- Server: never persisted. For endpoints that must call providers, the client includes `X-Provider` and `X-Provider-Key` headers per request.
- Logs: keys are redacted; headers are scrubbed.

## Usage Tracker (Client)
- Tracks per-model metrics: requests, input tokens, output tokens, last reset timestamp, last error, cooldown timers.
- Derives a state per model:
  - Free OK
  - Near Limit
  - Rate-limited (cooldown running)
  - Over Free Cap (switch or pay)
  - Paid (only after explicit consent)
- Resets use heuristics (e.g., daily/monthly windows). When the provider responds with 429/quota errors, the tracker adjusts windows and shows accurate cooldowns.

## Policies (Settings)
- Default model behavior when a free limit is hit:
  - Auto-switch to the other free model, or
  - Prompt each time, or
  - Continue as paid on the same model (requires explicit consent and optional monthly spend cap).
- Rate-limit handling:
  - Show timer until retry; allow “wait” or “switch now”.
- Indicators: active provider/model chip; free vs paid badge; progress bars for daily/monthly windows; running cost estimate.

## Cost Estimation
- The app maintains a versioned price table (per provider/model) to estimate costs from token counts.
- Estimates may differ from actual billing; shown as “Estimated”.
- For models with changing prices, update the table in-app (we’ll store it in config and allow an in-app update with confirmation).

## OpenAI
- Primary default. `gpt-5-mini` offers strong conversational quality at ~$0.25 / 1M input tokens and $2 / 1M output; `gpt-5-nano` is the budget fallback at ~$0.05 / $0.40.
- Set a “max spend per day/month” so the app blocks further OpenAI calls when exceeded; Gemini/other providers remain available when you want to avoid paid usage entirely.

## UX Notes
- When switching models due to limits, the chat shows a subtle banner (or toast):
  - “Daily budget hit on GPT‑5 Mini. Switched to GPT‑5 Nano.”
  - If policy is “Ask each time”, a modal offers: Switch | Keep model (Paid) | Cancel.
- The header chip always shows: Provider • Model • State (e.g., “Gemini • 2.5 Flash • Free”).

## Developer Notes
- We avoid server-stored keys to reduce risk. For server-mediated flows, the server runtime must avoid caching or logging request headers; add middleware to strip/redact `X-Provider-Key`.
- Usage Tracker is client-first to keep user privacy; optionally mirror anonymized counters server-side for debugging (off by default).
