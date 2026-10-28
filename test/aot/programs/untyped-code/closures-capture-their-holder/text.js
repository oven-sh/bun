const lines = [];
const spell = v => typeof v === "function" ? "function " + JSON.stringify(v.name) + "/" + v.length : typeof v === "symbol" ? String(v) : typeof v === "object" && v !== null ? (Array.isArray(v) ? "[" + v.map(spell).join() + "]" : "{" + Object.keys(v).join() + "}") : typeof v + " " + String(v);
const show = (title, f) => { let text; try { text = spell(f()); } catch (e) { text = "throws " + e.constructor.name; } lines.push(title + ": " + text); };
const collect = () => { if (typeof gc === "function") gc(); };

const make = a => { const o = { a }; o.plus = x => o.a + x; o.minus = (x, y) => o.a - x - (y || 0); o.self = () => o; o.later = async x => o.a * x; o.plain = function (x) { return [o.a, this === o, x].join(); }; return o; };
class Bound { constructor(a) { this.a = a; this.get = this.get.bind(this); this.add = this.add.bind(this); this.arrow = () => this.a; } get() { return this.a; } add(x, y) { return this.a + x + y; } }
class Heir extends Bound { constructor(a) { super(a); this.more = () => this.a + 1; } get() { return "heir " + this.a; } }
const makers = { make, bound: a => new Bound(a), heir: a => new Heir(a) };
const names = { make: ["plus", "minus", "self", "later", "plain"], bound: ["get", "add", "arrow"], heir: ["get", "add", "arrow", "more"] };

for (const kind of Object.keys(makers)) {
    const fresh = () => makers[kind](7);
    for (const name of names[kind]) {
        const t = kind + "." + name + " ";
        show(t + "called", () => fresh()[name](1, 2));
        show(t + "called twice", () => { const o = fresh(); o[name](1, 2); return o[name](3, 4); });
        show(t + "same", () => { const o = fresh(); return o[name] === o[name]; });
        show(t + "same after a call", () => { const o = fresh(); const r = o[name](1, 2); return o[name] === o[name]; });
        show(t + "same by two ways", () => { const o = fresh(); return Object.values(o).includes(o[name]) && Object.getOwnPropertyDescriptor(o, name).value === o[name] && ({ ...o })[name] === o[name]; });
        show(t + "another for another", () => fresh()[name] !== fresh()[name]);
        show(t + "value", () => fresh()[name]);
        show(t + "detached", () => { const f = fresh()[name]; return f(1, 2); });
        show(t + "on another", () => fresh()[name].call({ a: 100 }, 1, 2));
        show(t + "inherited", () => Object.create(fresh())[name](1, 2));
        show(t + "inherited, same", () => { const o = fresh(); return Object.create(o)[name] === o[name]; });
        show(t + "descriptor", () => { const d = Object.getOwnPropertyDescriptor(fresh(), name); return [typeof d.value, d.writable, d.enumerable, d.configurable, "get" in d].join(); });
        show(t + "has", () => { const o = fresh(); return [name in o, Object.hasOwn(o, name), o.propertyIsEnumerable(name)].join(); });
        show(t + "stored to", () => { const o = fresh(); o[name] = 5; return [o[name], Object.keys(o).join()].join(" "); });
        show(t + "stored to behind a read", () => { const o = fresh(); const f = o[name]; o[name] = 5; return [o[name], typeof f, Object.keys(o).join()].join(" "); });
        show(t + "deleted", () => { const o = fresh(); return [delete o[name], typeof o[name], Object.keys(o).join()].join(" "); });
        show(t + "deleted and back", () => { const o = fresh(); delete o[name]; o[name] = "back"; return Object.keys(o).join(); });
        show(t + "hidden", () => { const o = fresh(); Object.defineProperty(o, name, { enumerable: false }); return [Object.keys(o).join(), typeof o[name], o[name] === o[name]].join(" "); });
        show(t + "made read-only", () => { const o = fresh(); Object.defineProperty(o, name, { writable: false }); const f = o[name]; try { o[name] = 1; } catch (e) { return "throws " + e.constructor.name + " " + (o[name] === f); } return o[name] === f; });
        show(t + "made an accessor", () => { const o = fresh(); Object.defineProperty(o, name, { get() { return "got"; } }); return o[name]; });
        show(t + "frozen", () => { const o = Object.freeze(fresh()); return [Object.isFrozen(o), o[name] === o[name], typeof o[name], Object.getOwnPropertyDescriptor(o, name).writable].join(); });
        show(t + "frozen behind a read", () => { const o = fresh(); const f = o[name]; Object.freeze(o); return [Object.isFrozen(o), o[name] === f].join(); });
        show(t + "sealed", () => { const o = Object.seal(fresh()); return [Object.isSealed(o), o[name] === o[name], delete o[name] === false].join(); });
        show(t + "key of a map", () => { const o = fresh(); const m = new Map([[o[name], 1]]); return m.get(o[name]); });
        show(t + "own property", () => { const o = fresh(); o[name].tag = "t"; return o[name].tag; });
    }
    show(kind + " keys", () => Object.keys(fresh()).join());
    show(kind + " own keys", () => Reflect.ownKeys(fresh()).join());
    show(kind + " for in", () => { const seen = []; for (const k in fresh()) seen.push(k); return seen.join(); });
    show(kind + " values", () => Object.values(fresh()).map(v => typeof v).join());
    show(kind + " entries", () => Object.entries(fresh()).map(e => e[0] + ":" + typeof e[1]).join());
    show(kind + " spread", () => { const o = fresh(), c = { ...o }; return Object.keys(c).join() + " " + names[kind].map(n => c[n] === o[n]).join(); });
    show(kind + " spread is bound to the first", () => { const o = fresh(), c = { ...o, a: 1000 }; return names[kind].map(n => String(c[n](1, 2))).join("|"); });
    show(kind + " assign", () => { const o = fresh(), c = Object.assign({}, o); return names[kind].map(n => c[n] === o[n]).join(); });
    show(kind + " rest", () => { const o = fresh(); const { a, ...rest } = o; return Object.keys(rest).join() + " " + names[kind].map(n => rest[n] === o[n]).join(); });
    show(kind + " descriptors", () => Object.entries(Object.getOwnPropertyDescriptors(fresh())).map(([k, d]) => k + ":" + typeof d.value + d.writable + d.enumerable + d.configurable).join());
    show(kind + " JSON", () => JSON.stringify(fresh()));
    show(kind + " fromEntries", () => { const o = fresh(), c = Object.fromEntries(Object.entries(o)); return names[kind].map(n => c[n] === o[n]).join(); });
    show(kind + " more properties", () => { const o = fresh(); for (let i = 0; i < 40; i++) o["p" + i] = i; return names[kind].map(n => String(o[n](1, 2))).join("|") + " " + Object.keys(o).length; });
    show(kind + " a dictionary", () => { const o = fresh(); for (let i = 0; i < 300; i++) o["p" + i] = i; for (let i = 0; i < 300; i += 2) delete o["p" + i]; return names[kind].map(n => String(o[n](1, 2)) + (o[n] === o[n])).join("|"); });
    show(kind + " another prototype", () => { const o = fresh(); Object.setPrototypeOf(o, { z: 1 }); return names[kind].map(n => typeof o[n]).join() + o.z; });
    show(kind + " many, collected", () => { const kept = []; for (let i = 0; i < 3000; i++) { const o = makers[kind](i); if (i % 500 === 0) kept.push(o); if (i % 1000 === 999) collect(); } collect(); return kept.map(o => names[kind].map(n => typeof o[n](1, 2)).join("")).join("|"); });
}

