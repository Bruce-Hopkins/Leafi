import { emitKeypressEvents } from 'node:readline';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';

/** Asks until the answer is one of the numbered choices, and returns its index. */
export async function askChoice(question: string, labels: readonly string[]): Promise<number> {
  const choices = labels.map((label, index) => `  ${index + 1}. ${label}`).join('\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (;;) {
      const answer = (await rl.question(`${question}\n${choices}\nChoice [1-${labels.length}]: `)).trim();
      const index = Number(answer) - 1;
      if (Number.isInteger(index) && index >= 0 && index < labels.length) {
        return index;
      }
    }
  } finally {
    rl.close();
  }
}

export interface ChecklistItem {
  label: string;
  checked: boolean;
}

/** Where the checklist's pointer is and what is ticked. A cursor of -1 draws no pointer. */
export interface ChecklistState {
  cursor: number;
  checked: boolean[];
}

/** The parts of a readline keypress the checklist reads. */
export interface ChecklistKey {
  name?: string;
  ctrl?: boolean;
}

const CHECKLIST_HINT = '  (up/down to move, space to tick or untick, Enter to save)';

/**
 * The checklist's response to one key: the next state, `done` on Enter, or
 * `cancel` on Ctrl+C. Kept free of the terminal so it can be tested.
 */
export function checklistKey(state: ChecklistState, key: ChecklistKey): ChecklistState | 'done' | 'cancel' {
  const count = state.checked.length;
  if (key.ctrl && key.name === 'c') {
    return 'cancel';
  }
  switch (key.name) {
    case 'return':
    case 'enter':
      return 'done';
    case 'up':
    case 'k':
      return { ...state, cursor: (state.cursor - 1 + count) % count };
    case 'down':
    case 'j':
      return { ...state, cursor: (state.cursor + 1) % count };
    case 'space':
      return { ...state, checked: state.checked.map((on, index) => (index === state.cursor ? !on : on)) };
    default:
      return state;
  }
}

/** One line per item, each cut to `columns` so none wraps and breaks the redraw. */
export function checklistLines(labels: readonly string[], state: ChecklistState, columns?: number): string[] {
  return labels.map((label, index) => {
    const line = `${index === state.cursor ? ' >' : '  '} [${state.checked[index] ? 'x' : ' '}] ${label}`;
    return columns && columns > 1 && line.length >= columns ? line.slice(0, columns - 1) : line;
  });
}

/**
 * Shows a checklist and returns what is ticked when Enter is pressed. Needs a
 * terminal, because it reads single keys. Ctrl+C restores the terminal and
 * interrupts the process, as it would at any other prompt.
 */
export async function askChecklist(question: string, items: readonly ChecklistItem[]): Promise<boolean[]> {
  const input = process.stdin;
  const output = process.stderr;
  const labels = items.map((item) => item.label);
  let state: ChecklistState = { cursor: 0, checked: items.map((item) => item.checked) };
  let drawn = 0;
  const draw = () => {
    const lines = checklistLines(labels, state, output.columns);
    output.write(`${drawn > 0 ? `\x1b[${drawn}A` : ''}\x1b[0J${lines.join('\n')}\n`);
    drawn = lines.length;
  };

  output.write(`${question}\n${CHECKLIST_HINT}\n`);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?25l');
  let cancelled = false;
  try {
    draw();
    await new Promise<void>((resolve) => {
      const onKey = (_text: string | undefined, key: ChecklistKey | undefined) => {
        const next = checklistKey(state, key ?? {});
        if (next === 'done' || next === 'cancel') {
          cancelled = next === 'cancel';
          input.off('keypress', onKey);
          resolve();
          return;
        }
        state = next;
        draw();
      };
      input.on('keypress', onKey);
    });
    state = { ...state, cursor: -1 };
    draw();
  } finally {
    input.setRawMode(wasRaw);
    input.pause();
    output.write('\x1b[?25h');
  }
  if (cancelled) {
    process.kill(process.pid, 'SIGINT');
  }
  return state.checked;
}

/** Reads one line without echoing it. */
export async function askSecret(question: string): Promise<string> {
  process.stderr.write(question);
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return (await rl.question('')).trim();
  } finally {
    rl.close();
    process.stderr.write('\n');
  }
}
