// An object literal with a getter stands in code that a constant condition cuts. Its type is still named by what is left.
const enabled = false;
function make(n: number) {
  return enabled ? { get value() { return n * 2; }, n } : { value: n, n };
}
type Made = ReturnType<typeof make>;
function show(made: Made): string { return made.value + ":" + made.n; }
console.log(show(make(2)));
function other(n: number) {
  if (false) { const lazy = { get twice() { return n * 2; }, set twice(value: number) { n = value; }, n }; return lazy; }
  return undefined;
}
function use(it: ReturnType<typeof other>): number { return it === undefined ? -1 : it.twice + it.n; }
console.log(use(other(3)));
const kept = true;
function makeKept(n: number) {
  return kept ? { get value() { return n * 2; }, n } : { value: n, n };
}
function showKept(made: ReturnType<typeof makeKept>): string { return made.value + ":" + made.n + ":" + typeof Object.getOwnPropertyDescriptor(made, "value")!.get; }
console.log(showKept(makeKept(2)));
