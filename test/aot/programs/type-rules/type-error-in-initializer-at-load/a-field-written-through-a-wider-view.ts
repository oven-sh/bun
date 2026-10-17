type Base = { a: number };
type Derived = { a: number; b: number };
type Box<Held> = { it: Held };
function make(): { next: number } { const derived: Box<Derived> = { it: { a: 1, b: 2 } }; const base: Box<Base> = derived; base.it = { a: 1 }; return { next: derived.it.b + 1 }; }
export const made = make();
