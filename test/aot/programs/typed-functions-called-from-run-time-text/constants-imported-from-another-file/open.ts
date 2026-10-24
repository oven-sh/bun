export interface Point { x: number; y: number }
export function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
export function pointAt(i: number): Point { return { x: i, y: i * 2 }; }
