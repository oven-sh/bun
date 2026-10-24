type Base = { a: number };
type Derived = { a: number; b: number };
type Taker<Taken> = { take(it: Taken): number };
function make(): { next: number } { const derived: Taker<Derived> = { take(it: Derived): number { return it.b + 1; } }; const base: Taker<Base> = derived; return { next: base.take({ a: 1 }) }; }
export const made = make();
