import type { int32 } from "bun";

class Cursor {
  line: int32 = 1;
  column: int32 = 4;
}
function lineOf(cursor: Cursor): int32 {
  return cursor.line;
}
const a = new Cursor();
Reflect.set(a, "line", 1.5);
console.log(lineOf(a), lineOf(a) + 1, lineOf(a) | 0, a.column);
const b = new Cursor();
Object.defineProperty(b, "line", { value: 2.5, writable: true, enumerable: true, configurable: true });
console.log(lineOf(b), lineOf(b) + 1, lineOf(b) | 0, b.column);
const c = new Cursor();
Reflect.deleteProperty(c, "line");
console.log(lineOf(c), lineOf(c) + 1, lineOf(c) | 0, c.column, Object.keys(c).join());
const d = new Cursor();
Object.defineProperty(d, "line", { get: () => 3.5, enumerable: true, configurable: true });
console.log(lineOf(d), lineOf(d) + 1, lineOf(d) | 0, d.column);
const e = new Cursor();
Reflect.defineProperty(e, "line", { value: "text", writable: true, enumerable: true, configurable: true });
console.log(lineOf(e), lineOf(e) + 1, typeof lineOf(e), e.column);
