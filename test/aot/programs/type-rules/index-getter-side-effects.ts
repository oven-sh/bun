// A typed read of an array element that is an accessor runs the getter, whatever the representation of the index and the element type. Each getter here changes something the reading function read just before and reads again just after: a stale second value means a load was reused across the element read. The last getter is inherited through a hole. Array.prototype is locked (type-rules/builtin-mutation-forms), so the array gets a prototype of its own.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0].split(" (bun compile")[0] : String(e))) } }
function hide(v: unknown): any { return v }
interface Box { x: number; list: number[] }
function fieldAcross(a: unknown[], o: Box, i: number): string { const before = o.x; const v = a[i]; const after = o.x; return before + " " + String(v) + " " + after }
function lengthAcross(a: unknown[], o: Box, i: number): string { const before = o.list.length; const v = a[i]; const after = o.list.length; return before + " " + String(v) + " " + after }
function ownLengthAcross(a: unknown[], i: number): string { const before = a.length; const v = a[i]; const after = a.length; return before + " " + String(v) + " " + after }
function elementAcross(a: unknown[], o: Box, i: number): string { const before = o.list[0]; const v = a[i]; const after = o.list[0]; return before + " " + String(v) + " " + after }
function ownElementAcross(a: unknown[], i: number): string { const before = a[0]; const v = a[i]; const after = a[0]; return String(before) + " " + String(v) + " " + String(after) }
function anyAcross(a: any[], o: Box, i: number): string { const before = o.x; const v = a[i]; const after = o.x; return before + " " + String(v) + " " + after }
function mixedOwnLength(a: (number | string)[], i: number): string { const before = a.length; const v = a[i]; const after = a.length; return before + " " + String(v) + " " + after }
function mixedOwnLengthAtInteger(a: (number | string)[], n: number): string { const i = n | 0; const before = a.length; const v = a[i]; const after = a.length; return before + " " + String(v) + " " + after }
function numbersOwnLength(a: number[], i: number): string { const before = a.length; const v = a[i]; const after = a.length; return before + " " + String(v) + " " + after }
function unknownOwnLengthAtInteger(a: unknown[], n: number): string { const i = n | 0; const before = a.length; const v = a[i]; const after = a.length; return before + " " + String(v) + " " + after }
function calls(a: unknown[], i: number): unknown { return a[i] }
function lengthAcrossCall(a: unknown[], i: number): string { const before = a.length; const v = calls(a, i); const after = a.length; return before + " " + String(v) + " " + after }
const F: { mixedOwnLength: typeof mixedOwnLength; mixedOwnLengthAtInteger: typeof mixedOwnLengthAtInteger; numbersOwnLength: typeof numbersOwnLength; unknownOwnLengthAtInteger: typeof unknownOwnLengthAtInteger; lengthAcrossCall: typeof lengthAcrossCall; fieldAcross: typeof fieldAcross; lengthAcross: typeof lengthAcross; ownLengthAcross: typeof ownLengthAcross; elementAcross: typeof elementAcross; ownElementAcross: typeof ownElementAcross; anyAcross: typeof anyAcross } = hide({ mixedOwnLength, mixedOwnLengthAtInteger, numbersOwnLength, unknownOwnLengthAtInteger, lengthAcrossCall, fieldAcross, lengthAcross, ownLengthAcross, elementAcross, ownElementAcross, anyAcross });
function box(): Box { return { x: 1, list: [10, 20] } }
function withGetter(run: () => unknown): unknown[] { const a: unknown[] = [1.5, 2.5, 3.5]; Object.defineProperty(a, 1, { get: run, configurable: true, enumerable: true }); return a }
for (let turn = 0; turn < 3; turn++) {
  row(turn + " plain arrays: a field", () => F.fieldAcross([1.5, 2.5, 3.5], box(), 1));
  row(turn + " a getter that stores a field", () => { const o = box(); return F.fieldAcross(withGetter(() => { o.x = 2; return "got" }), o, 1) });
  row(turn + " a getter that pushes onto another array", () => { const o = box(); return F.lengthAcross(withGetter(() => { o.list.push(30); return "got" }), o, 1) });
  row(turn + " a getter that pushes onto the array itself", () => { const a: unknown[] = withGetter(() => { a.push(9); return "got" }); return F.ownLengthAcross(a, 1) });
  row(turn + " a getter that stores an element of another array", () => { const o = box(); return F.elementAcross(withGetter(() => { o.list[0] = 11; return "got" }), o, 1) });
  row(turn + " a getter that stores an element of the array itself", () => { const a: unknown[] = withGetter(() => { a[0] = "changed"; return "got" }); return F.ownElementAcross(a, 1) });
  row(turn + " (number | string)[], a number for the index: pushes onto itself", () => { const a: any[] = withGetter(() => { a.push(9); return "got" }); return F.mixedOwnLength(a, 1) });
  row(turn + " (number | string)[], an integer for the index: pushes onto itself", () => { const a: any[] = withGetter(() => { a.push(9); return "got" }); return F.mixedOwnLengthAtInteger(a, 1) });
  row(turn + " number[], a number for the index: pushes onto itself", () => { const a: any[] = withGetter(() => { a.push(9); return 7 }); return F.numbersOwnLength(a, 1) });
  row(turn + " unknown[], an integer for the index: pushes onto itself", () => { const a: unknown[] = withGetter(() => { a.push(9); return "got" }); return F.unknownOwnLengthAtInteger(a, 1) });
  row(turn + " unknown[], the read is in a function that is called: pushes onto itself", () => { const a: unknown[] = withGetter(() => { a.push(9); return "got" }); return F.lengthAcrossCall(a, 1) });
  row(turn + " any[]: a getter that stores a field", () => { const o = box(); return F.anyAcross(withGetter(() => { o.x = 2; return "got" }), o, 1) });
  row(turn + " a getter on the array's own prototype behind a hole", () => { const o = box(); const a: unknown[] = [1.5, , 3.5]; const parent = Object.create(Array.prototype); Object.defineProperty(parent, 1, { get() { o.x = 2; return "inherited" } }); Object.setPrototypeOf(a, parent); return F.fieldAcross(a, o, 1) });
}