// Where the store does not simply add a property.
const put = { on(o) { o.m = () => o; return o; } };
const cases = {
    hasItAlready: () => ({ m: 1, z: 2 }),
    setterAbove: () => Object.create({ set m(v) { lines.push("the setter saw " + typeof v); } }),
    getterOnlyAbove: () => Object.create({ get m() { return "from above"; } }),
    readOnlyAbove: () => Object.create(Object.defineProperty({}, "m", { value: "fixed", writable: false })),
    valueAbove: () => Object.create({ m: "shadowed" }),
    notExtensible: () => Object.preventExtensions({ z: 1 }),
    frozen: () => Object.freeze({ z: 1 }),
    array: () => [1, 2],
    functionObject: () => function f() {},
    withoutPrototype: () => Object.create(null),
    proxy: () => new Proxy({}, { set(t, k, v, r) { lines.push("trap " + String(k) + " " + typeof v); return Reflect.set(t, k, v, r); } }),
    heirOfProxy: () => Object.create(new Proxy({}, { set(t, k, v, r) { lines.push("trap above " + String(k)); return Reflect.set(t, k, v, r); } })),
    map: () => new Map(),
    date: () => new Date(0),
    text: () => "text",
    number: () => 5,
    nil: () => null,
    absent: () => undefined,
    symbol: () => Symbol("s"),
};
for (const title of Object.keys(cases)) {
    for (let turn = 0; turn < 3; turn++)
        show("put on " + title + " " + turn, () => { const o = put.on(cases[title]()); return [typeof o.m, typeof o.m === "function" && o.m() === o, Object.hasOwn(Object(o), "m"), o.m === o.m].join(); });
}

