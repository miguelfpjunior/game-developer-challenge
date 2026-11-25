import type { InputState } from './simulation';

export type InputAction = keyof InputState;

/** Keyboard bindings (KeyboardEvent.code). Shown in the UI from this single source. */
export const KEY_BINDINGS: Record<InputAction, readonly string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  turnLeft: ['KeyA', 'ArrowLeft'],
  turnRight: ['KeyD', 'ArrowRight'],
  fireFront: ['Space', 'KeyJ'],
  fireLeft: ['KeyQ', 'KeyK'],
  fireRight: ['KeyE', 'KeyL'],
};

export const PAUSE_KEYS = ['KeyP', 'Escape'] as const;

export const ACTION_LABELS: Record<InputAction, string> = {
  forward: 'Sail forward',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  fireFront: 'Fire bow cannon',
  fireLeft: 'Port broadside (left)',
  fireRight: 'Starboard broadside (right)',
};

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  return code;
}

const ACTION_BY_CODE = new Map<string, InputAction>();
for (const [action, codes] of Object.entries(KEY_BINDINGS) as Array<[InputAction, readonly string[]]>) {
  for (const code of codes) ACTION_BY_CODE.set(code, action);
}

/**
 * Collects keyboard + touch input into a plain state object read by the simulation each step.
 * Keys are captured only while `active` is true (gameplay context); pressing state is cleared
 * on pause so nothing "accumulates" while the game is suspended.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly touch = new Set<InputAction>();
  private active = false;
  private readonly onPause: () => void;

  constructor(onPause: () => void) {
    this.onPause = onPause;
  }

  attach(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  detach(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.reset();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.reset();
  }

  reset(): void {
    this.keys.clear();
    this.touch.clear();
  }

  setTouch(action: InputAction, pressed: boolean): void {
    if (!this.active) return;
    if (pressed) this.touch.add(action);
    else this.touch.delete(action);
  }

  read(): InputState {
    const has = (a: InputAction) => this.touch.has(a) || KEY_BINDINGS[a].some((c) => this.keys.has(c));
    return {
      forward: has('forward'),
      turnLeft: has('turnLeft'),
      turnRight: has('turnRight'),
      fireFront: has('fireFront'),
      fireLeft: has('fireLeft'),
      fireRight: has('fireRight'),
    };
  }

  private isTypingTarget(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.active || this.isTypingTarget(e)) return;
    if ((PAUSE_KEYS as readonly string[]).includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) this.onPause();
      return;
    }
    if (ACTION_BY_CODE.has(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    if (ACTION_BY_CODE.has(e.code)) {
      if (this.active) e.preventDefault();
      this.keys.delete(e.code);
    }
  };
}
