// Strict TypeScript: an object is born with a field of never[] and one of null, and both are filled through a wider view of it.
function either(n: number, c: boolean) {
  const kept = c ? { last: null } : { list: [] };
  const lists: { list?: number[] } = kept;
  const lasts: { last?: unknown } = kept;
  if (lists.list) lists.list.push(n);
  else lasts.last = n;
  return kept;
}
function state(n: number) {
  const kept = { last: null, list: [] };
  const view: { last: unknown; list: number[] } = kept;
  view.last = n;
  view.list.push(n);
  return kept;
}
let sum = 0;
for (let i = 0; i < 3000; i++) {
  const a = either(i, i % 2 === 0);
  const b = state(i);
  const first: unknown = a.list ? a.list[0] : a.last;
  const second: unknown = b.list[0];
  const third: unknown = b.last;
  if (typeof first === "number") sum += first;
  if (typeof second === "number") sum += second;
  if (typeof third === "number") sum += third;
  if (a.last === null || b.last === null) sum -= 1000000;
}
console.log(sum, JSON.stringify(either(5, true)), JSON.stringify(either(6, false)), JSON.stringify(state(7)));
