export type ParsedCommand =
  | { kind: 'llm'; text: string }
  | { kind: 'npc'; name: string; text: string }
  | { kind: 'scene'; text: string }
  | { kind: 'addchar'; name: string; note?: string }
  | { kind: 'charupdate'; name?: string; note?: string }
  | { kind: 'reseed'; target?: 'prompts'|'profile'|'all' };

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
    // /addcharacter <Name> [note]
    if (/^\/addcharacter\b/i.test(firstLine)) {
      const m = firstLine.match(/^\/addcharacter\s+([^\s].*?)(?:\s+-\s*(.*))?$/i);
      if (m) { commands.push({ kind: 'addchar', name: m[1].trim(), note: m[2]?.trim() }); rest = after; continue; }
    }
    // /charupdate [Name] [note]
    if (/^\/charupdate\b/i.test(firstLine)) {
      const m = firstLine.match(/^\/charupdate(?:\s+([^\s].*?))?(?:\s+-\s*(.*))?$/i);
      if (m) { commands.push({ kind: 'charupdate', name: m[1]?.trim(), note: m[2]?.trim() }); rest = after; continue; }
    }
    // /reseed [prompts|profile|all]
    if (/^\/reseed\b/i.test(firstLine) || /^\/reread\b/i.test(firstLine)) {
      const m = firstLine.match(/^\/(?:reseed|reread)(?:\s+(prompts|profile|all))?$/i);
      const target = (m?.[1]?.toLowerCase() as 'prompts'|'profile'|'all') || 'all';
      commands.push({ kind: 'reseed', target });
      rest = after;
      continue;
    }
    // Not a recognized command; break to avoid infinite loop
    break;
  }
  return { commands, remainder: rest };
}