// One shape, one name, two functions.
const either = { make(flag) { const o = { a: flag ? 1 : 2 }; if (flag) o.m = () => "first " + o.a; else o.m = () => "second " + o.a; return o; } };
show("two functions under one name", () => { const out = []; for (let i = 0; i < 12; i++) out.push(either.make(i % 3 === 0).m()); return out.join(); });
// Not of the kind: used twice, captures more, captures another.
show("stored twice", () => { const o = {}; o.a = o.b = () => o; return [o.a === o.b, o.a() === o].join(); });
show("captures more", () => { const o = {}, k = { v: 3 }; o.m = () => [o === o.m.holder, k.v].join(); o.m.holder = o; return o.m(); });
show("captures another", () => { const o = {}, p = { v: 4 }; o.m = () => p.v; return o.m(); });
show("index for a name", () => { const o = {}; o[0] = () => o; o["1"] = () => o; return [o[0]() === o, o[1]() === o, Object.keys(o).join()].join(); });
show("__proto__ for a name", () => { const o = {}; o.__proto__ = () => o; return [typeof Object.getPrototypeOf(o), Object.keys(o).length].join(); });
show("constructed", () => { const o = { a: 1 }; o.Make = function () { this.from = o.a; }; return [new o.Make().from, o.Make.prototype.constructor === o.Make, new o.Make() instanceof o.Make].join(); });
show("the text of it", () => { const o = {}; o.m = () => o; return typeof String(o.m); });
show("read in its own body", () => { const o = {}; o.m = () => o.m; return o.m() === o.m; });
show("a getter beside it", () => { const o = { get twice() { return this.m() * 2; } }; o.v = 4; o.m = () => o.v; return o.twice; });

