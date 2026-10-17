// A type parameter can be constrained by a mapped type over itself: `F extends Selectors<F>`, as in reselect and Redux Toolkit.
type Same<T> = { [K in keyof T]: T[K] };
function count<F extends Same<F>>(table: F): number { return Object.keys(table).length; }
console.log(count({ a: 1, b: "x" }));

type Selectors<T extends Record<string, (...args: never[]) => unknown>> = { [K in keyof T]: T[K] };
function names<F extends Selectors<F>>(table: F): (keyof F)[] { return Object.keys(table) as (keyof F)[]; }
console.log(names({ one: () => 1, two: () => "2" }).join());

class Registry<F extends Same<F>> {
  constructor(public table: F) {}
  get<K extends keyof F>(key: K): F[K] { return this.table[key]; }
}
console.log(new Registry({ x: 1, y: "why" }).get("y"));

type ReadonlySame<T> = { readonly [K in keyof T]: T[K] };
function freeze<F extends ReadonlySame<F>>(table: F): F { return Object.freeze(table); }
console.log(freeze({ a: 1 }).a);

type Optional<T> = { [K in keyof T]?: T[K] };
function merge<F extends Optional<F>>(into: F, from: Optional<F>): F { return Object.assign(into, from); }
console.log(JSON.stringify(merge({ a: 1, b: 2 }, { b: 3 })));

function nested<F extends Readonly<Same<F>>>(table: F): number { return Object.keys(table).length; }
console.log(nested({ a: 1, b: 2, c: 3 }));

declare const declaredOnly: { pick: <F extends Same<F>>(table: F) => number };
console.log(typeof declaredOnly);
