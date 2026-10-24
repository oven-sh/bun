// `i++` behind `i < limit` is proven only for a local variable that nothing else can store to. A captured variable, a variable of the module, a field, and a test that says too little (`<=` the largest int32, `!==`, a bound that is a `number`, one arm of `||`, a test kept in a constant, a catch clause) prove nothing. typed-objects/int32-range-after-tests has what is proven.
import type { int32 } from "bun";

const MAX: int32 = 2147483647;
function capturedInALoop(to: int32): int32 { let i: int32 = 0; const jump = () => { i = MAX; }; for (; i < to; i++) { if (i === 2) jump(); } return i; }
function capturedWithItsLimit(to: int32): int32 { let i: int32 = 0; let limit: int32 = to; const raise = () => { limit = MAX; i = MAX; }; while (i < limit) { raise(); i++; } return i; }
class Cell {
  n: int32 = 0;
  reset(): void { this.n = MAX; }
  bump(): void { if (this.n < 100) { this.reset(); this.n++; } }
}
function twoNames(a: Cell, b: Cell): int32 { if (a.n < 100) { b.n = MAX; a.n++; } return a.n; }
function aCallBetween(a: Cell, touch: () => void): int32 { if (a.n < 100) { touch(); a.n++; } return a.n; }
function aFieldAlone(a: Cell): int32 { if (a.n < 100) a.n++; return a.n; }
let shared: int32 = 0;
function poke(): void { shared = MAX; }
function moduleVariable(): int32 { if (shared < 100) { poke(); shared++; } return shared; }
function moduleVariableInALoop(): int32 { for (shared = 0; shared < 10; shared++) poke(); return shared; }
async function acrossAnAwait(wait: Promise<void>): Promise<int32> { if (shared < 100) { await wait; shared++; } return shared; }
function* acrossAYield(): Generator<void, int32, void> { if (shared < 100) { yield; shared++; } return shared; }
function inACatch(i: int32): int32 { try { if (i < 100) { throw 1; } } catch { i++; } return i; }
function atMostTheLargest(i: int32): int32 { const limit: int32 = MAX; if (i <= limit) i++; return i; }
function notTheLargest(i: int32): int32 { if (i !== MAX) i++; return i; }
function belowAFraction(i: int32): int32 { if (i < 2147483647.5) i++; return i; }
function belowANumber(i: int32, f: number): int32 { if (i < f) i++; return i; }
function oneOfTwoTests(i: int32): int32 { if (i < 100 || i > 200) i++; return i; }
function aTestKeptInAConstant(i: int32): int32 { const small = i < 100; if (small) i++; return i; }

console.log(capturedInALoop(1), capturedWithItsLimit(1), new Cell().bump(), twoNames(new Cell(), new Cell()), aCallBetween(new Cell(), poke), aFieldAlone(new Cell()), moduleVariable(), moduleVariableInALoop(), acrossAnAwait(Promise.resolve()), acrossAYield().next());
console.log(inACatch(1), atMostTheLargest(1), notTheLargest(1), belowAFraction(1), belowANumber(1, 2), oneOfTwoTests(1), aTestKeptInAConstant(1));
