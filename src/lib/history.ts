/**
 * Undo/redo history (M1, 2026-11-05).
 *
 * A small generic stack: push() records a state, undo()/redo() move
 * through it. Only real changes are recorded (deep-compared), the
 * redo stack clears on a new push, and the stack is capped so a long
 * editing session cannot grow memory without bound. Pure — no React,
 * no storage — so it is unit-tested directly; the creator page wires
 * it to Ctrl+Z / Ctrl+Shift+Z.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private currentValue: T;
  private readonly cap: number;

  constructor(initial: T, cap = 50) {
    this.currentValue = initial;
    this.cap = Math.max(1, cap);
  }

  get current(): T {
    return this.currentValue;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  get redoDepth(): number {
    return this.future.length;
  }

  /** Record a new state. No-ops when identical to the current state. */
  push(state: T): void {
    if (JSON.stringify(state) === JSON.stringify(this.currentValue)) return;
    this.past.push(this.currentValue);
    if (this.past.length > this.cap) this.past.shift();
    this.currentValue = state;
    this.future = [];
  }

  undo(): T | null {
    if (this.past.length === 0) return null;
    this.future.push(this.currentValue);
    this.currentValue = this.past.pop() as T;
    return this.currentValue;
  }

  redo(): T | null {
    if (this.future.length === 0) return null;
    this.past.push(this.currentValue);
    this.currentValue = this.future.pop() as T;
    return this.currentValue;
  }

  /** Replace the current state without touching the stacks (e.g. load). */
  reset(state: T): void {
    this.currentValue = state;
    this.past = [];
    this.future = [];
  }
}
