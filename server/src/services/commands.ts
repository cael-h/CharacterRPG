export type ParsedCommand =
  | { kind: 'llm'; text: string }
  | { kind: 'npc'; name: string; text: string }
  | { kind: 'scene'; text: string };

export type ParsedMessage = {
  commands: ParsedCommand[];
  remainder: string;
};

// Very lightweight parser: recognizes leading slash commands at start of a new turn.
export function parseMessage(input: string): ParsedMessage {
  const commands: ParsedCommand[] = [];
  let rest = input.trim();
  while (rest.startsWith('/')) {
    const newline = rest.indexOf('\n');
    const firstLine = (newline === -1 ? rest : rest.slice(0, newline)).trim();
    const after = (newline === -1 ? '' : rest.slice(newline + 1)).trim();

    // /LLM ...
    if (/^\/LLM\b/i.test(firstLine)) {
      const text = firstLine.replace(/^\/LLM\s*/i, '').trim();
      commands.push({ kind: 'llm', text });
      rest = after;
      continue;
    }
    // /scene ...
    if (/^\/scene\b/i.test(firstLine)) {
      const text = firstLine.replace(/^\/scene\s*/i, '').trim();
      commands.push({ kind: 'scene', text });
      rest = after;
      continue;
    }
    // /<NPCName> ...
    if (/^\/[A-Za-z0-9_\-]+\b/.test(firstLine)) {
      const m = firstLine.match(/^\/([A-Za-z0-9_\-]+)\s*(.*)$/);
      if (m) {
        commands.push({ kind: 'npc', name: m[1], text: m[2] ?? '' });
        rest = after;
        continue;
      }
    }
    // Not a recognized command; break to avoid infinite loop
    break;
  }
  return { commands, remainder: rest };
}

