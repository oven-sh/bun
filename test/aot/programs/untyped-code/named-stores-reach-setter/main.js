// A store `x.name = v` in code without types, where the name is an accessor: on the prototype, on the object itself, with and
// without a setter, replaced, deleted and shadowed while the same site goes on storing.
import storeSloppily from "./sloppy.cjs";
const lines = [];
function show(...parts) { lines.push(parts.join(" ")); }
function store(object, value) { object.value = value; return object; }
function read(object) { return object.value; }
function attempt(label, action) { try { show(label, String(action())); } catch (error) { show(label, "THROWN", error instanceof TypeError ? "TypeError" : String(error)); } }

class K { x = 0; seen = 0; get value() { return this.x; } set value(v) { this.x = v; this.seen++; } }
class Sub extends K { extra = 1; }
class Deep extends Sub { more = 2; }
const k = new K, sub = new Sub, deep = new Deep;
for (let i = 0; i < 40; i++) { store(k, i); store(sub, i * 2); store(deep, i * 3); }
show("inherited", k.x, k.seen, sub.x, sub.seen, deep.x, deep.seen, read(k), read(sub), read(deep));

const own = { kept: 0, get value() { return this.kept; }, set value(v) { this.kept = v + 1; } };
for (let i = 0; i < 40; i++) store(own, i);
show("own", own.kept, read(own));

const onlySetter = Object.create({ set value(v) { this.got = v; } });
for (let i = 0; i < 40; i++) store(onlySetter, i);
show("only a setter", onlySetter.got, String(read(onlySetter)), Object.keys(onlySetter).join());

const onlyGetter = Object.create({ get value() { return 7; } });
for (let i = 0; i < 6; i++) attempt("only a getter, strict " + i, () => { "use strict"; return (function (o, v) { "use strict"; o.value = v; return o.value; })(onlyGetter, i); });
for (let i = 0; i < 6; i++) attempt("only a getter, sloppy " + i, () => storeSloppily(onlyGetter, i).value);
show("only a getter", Object.keys(onlyGetter).length);

const thrower = Object.create({ set value(v) { if (v === 33) throw new RangeError("thirty-three"); this.last = v; } });
for (let i = 30; i < 36; i++) attempt("a setter that throws " + i, () => store(thrower, i).last);

// The setter is replaced while the site is warm.
const proto = { set value(v) { this.by = "first " + v; } };
const heir = Object.create(proto);
for (let i = 0; i < 40; i++) store(heir, i);
show("before", heir.by);
Object.defineProperty(proto, "value", { set(v) { this.by = "second " + v; }, configurable: true });
store(heir, 40); show("replaced", heir.by);
Object.defineProperty(proto, "value", { value: "plain", writable: true, configurable: true });
store(heir, 41); show("a value now", heir.by, heir.value, proto.value, Object.keys(heir).join());
delete heir.value;
Object.defineProperty(proto, "value", { value: "fixed", writable: false, configurable: true });
attempt("read-only on the prototype, sloppy", () => storeSloppily(heir, 42).value);
attempt("read-only on the prototype, strict", () => (function (o, v) { "use strict"; o.value = v; return o.value; })(heir, 43));
delete proto.value;
store(heir, 44); show("deleted", heir.value, Object.keys(heir).join());

// Another prototype is put between, and the prototype is changed.
const base = { set value(v) { this.by = "base " + v; } };
const middle = Object.create(base);
const leaf = Object.create(middle);
for (let i = 0; i < 40; i++) store(leaf, i);
show("through two", leaf.by);
Object.defineProperty(middle, "value", { set(v) { this.by = "middle " + v; }, configurable: true });
store(leaf, 40); show("shadowed", leaf.by);
Object.setPrototypeOf(leaf, { set value(v) { this.by = "other " + v; } });
store(leaf, 41); show("another prototype", leaf.by);
Object.setPrototypeOf(leaf, null);
store(leaf, 42); show("no prototype", leaf.by, leaf.value);

// The setter adds a property to the receiver, deletes one, freezes it.
const grower = Object.create({ set value(v) { this["p" + (v & 3)] = v; } });
for (let i = 0; i < 12; i++) store(grower, i);
show("grows", Object.keys(grower).join(), grower.p0, grower.p3);
const freezer = Object.create({ set value(v) { if (v === 5) Object.freeze(this); else this.n = v; } });
for (let i = 0; i < 9; i++) attempt("freezes " + i, () => store(freezer, i).n);

// Many structures at one site; a proxy on the way.
const shapes = [];
for (let i = 0; i < 24; i++) { const o = new K; o["s" + i] = i; shapes.push(o); }
for (let round = 0; round < 6; round++) for (let i = 0; i < shapes.length; i++) store(shapes[i], round * 100 + i);
show("many structures", shapes.map(o => o.x).join(), shapes.reduce((n, o) => n + o.seen, 0));
const log = [];
const behindProxy = Object.create(new Proxy({}, { set(target, key, v, receiver) { log.push(String(key) + "=" + v); return true; } }));
for (let i = 0; i < 5; i++) store(behindProxy, i);
show("a proxy on the way", log.join(), Object.keys(behindProxy).length);

// The getter of the same name goes on working beside the setter, whichever is asked first.
class Both { #n = 1; get value() { return this.#n * 2; } set value(v) { this.#n = v; } }
const first = new Both, second = new Both;
let sum = 0;
for (let i = 0; i < 30; i++) { store(first, i); sum += read(first); }
for (let i = 0; i < 30; i++) { sum += read(second); store(second, i); }
show("both", sum, read(first), read(second));
console.log(lines.join("\n"));
