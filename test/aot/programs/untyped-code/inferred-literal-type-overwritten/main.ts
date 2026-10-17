// `open: false` in a literal without `as const` keeps the type `false` where the literal is checked against a type that names literal types. That type is inferred, not annotated, so untyped code may store `true`.
import { open, store } from "./untyped.js";

type State = { open: boolean; items: string[] };
function describe(s: State): string {
  return (s.open ? "open" : "closed") + " " + s.items.length;
}

function create<T extends State>(init: T): T {
  return init;
}
const created = create({ open: false, items: [] });
console.log("a bound that names it:", open(created), created.open, describe(created));

function keep<T extends { [name: string]: U | object }, U extends boolean | string | number>(init: T): T {
  return init;
}
const kept = keep({ open: false, mode: "a", count: 0, items: [] as string[] });
console.log("an index signature of primitives:", open(kept), store(kept, "mode", "b"), store(kept, "count", 2), kept.open, kept.mode, kept.count);

const INITIAL = Object.freeze({ open: false, items: [] as string[] });
function fresh() {
  return { ...INITIAL };
}
const copy = fresh();
console.log("a copy of a frozen literal:", open(copy), copy.open, describe(copy), INITIAL.open);

const again = { ...fresh(), items: ["x"] };
console.log("a copy of the copy:", open(again), again.open, describe(again));

function holder<T extends { open: boolean | null }>(init: T): { current: T } {
  return { current: init };
}
const held = holder({ open: null });
console.log("null alone:", open(held.current), held.current.open);

const list = [create({ open: false, items: [] }), create({ open: false, items: ["y"] })];
for (const each of list) console.log("in an array:", open(each), each.open ? "open" : "closed", describe(each));

const read = create({ open: false, items: [] });
open(read);
const { open: taken } = read;
const chosen = read.open || "closed";
console.log("read by typed code:", taken, chosen, `${read.open}`, [read.open].join(), read.open === false, read.open ?? "none");
