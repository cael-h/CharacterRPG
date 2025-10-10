import { createServer, ToolContext } from '@modelcontextprotocol/sdk/server';

const config = {
  apiBase: process.env.CRPG_API_BASE || 'http://localhost:4000',
};

const server = createServer({
  name: 'CharacterRPG Companion',
  version: '0.1.0',
});

server.tool('listCharacters', {
  title: 'List characters',
  description: 'Returns the available characters from the CharacterRPG server.',
  handler: async (_args, ctx) => requestJSON(`${config.apiBase}/api/characters`, ctx),
});

server.tool('sessionTelemetry', {
  title: 'Session telemetry',
  description: 'Retrieves retrieval/usage telemetry for a session.',
  inputSchema: {
    type: 'object',
    properties: { sessionId: { type: 'string' } },
    required: ['sessionId'],
  },
  handler: async (args: { sessionId: string }, ctx) =>
    requestJSON(`${config.apiBase}/api/usage/${encodeURIComponent(args.sessionId)}`, ctx),
});

server.tool('startSession', {
  title: 'Start session',
  description: 'Creates a new session with the provided participants.',
  inputSchema: {
    type: 'object',
    properties: {
      participants: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of character IDs to include in the session.',
      },
      provider: { type: 'string', default: 'openai' },
      title: { type: 'string', default: 'Scene' },
    },
    required: ['participants'],
  },
  handler: async (args: { participants: string[]; provider?: string; title?: string }, ctx) =>
    requestJSON(`${config.apiBase}/api/sessions`, ctx, {
      method: 'POST',
      body: JSON.stringify({
        title: args.title || 'Scene',
        provider: args.provider || 'openai',
        participants: args.participants.map((id) => ({ id })),
      }),
    }),
});

server.tool('sendTurn', {
  title: 'Send turn',
  description: 'Posts a turn to an active session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      playerText: { type: 'string' },
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            system_prompt: { type: 'string' },
          },
          required: ['name'],
        },
      },
      provider: { type: 'string', default: 'openai' },
      model: { type: 'string', default: 'gpt-5-mini' },
      useRag: { type: 'boolean', default: true },
      styleShort: { type: 'boolean', default: true },
    },
    required: ['sessionId', 'playerText', 'characters'],
  },
  handler: async (
    args: {
      sessionId: string;
      playerText: string;
      characters: Array<{ name: string; system_prompt?: string }>;
      provider?: string;
      model?: string;
      useRag?: boolean;
      styleShort?: boolean;
    },
    ctx,
  ) =>
    requestJSON(`${config.apiBase}/api/convo/turn`, ctx, {
      method: 'POST',
      body: JSON.stringify({
        session_id: args.sessionId,
        player_text: args.playerText,
        characters: args.characters,
        provider: args.provider || 'openai',
        model: args.model || 'gpt-5-mini',
        useRag: args.useRag !== false,
        style_short: args.styleShort !== false,
      }),
    }),
});

server.tool('reseedPrompts', {
  title: 'Reseed prompts/profile',
  description: 'Triggers a /reseed all command in the current session.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, system_prompt: { type: 'string' } },
          required: ['name'],
        },
      },
      provider: { type: 'string', default: 'openai' },
      model: { type: 'string', default: 'gpt-5-mini' },
    },
    required: ['sessionId', 'characters'],
  },
  handler: async (
    args: {
      sessionId: string;
      characters: Array<{ name: string; system_prompt?: string }>;
      provider?: string;
      model?: string;
    },
    ctx,
  ) =>
    requestJSON(`${config.apiBase}/api/convo/turn`, ctx, {
      method: 'POST',
      body: JSON.stringify({
        session_id: args.sessionId,
        player_text: '/reseed all',
        characters: args.characters,
        provider: args.provider || 'openai',
        model: args.model || 'gpt-5-mini',
      }),
    }),
});

function buildHeaders(ctx: ToolContext) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = ctx.secrets?.get('openai_key');
  if (key) headers['X-Provider-Key'] = key;
  return headers;
}

async function requestJSON(url: string, ctx: ToolContext, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...buildHeaders(ctx),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }
  return res.json();
}

server.start();
