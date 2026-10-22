function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

interface State {
  count: number;
  tags: string[];
  inner: { level: number };
}

function bump(state: State = { count: 0, tags: ["start"], inner: { level: 1 } }): State {
  state.count++;
  state.tags.push("bumped");
  state.inner.level *= 2;
  return state;
}

const first = bump();
const second = bump();
console.log("defaults: " + text(first) + " " + text(second));
console.log("defaults are different objects: " + (first !== second) + " " + (first.tags !== second.tags) + " " + (first.inner !== second.inner));
console.log("given back: " + text(bump(first)) + ", the other is untouched: " + text(second));

function pattern({ count = 0, tags = ["t"] }: Partial<State> = {}, [head = { level: 1 }]: { level: number }[] = []): string {
  tags.push("seen " + count);
  head.level++;
  return text(tags) + " " + text(head);
}
console.log("pattern defaults: " + pattern() + " | " + pattern() + " | " + pattern({ count: 1 }));

function* states(): Generator<State, State, void> {
  for (let i = 0; i < 2; i++) yield { count: 0, tags: ["yielded"], inner: { level: 1 } };
  return { count: 0, tags: ["returned"], inner: { level: 1 } };
}
const walker = states();
const a = walker.next().value;
a.count = 9;
a.tags.push("changed");
Object.freeze(a.inner);
const b = walker.next().value;
const c = walker.next().value;
console.log("yielded: " + text(a) + " " + text(b) + " " + text(c));
console.log("yielded ones differ: " + (a !== b) + " " + (a.tags !== b.tags) + ", frozen " + Object.isFrozen(a.inner) + " " + Object.isFrozen(b.inner));
const again = states().next().value;
console.log("another walk: " + text(again) + " " + (again !== a));

async function later(): Promise<State> {
  await null;
  return { count: 0, tags: ["async"], inner: { level: 1 } };
}
const [p, q] = await Promise.all([later(), later()]);
p.count = 5;
p.inner.level = 50;
const partial: Partial<State> = p;
delete partial.tags;
console.log("async: " + text(p) + " " + text(q) + " " + (p !== q));

function results(): IteratorResult<number, undefined>[] {
  const out: IteratorResult<number, undefined>[] = [];
  for (let i = 0; i < 3; i++) out.push({ done: true, value: undefined });
  return out;
}
const ends = results();
console.log("three ends: " + (ends[0] !== ends[1]) + " " + (ends[1] !== ends[2]) + " " + Object.keys(ends[0]).join());

function rest(...all: number[]): number[] {
  all.push(all.length);
  return all;
}
const given: [number, number] = [1, 2];
const collected = rest(...given);
console.log("a rest parameter is its own list: " + text(collected) + " " + text(given) + " " + text(rest()) + " " + text(rest()));

function tagged(strings: TemplateStringsArray): TemplateStringsArray {
  return strings;
}
function site(): TemplateStringsArray {
  return tagged`constant`;
}
console.log("a template's strings are the same at one place: " + (site() === site()) + ", frozen " + Object.isFrozen(site()) + ", and differ between places: " + (site() !== tagged`constant`));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += bump().count + bump().tags.length + bump().inner.level;
console.log("2000 rounds: " + sum);

export {};
