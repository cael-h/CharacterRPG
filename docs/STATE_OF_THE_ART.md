# State of the Art — Q4 2025

Curated snapshot of AI capabilities that are directly relevant to CharacterRPG’s conversational, agentic, and retrieval goals. Refresh this document when major vendors or the open-source community ship notable changes.

## OpenAI

- **GPT‑5 family (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`)** — New flagship, value, and economy tiers with a shared tool ecosystem (structured output, vision, audio, video, code) and updated pricing that makes `gpt-5-mini` the practical baseline for high-quality RP turns, while `gpt-5-nano` covers budget or fallback use cases.
- **Responses API built-in tools** — Hosted search, file-search, code interpreter, browser automation, MCP connections, prompt caching, and streaming all land in a single endpoint that we can wrap for context retrieval without standing up extra services. Tool usage is billed per call, so we can budget search-heavy turns separately from generation.
- **AgentKit** — Visual agent builder, ChatKit UI components, evaluation harnesses, and the Connector Registry (Google Drive, Slack, Notion, etc.) provide a governed way to expand CharacterRPG’s reviewer or story-runner agents without bespoke orchestration code.
- **Apps SDK + MCP** — The Apps SDK (with IDE, CLI, and onboarding guide) lets us publish a CharacterRPG control surface straight into ChatGPT, while its Model Context Protocol compatibility keeps our tooling portable across hosts.

## Google / Gemini

- **Gemini 2.5 Flash / Flash-Lite / Pro** — 1 million token context windows, adaptive reasoning “thinking” controls, and API pricing that positions Flash-Lite as a low-cost alternative once we re-enable Gemini adapters.
- **Computer Use & Agent Mode** — Gemini 2.5’s native browser-control (Project Mariner + Agent Mode) enables scripted search or UI automation that could power NPC “research side quests.”
- **Enterprise & AI Mode discoverability** — Broader enterprise packaging and AI Mode search experiences would let lore or world-bible content surface through Google’s ecosystem if we decide to publish public-facing knowledge bases later.

## Open Source & Research Landscape

- **LangGraph & graph-based orchestration** — LangChain’s LangGraph (and new 101 course) formalize agent state machines, tool-routing, and streaming—useful for building CharacterRPG’s long-running search/memory agents with recoverable checkpoints.
- **Agentic Hybrid RAG (AgentFlow, AgentSwift, L‑MARS, RAG-Gym)** — Recent research explores multi-agent planners, look-ahead search, masked search-space pruning, and benchmarking environments; we can cherry-pick tactics like search-budget controllers or look-ahead scoring to improve memory consistency.

## How to Use This Document

1. **Tag adoption status** — Add ☑ / ☐ markers as we integrate (or defer) each capability.
2. **Link updates** — When adopting an item, cross-reference the relevant sections in `docs/ROADMAP.md` and `docs/IMPLEMENTATION_PLAN.md`.
3. **Review quarterly** — Revisit after major events (OpenAI Dev Day, Google I/O/Next, Open Source Summits) to capture ecosystem shifts and prune obsolete entries.