// The same again and again at one site, so that whatever cache there is has been filled: by one shape, by many shapes in turn, with collections between.
const shapes = [];
for (let k = 0; k < 40; k++) shapes.push(a => { const o = { a }; for (let i = 0; i < k % 9; i++) o["p" + k + "_" + i] = i; return o; });
const give = { to(o) { o.one = x => o.a + x; o.two = () => o; o.three = (x, y) => [o.a, x, y].join(); return o; } };
const warm = {
    oneShape() { let sum = 0; for (let i = 0; i < 400; i++) { const o = give.to({ a: i }); sum += o.one(1) + (o.two() === o ? 1 : 1000000) + o.three(1, 2).length; } return sum; },
    manyShapes() { let sum = 0; for (let i = 0; i < 1200; i++) { const o = give.to(shapes[i % 40](i)); sum += o.one(1) + (o.two() === o ? 1 : 1000000) + Object.keys(o).length; if (i % 400 === 399) collect(); } return sum; },
    neverRead() { let sum = 0; for (let i = 0; i < 1200; i++) { const o = give.to(shapes[i % 40](i)); sum += o.a; } return sum; },
    readLater() { const kept = []; for (let i = 0; i < 1200; i++) kept.push(give.to(shapes[i % 40](i))); collect(); let sum = 0; for (const o of kept) sum += o.one(2) + (o.two() === o ? 1 : 1000000); return sum; },
    spread() { let good = 0; for (let i = 0; i < 400; i++) { const o = give.to(shapes[i % 5](i)), c = { ...o }; good += c.one === o.one && c.two() === o && c.one(1) === i + 1 ? 1 : 0; } return good; },
    assign() { let good = 0; for (let i = 0; i < 400; i++) { const o = give.to(shapes[i % 5](i)), c = Object.assign({ z: 1 }, o); good += c.three === o.three && c.two() === o ? 1 : 0; } return good; },
    rest() { let good = 0; for (let i = 0; i < 400; i++) { const o = give.to(shapes[i % 5](i)); const { a, ...r } = o; good += r.one === o.one && r.two() === o && a === i ? 1 : 0; } return good; },
    values() { let good = 0; for (let i = 0; i < 400; i++) { const o = give.to(shapes[i % 5](i)); good += Object.values(o).filter(v => typeof v === "function").length === 3 && Object.entries(o).every(e => o[e[0]] === e[1]) ? 1 : 0; } return good; },
    forIn() { let count = 0; for (let i = 0; i < 400; i++) { const o = give.to(shapes[i % 5](i)); for (const k in o) count += typeof o[k] === "function" ? 1 : 0; } return count; },
    byKey() { let good = 0; const keys = ["one", "two", "three"]; for (let i = 0; i < 1200; i++) { const o = give.to(shapes[i % 7](i)); good += typeof o[keys[i % 3]] === "function" && o[keys[i % 3]] === o[keys[i % 3]] ? 1 : 0; } return good; },
    storedOver() { let sum = 0; for (let i = 0; i < 400; i++) { const o = give.to(shapes[i % 5](i)); o.one = i; o.two = o.three; sum += o.one + (o.two === o.three ? 1 : 1000000); } return sum; },
    storesBehind() { let sum = 0; for (let i = 0; i < 1200; i++) { const o = give.to(shapes[i % 40](i)); o.later = i; o.more = 1; sum += o.later + o.more + Object.keys(o).length; } return sum; },
    setterComesLate() { const above = {}; const made = []; for (let i = 0; i < 300; i++) { if (i === 200) Object.defineProperty(above, "one", { set(v) { made.push(typeof v); }, configurable: true }); const o = Object.create(above); o.a = i; give.to(o); if (i >= 198 && i < 203) made.push(Object.hasOwn(o, "one")); } return made.length + " " + made.slice(0, 8).join(); },
    frozenInTurn() { let thrown = 0, good = 0; for (let i = 0; i < 300; i++) { const o = shapes[i % 5](i); if (i % 3 === 0) Object.preventExtensions(o); try { give.to(o); good++; } catch (e) { thrown++; } } return good + " " + thrown; },
    thereAlready() { let good = 0; for (let i = 0; i < 1200; i++) { const o = shapes[i % 40](i); o.one = "was"; o.z = i; give.to(o); good += o.one(1) === i + 1 && o.one === o.one && Object.keys(o).indexOf("one") < Object.keys(o).indexOf("z") ? 1 : 0; } return good; },
    thereAlreadyHidden() { let good = 0; for (let i = 0; i < 300; i++) { const o = shapes[i % 5](i); Object.defineProperty(o, "one", { value: 0, writable: true, enumerable: false, configurable: true }); give.to(o); const d = Object.getOwnPropertyDescriptor(o, "one"); good += !d.enumerable && d.writable && d.configurable && typeof d.value === "function" && !Object.keys(o).includes("one") ? 1 : 0; } return good; },
    thereAlreadyFixed() { let thrown = 0; for (let i = 0; i < 300; i++) { const o = shapes[i % 5](i); Object.defineProperty(o, "one", { value: 0, writable: false, configurable: true }); try { give.to(o); } catch (e) { thrown += o.one === 0 ? 1 : 0; } } return thrown; },
    generators() { let sum = 0; for (let i = 0; i < 300; i++) { const o = shapes[i % 5](i); o.each = function* () { yield o.a; yield o.a + 1; }; o.wait = async function* () { yield o.a; }; for (const v of o.each()) sum += v; sum += typeof o.wait().next === "function" && o.each === o.each && Object.getPrototypeOf(o.each) === Object.getPrototypeOf(function* () {}) ? 1 : 1000000; } return sum; },
    named() { let good = 0; for (let i = 0; i < 300; i++) { const o = shapes[i % 5](i); o.again = function self(n) { return n ? self(n - 1) : o.a; }; good += o.again(3) === i && o.again.name === "self" ? 1 : 0; } return good; },
    otherSitesMeetTheEntry() {
        for (let i = 0; i < 80; i++) give.to(shapes[i % 40](i));
        const plainly = { byName(o) { o.one = 5; return o; }, byKey(o, k) { o[k] = 5; return o; } };
        const keys = ["one", "two"]; const seen = new Set();
        for (let i = 0; i < 40; i++) {
            for (const o of [plainly.byName(shapes[i](i)), plainly.byKey(shapes[i](i), keys[0]), plainly.byKey(shapes[i](i), keys[1])]) {
                const k = Object.hasOwn(o, "one") ? "one" : "two"; const d = Object.getOwnPropertyDescriptor(o, k); const first = o[k]; o[k] = 6;
                seen.add([d.value, d.writable, d.enumerable, d.configurable, first, o[k], Object.values(o).includes(6)].join());
            }
        }
        return [...seen].join(" | ");
    },
    holderIsNoCell() { const seen = []; for (const v of [5, "text", true, 7n, Symbol.iterator, undefined, null]) { for (let i = 0; i < 3; i++) give.to(shapes[i](i)); try { give.to(v); seen.push("no throw"); } catch (e) { seen.push(e.constructor.name); } } return seen.join(); },
    json() { let length = 0; for (let i = 0; i < 300; i++) length += JSON.stringify(give.to(shapes[i % 5](i))).length; return length; },
    heirs() { let good = 0; for (let i = 0; i < 300; i++) { const o = give.to(shapes[i % 5](i)), h = Object.create(o); h.a = -1; good += h.one(1) === i + 1 && h.two() === o && !Object.hasOwn(h, "one") ? 1 : 0; h.one = 5; good += h.one === 5 && typeof o.one === "function" ? 1 : 0; } return good; },
};
for (const title of Object.keys(warm)) show("warm " + title, warm[title]);
make(1).later(3).then(v => { lines.push("async " + v); console.log(lines.join("\n")); });
