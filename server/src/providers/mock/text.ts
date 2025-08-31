// Mock provider that generates a simple multi-speaker JSON payload for offline dev

export async function mockTurn(system: string, user: string) {
  const names = (system.match(/Characters:\s*([^\.]+)/i)?.[1] ?? 'Narrator').split(',').map(s=>s.trim());
  const speaker = names[0] || 'Narrator';
  return {
    turns: [
      { speaker, text: `(${speaker}) Heard: ${user.slice(0, 160)}`, speak: true, emotion: 'neutral' }
    ]
  };
}

