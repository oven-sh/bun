// A typed function is handed to text that becomes code at run time, and called from there: a readonly array, and a list and an object declared as const.
function open<F>(f: F): F { (globalThis as any).held = f; return (0, eval)("globalThis.held"); }
const sizes = [1, 2, 4] as const;
const table = { a: 1, b: "two" } as const;
function probe(list: readonly number[], i: number): number {
  let sum = 0;
  for (let k = 0; k < list.length; k++) sum += list[k];
  return sum + sizes[i % 3] + sizes[1] + table.a + table.b.length;
}
console.log(open(probe)([1, 2], 1));
