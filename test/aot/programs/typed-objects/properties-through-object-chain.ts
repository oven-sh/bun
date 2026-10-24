// `a.b.c.d`: each object on the way is only looked through. It may also be kept and used later, after the property it came from
// has been overwritten and much has been allocated. A link that is undefined or null throws, and the message says which.
interface Leaf { v: number; w: number; name: string }
interface Mid { leaf: Leaf; other: Leaf; k: number }
interface Top { mid: Mid; n: number; next?: Top }

function one(t: Top): number { return t.mid.k; }
function two(t: Top): number { return t.mid.leaf.v; }
function both(t: Top): number { return t.mid.leaf.v + t.mid.leaf.w; }
function pair(t: Top): number { const l = t.mid.leaf; return l.v * l.w; }
function length(t: Top): number { return t.mid.leaf.name.length; }
function list(t: Top): number { let s = 0; for (let p: Top | undefined = t; p; p = p.next) s += p.mid.k; return s; }
function same(t: Top): number { return t.mid.leaf === t.mid.other ? 1 : 0; }
function storeThrough(t: Top, x: number): void { t.mid.leaf.v = x; }
function storeLink(t: Top, x: number): void { t.mid.other = t.mid.leaf; }

let kept: Leaf[] = [];
function garbage(k: number): number {
  let s = 0;
  for (let i = 0; i < 400; i++) { const made = { v: i, w: k, name: "g" + i }; if (i % 97 === 0) kept.push(made); s += made.v; }
  if (kept.length > 50) kept = [];
  return s;
}
// The only reference to the leaf is the local one while the garbage is made.
function keptAcross(t: Top, k: number): number {
  const l = t.mid.leaf;
  t.mid.leaf = { v: -1, w: -1, name: "new" };
  const s = garbage(k);
  return l.v + l.w + l.name.length + (s & 1);
}
function readAfter(t: Top, k: number): number {
  const m = t.mid;
  t.mid = { leaf: { v: 1, w: 1, name: "" }, other: { v: 2, w: 2, name: "" }, k: 0 };
  garbage(k);
  return m.leaf.v + m.other.w + m.k;
}

function make(k: number, next?: Top): Top {
  const leaf = { v: k, w: k + 0.5, name: "n" + k };
  return { mid: { leaf, other: k & 1 ? leaf : { v: 0, w: 0, name: "" }, k: k * 2 }, n: k, next };
}
const readers: Array<(t: Top) => number> = [one, two, both, pair, length, list, same];
const stores: Array<(t: Top, x: number) => void> = [storeThrough, storeLink];
const across: Array<(t: Top, k: number) => number> = [keptAcross, readAfter];

let total = 0;
let chain: Top | undefined = undefined;
for (let k = 0; k < 600; k++) {
  const top = make(k, k % 10 ? chain : undefined);
  chain = top;
  for (const f of readers) total += f(top);
  for (const g of stores) g(top, total % 7);
  for (const f of readers) total += f(top);
  for (const f of across) total += f(top, k);
  for (const f of readers) total += f(top);
}
console.log(total);

function attempt(run: () => unknown): void {
  try { console.log(run()); } catch (e) { console.log(e instanceof TypeError, /undefined/.test(String(e)) ? "undefined" : /null/.test(String(e)) ? "null" : "neither"); }
}
attempt(() => two({ mid: undefined!, n: 1 }));
attempt(() => two({ mid: { leaf: null!, other: null!, k: 1 }, n: 1 }));
attempt(() => storeThrough({ mid: { leaf: undefined!, other: null!, k: 1 }, n: 1 }, 2));
attempt(() => length({ mid: { leaf: { v: 1, w: 2, name: undefined! }, other: null!, k: 1 }, n: 1 }));
attempt(() => same({ mid: { leaf: undefined!, other: null!, k: 1 }, n: 1 }));
attempt(() => same({ mid: { leaf: null!, other: null!, k: 1 }, n: 1 }));
