import assert from 'assert';
import { stripThink, stripFences, tryParse, extractJsonWithTurns } from '../providers/ollama/text.ts';

// Think block removal
{
  const input = '<think>reasoning here</think>{"turns":[{"speaker":"Olive","text":"Hi","speak":true}] }';
  const out = stripThink(input);
  assert(!out.includes('<think>'));
}

// Code fence removal
{
  const input = '```json\n{"turns":[{"speaker":"Olive","text":"Hi","speak":true}]}\n```';
  const out = stripFences(input);
  assert(out.startsWith('{'));
}

// tryParse success/fail
{
  assert(tryParse('{"turns":[]}'));
  assert.strictEqual(tryParse('{"notTurns":[]}'), null);
}

// end-to-end extraction with extra chatter
{
  const messy = '<think>stuff</think>\nHere is your answer:\n```json\n{"turns":[{"speaker":"Olive","text":"Hello","speak":true}]}\n```\nAnd that\'s it.';
  const obj = extractJsonWithTurns(messy);
  assert(obj && Array.isArray(obj.turns) && obj.turns[0].speaker === 'Olive');
}

console.log('ollama_parsing tests passed');
