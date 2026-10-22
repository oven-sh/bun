// A class whose static members are those of an object type is passed where the type is declared, beside a literal, a namespace and an enum: static fields, methods, accessors and stores behave as in plain Bun.
interface Counter { count: number; step(): number }
class Up { static count = 0; static step() { return ++Up.count; } }
class Down { static count = 10; static step() { return --this.count; } }
class Heir extends Up {}
class Computed { static #n = 1; static get count() { return Computed.#n; } static set count(n: number) { Computed.#n = n * 2; } static step() { return Computed.count; } }
namespace Space { export let count = 100; export function step() { return (count += 5); } }
function run(c: Counter): number { const before = c.count; c.count = before + 1; return c.step() + c.count + before; }
function names(c: Counter): string { return Object.keys(c).join() + typeof c + ("step" in c); }
let n = 0, t = "";
const literal: Counter = { count: 1, step() { return this.count * 2; } };
for (let i = 0; i < 100; i++) {
  n += run(Up) + run(Down) + run(literal) + run(Space) + run(Computed) % 1000 + run(Heir);
  t = names(Up) + names(literal) + names(Space) + names(Heir);
}
console.log(n, t, Up.count, Down.count, Heir.count, Space.count);
