import { app, Window } from "bun:desktop";
const win = new Window({});
let seed = 1;
const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
class Node {
  constructor(id) {
    this.id = id;
    this.next = null;
    this.kids = [];
    this.tag = "n" + id;
  }
  sum() {
    return this.id + this.kids.length;
  }
}
class Priv {
  #v;
  constructor(v) {
    this.#v = v;
  }
  get v() {
    return this.#v;
  }
  static has(o) {
    return #v in o;
  }
}
function* gen(o) {
  let i = 0;
  const keep = [o, { o }];
  for (;;) yield keep[1].o === o && keep[0] === o ? o.id + i++ : NaN;
}
async function waiter(o, p) {
  const c = { o };
  await p;
  return c.o === o ? o.id : NaN;
}
const byKey = new Map(),
  set = new Set(),
  weak = new WeakMap(),
  weakSet = new WeakSet(),
  byId = new Map(),
  dyn = Object.create(null);
let staticRef = null,
  live = [],
  id = 0,
  bad = 0;
function make() {
  const n = new Node(++id),
    plain = JSON.parse(`{"id":${id},"a":[1,2,{"b":${id}}]}`),
    lit = { id, n, plain },
    pair = [n, lit];
  let count = 0;
  const closure = () => (count++, n.id),
    bound = function (x, y) {
      return this.id + x.id + y;
    }.bind(n, lit);
  let go;
  const p = new Promise(r => (go = r));
  const e = {
    n,
    plain,
    lit,
    pair,
    closure,
    bound,
    g: gen(n),
    steps: 0,
    priv: new Priv(n),
    proxy: id % 7 ? null : new Proxy(n, {}),
    ref: id % 5 ? null : new WeakRef(lit),
    w: waiter(n, p),
    go,
    m: new Map([
      [n, lit],
      [lit, n],
      [closure, pair],
    ]),
    s: new Set([pair, plain]),
    it: null,
    self: null,
    spread: { ...lit, extra: pair },
  };
  e.self = e;
  e.it = e.m.keys();
  n.kids.push(lit, pair);
  byKey.set(n, e);
  set.add(lit);
  weak.set(n, plain);
  weak.set(closure, pair);
  weakSet.add(pair);
  byId.set(id, n);
  dyn["k" + (id % 3000)] = e;
  return e;
}
function drop(e) {
  byKey.delete(e.n);
  set.delete(e.lit);
  byId.delete(e.n.id);
  const i = e.n.id;
  e.w.then(v => v === i || fail("await", i));
  e.go();
}
function fail(what, i) {
  if (bad++ < 5) console.log("BAD", what, i);
}
function check(e) {
  const i = e.n.id,
    ok = (c, w) => c || fail(w, i);
  ok(
    e.self === e &&
      e.lit.n === e.n &&
      e.lit.id === i &&
      e.pair[0] === e.n &&
      e.pair[1] === e.lit &&
      e.pair.length === 2,
    "graph",
  );
  ok(
    e.plain.id === i &&
      e.plain.a[2].b === i &&
      e.lit.plain === e.plain &&
      e.n.tag === "n" + i &&
      e.n.sum() === i + 2 &&
      e.n.kids[1] === e.pair,
    "fields",
  );
  ok(e.closure() === i && e.bound(1) === 2 * i + 1 && e.priv.v === e.n && Priv.has(e.priv), "calls");
  ok(e.g.next().value === i + e.steps++, "generator");
  ok(byKey.get(e.n) === e && set.has(e.lit) && byId.get(i) === e.n && !set.has(e.pair), "map");
  ok(weak.get(e.n) === e.plain && weak.get(e.closure) === e.pair && weakSet.has(e.pair) && !weakSet.has(e.lit), "weak");
  ok(
    e.m.get(e.n) === e.lit &&
      e.m.get(e.lit) === e.n &&
      e.m.get(e.closure) === e.pair &&
      e.s.has(e.pair) &&
      e.s.has(e.plain),
    "small map",
  );
  ok(!e.proxy || e.proxy.id === i, "proxy");
  ok(!e.ref || e.ref.deref() === e.lit, "ref");
  ok(e.spread.extra === e.pair && e.spread.n === e.n, "spread");
  if (e.steps === 2) ok(e.it.next().value === e.n, "iterator");
}
const rounds = 6;
for (let r = 0; r < rounds; r++) {
  for (let i = 0; i < 1500; i++) live.push(make());
  live = live.filter(e => rnd(10) < 7 || (drop(e), false));
  staticRef = live[rnd(live.length)];
  const sid = staticRef.n.id;
  await new Promise(done => setTimeout(done, 1));
  if (staticRef.n.id !== sid) fail("static", sid);
  for (const e of live) check(e);
  for (const k in dyn) if (dyn[k].self !== dyn[k]) fail("dyn", k);
  if (byKey.size !== live.length) fail("size", r);
}
console.log("mismatches:", bad);
app.exit(0);
