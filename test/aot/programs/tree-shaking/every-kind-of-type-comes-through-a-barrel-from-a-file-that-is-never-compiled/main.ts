// The application says "sideEffects": false, and lib/index.ts is a barrel written in TypeScript. The program asks it for one function, which is in used.ts, and of types.ts for types alone: some by `import type`, some by a plain import that is only used as a type. So nothing asks the barrel for a value of types.ts: the file is not compiled, the barrel does not export its names, and each type still has what the compiler makes of it. Every file prints when it is evaluated. `bun run` evaluates types.ts; `bun build --compile` does not.
import { used, Box, Color, Units, type Base, type Callback, type Pair, type Shape, type guard, type table } from "./lib";

const shape: Shape = { size: 2, grow(by) { return { ...this, size: this.size + by }; }, inner: { depth: 1 } };
const callback: Callback = value => "v" + value;
const pair: Pair<number> = { first: 1, second: 2 };
function width(box: Box | null): number {
  return box === null ? 0 : box.width + box.area();
}
function made<T>(base: Base<T> | undefined): T | undefined {
  return base?.make();
}
function color(value: Color | undefined): string {
  return String(value);
}
const meter: Units.Meter = { meters: 3 };
const copy: typeof table = { a: 4, b: "five" };
const test: typeof guard = ((value: unknown) => value !== null) as typeof guard;
console.log(used(shape), shape.grow(1).size, shape.inner?.depth, callback(1), pair.first + pair.second, width(null), made(undefined), color(undefined), meter.meters, copy.a, copy.b, test(shape));
