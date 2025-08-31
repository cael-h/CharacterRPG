# Billing, BYOK, and Usage Tracking

This app is BYOK-only (Bring Your Own Key). Each user supplies their own provider API keys; the app never stores keys on the server. Defaults focus on Gemini free-tier usage, with OpenAI supported as paid-only.

## Defaults
- Provider: `gemini`
- Model: `gemini-2.5-flash`
- Quick Switch: `gemini-2.5-flash-lite`
- OpenAI: supported, but always paid (no standing free tier). You can still set OpenAI keys and select paid models.

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
- Paid-only. You can select GPT models (e.g., full/mini/nano variants) and see a running cost estimate.
- If you prefer, set a hard “max spend per day/month” so the app blocks further OpenAI calls when exceeded.

## UX Notes
- When switching models due to limits, the chat shows a subtle banner (or toast):
  - “Free cap reached on 2.5 Flash. Switched to 2.5 Flash‑Lite.”
  - If policy is “Ask each time”, a modal offers: Switch | Keep model (Paid) | Cancel.
- The header chip always shows: Provider • Model • State (e.g., “Gemini • 2.5 Flash • Free”).

## Developer Notes
- We avoid server-stored keys to reduce risk. For server-mediated flows, the server runtime must avoid caching or logging request headers; add middleware to strip/redact `X-Provider-Key`.
- Usage Tracker is client-first to keep user privacy; optionally mirror anonymized counters server-side for debugging (off by default).

