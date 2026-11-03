import assert from 'node:assert/strict';
import test from 'node:test';
import { checklistKey, checklistLines, type ChecklistState } from '../src/config/terminal-prompt';

const start: ChecklistState = { cursor: 0, checked: [true, true, false] };

test('the checklist moves with up/down and j/k, wrapping at both ends', () => {
  assert.deepEqual(checklistKey(start, { name: 'up' }), { ...start, cursor: 2 });
  assert.deepEqual(checklistKey(start, { name: 'down' }), { ...start, cursor: 1 });
  assert.deepEqual(checklistKey({ ...start, cursor: 2 }, { name: 'j' }), { ...start, cursor: 0 });
  assert.deepEqual(checklistKey({ ...start, cursor: 1 }, { name: 'k' }), { ...start, cursor: 0 });
});

test('space ticks or unticks only the item under the pointer', () => {
  assert.deepEqual(checklistKey(start, { name: 'space' }), { cursor: 0, checked: [false, true, false] });
  assert.deepEqual(checklistKey({ ...start, cursor: 2 }, { name: 'space' }), { cursor: 2, checked: [true, true, true] });
});

test('Enter saves, Ctrl+C cancels, and any other key changes nothing', () => {
  assert.equal(checklistKey(start, { name: 'return' }), 'done');
  assert.equal(checklistKey(start, { name: 'enter' }), 'done');
  assert.equal(checklistKey(start, { name: 'c', ctrl: true }), 'cancel');
  assert.equal(checklistKey(start, { name: 'c' }), start);
  assert.equal(checklistKey(start, {}), start);
});

test('checklist lines show the pointer and ticks, and are cut to the terminal width', () => {
  assert.deepEqual(checklistLines(['web', 'bash', 'email'], { cursor: 1, checked: [true, false, true] }), [
    '   [x] web',
    ' > [ ] bash',
    '   [x] email',
  ]);
  assert.deepEqual(checklistLines(['web'], { cursor: -1, checked: [true] }), ['   [x] web']);
  assert.deepEqual(checklistLines(['a long label'], { cursor: 0, checked: [false] }, 12), [' > [ ] a lo']);
});
