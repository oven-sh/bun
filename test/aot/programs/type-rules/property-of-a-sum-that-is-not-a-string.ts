// `list[i] + list[j]` of a `string[]` is NaN where both elements are missing. TypeScript calls the sum a string; what is read from it must be what a number gives.
declare const console: { log(...values: unknown[]): void };
const none: string[] = [];
const some: string[] = ["ab", "cde"];
function lengthOf(list: string[], i: number, j: number) { return (list[i] + list[j]).length; }
function added(list: string[], i: number, j: number) { let total = 0; total += (list[i] + list[j]).length; return total; }
function kept(list: string[], i: number, j: number) { const sum = list[i] + list[j]; return sum.length; }
function compared(list: string[], i: number, j: number) { return (list[i] + list[j]).length > 2 ? "long" : "short"; }
function shown(list: string[], i: number, j: number) { return (list[i] + list[j]).toString(); }
function looped(list: string[]) { let total = 0; for (let i = 0; i <= list.length; i++) total += (list[i] + list[i + 1]).length; return total; }
function show(name: string, f: () => unknown) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", (e as Error).constructor.name); } }
for (const [name, list] of [["none", none], ["some", some]] as [string, string[]][]) {
  for (const [i, j] of [[0, 1], [0, 5], [5, 6]]) {
    show(name + " length " + i + j, () => lengthOf(list, i, j));
    show(name + " added " + i + j, () => added(list, i, j));
    show(name + " kept " + i + j, () => kept(list, i, j));
    show(name + " compared " + i + j, () => compared(list, i, j));
    show(name + " shown " + i + j, () => shown(list, i, j));
  }
  show(name + " looped", () => looped(list));
}
