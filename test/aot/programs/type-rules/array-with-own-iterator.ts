// An array or typed array with its own Symbol.iterator, from a subclass or stored on the value. `for...of`, destructuring and spread call it at every declared type, as in plain Bun.
class Heir extends Array<number> { *[Symbol.iterator](): ArrayIterator<number> { yield 7; yield 8; } }
class Bytes extends Uint8Array { *[Symbol.iterator](): ArrayIterator<number> { yield 5; } }
function attempt(name: string, f: () => unknown): void {
  try { console.log(name + ":", JSON.stringify(f())); } catch (e) { console.log(name + ":", e instanceof Error ? e.name + ": " + e.message.split(" (bun compile")[0] : String(e)); }
}
const heir: number[] = new Heir(1, 2);
const own: number[] = [1, 2];
(own as any)[Symbol.iterator] = function* () { yield 9; };
const pair: [number, number] = [1, 2];
(pair as any)[Symbol.iterator] = function* () { yield 9; yield 10; };
const bytes: Uint8Array = new Bytes(2);
const ordinary: number[] = [1, 2];

attempt("names", () => { const [a, b] = heir; return [a, b]; });
attempt("a rest element", () => { const [a, ...rest] = heir; return [a, rest]; });
attempt("defaults", () => { const [a = 3, b = 4, c = 5] = heir; return [a, b, c]; });
attempt("an assignment", () => { let a = 0, b = 0; [a, b] = heir; return [a, b]; });
attempt("a parameter", () => (([a, b]: number[]) => [a, b])(heir));
attempt("for...of", () => { let sum = 0; for (const x of heir) sum += x; return sum; });
attempt("an iterator stored on the array, names", () => { const [a] = own; return a; });
attempt("an iterator stored on the array, for...of", () => { let sum = 0; for (const x of own) sum += x; return sum; });
attempt("a tuple, names", () => { const [a, b] = pair; return [a, b]; });
attempt("a typed array, for...of", () => { let sum = 0; for (const x of bytes) sum += x; return sum; });
attempt("a typed array, names", () => { const [a] = bytes; return a; });

attempt("spread", () => [...heir]);
attempt("spread into a call", () => Math.max(...heir));
attempt("Array.from", () => Array.from(heir));
attempt("new Set", () => [...new Set(heir)]);
attempt("by index", () => [heir[0], heir[1], heir.length]);

const iterable: Iterable<number> = new Heir(1, 2);
attempt("at Iterable<number>, names", () => { const [a, b] = iterable; return [a, b]; });
attempt("at Iterable<number>, for...of", () => { let sum = 0; for (const x of iterable) sum += x; return sum; });
attempt("at its own class, for...of", () => { let sum = 0; for (const x of new Heir(1, 2)) sum += x; return sum; });
attempt("an ordinary array", () => { const [a, b] = ordinary; let sum = 0; for (const x of ordinary) sum += x; return [a, b, sum]; });
