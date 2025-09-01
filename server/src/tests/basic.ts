import assert from 'assert';
import { parseMessage } from '../services/commands.js';

// Test parseMessage
{
  const m = parseMessage(`/LLM short replies\n/Olive hello\n/scene move to kitchen\nHi there`);
  assert.equal(m.commands.length, 3);
  assert.equal(m.remainder, 'Hi there');
}

// Ensure non-command passes through
{
  const m = parseMessage('Just talking');
  assert.equal(m.commands.length, 0);
  assert.equal(m.remainder, 'Just talking');
}

console.log('basic tests passed');

