// Object.defineProperty() with a descriptor literal that adds a new property: every combination of flags, every kind of key, and several kinds of ordinary receivers.
const lines = [];
const spell = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? ["value", "writable", "get", "set", "enumerable", "configurable"].filter(n => n in d).map(n => n + "=" + (typeof d[n] === "function" ? "function" : String(d[n]))).join() : "none"; };
const show = (title, f) => { let text; try { text = String(f()); } catch (e) { text = "throws " + e.constructor.name + ": " + e.message; } lines.push(title + ": " + text); };
const whole = o => Reflect.ownKeys(o).map(k => String(k) + "{" + spell(o, k) + "}").join(" ") + " | keys " + Object.keys(o).join() + " | in " + (() => { const seen = []; for (const k in o) seen.push(k); return seen.join(); })();

const definitions = {
    valueAlone(o, k, v) { return Object.defineProperty(o, k, { value: v }); },
    writable(o, k, v) { return Object.defineProperty(o, k, { value: v, writable: true }); },
    enumerable(o, k, v) { return Object.defineProperty(o, k, { value: v, enumerable: true }); },
    configurable(o, k, v) { return Object.defineProperty(o, k, { value: v, configurable: true }); },
    allTrue(o, k, v) { return Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); },
    allFalse(o, k, v) { return Object.defineProperty(o, k, { value: v, writable: false, enumerable: false, configurable: false }); },
    writableAlone(o, k) { return Object.defineProperty(o, k, { writable: true }); },
    flagsAlone(o, k) { return Object.defineProperty(o, k, { enumerable: true, configurable: true }); },
    getter(o, k, v) { return Object.defineProperty(o, k, { get() { return v; } }); },
    setter(o, k) { return Object.defineProperty(o, k, { set(x) { lines.push("set " + String(x)); } }); },
    both(o, k, v) { return Object.defineProperty(o, k, { get() { return v; }, set(x) { v = x; }, enumerable: true, configurable: true }); },
    getterUndefined(o, k) { return Object.defineProperty(o, k, { get: undefined, enumerable: true }); },
    setterUndefined(o, k, v) { return Object.defineProperty(o, k, { get() { return v; }, set: undefined }); },
    getterNoFunction(o, k) { return Object.defineProperty(o, k, { get: 1 }); },
    setterNoFunction(o, k) { return Object.defineProperty(o, k, { set: "text" }); },
};
const symbol = Symbol("own");
const keys = { name: "name", other: "other", symbol, index: "0", largeIndex: "4294967294", noIndex: "4294967295", negative: "-1", fraction: "1.5", empty: "", proto: "__proto__", number: 7, length: "length", constructor: "constructor", toString: "toString" };
class Base { method() { return "base"; } get accessor() { return "inherited"; } }
class Derived extends Base {}
const receivers = {
    empty: () => ({}),
    two: () => ({ a: 1, b: 2 }),
    nine: () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 }),
    noPrototype: () => Object.create(null),
    inherits: () => Object.create({ name: "inherited", other: 1 }),
    inheritsReadOnly: () => Object.create(Object.freeze({ name: "frozen above", other: 1 })),
    inheritsSetter: () => Object.create({ set name(x) { lines.push("the inherited setter ran"); }, get other() { return "inherited getter"; } }),
    instance: () => new Derived(),
    dictionary: () => { const o = {}; for (let i = 0; i < 200; i++) o["p" + i] = i; for (let i = 0; i < 199; i++) delete o["p" + i]; return o; },
    deleted: () => { const o = { name: 1, other: 2, z: 3 }; delete o.name; delete o.other; return o; },
    sealed: () => Object.seal({ a: 1 }),
    withElements: () => { const o = { a: 1 }; o[0] = "zero"; o[3] = "three"; return o; },
};
for (const definition of Object.keys(definitions)) {
    for (const receiver of Object.keys(receivers)) {
        for (const key of Object.keys(keys))
            show(definition + " " + receiver + " " + key, () => { const o = receivers[receiver](); const r = definitions[definition](o, keys[key], 7); return (r === o) + " " + spell(o, keys[key]) + (receiver === "dictionary" ? "" : " # " + whole(o)); });
    }
}

show("the same site, many shapes", () => {
    const out = [];
    for (let turn = 0; turn < 40; turn++) {
        const o = {};
        for (let i = 0; i < turn % 7; i++) o["f" + i] = i;
        definitions.valueAlone(o, "hidden", turn);
        definitions.both(o, "lazy", turn);
        out.push(Object.keys(o).length + ":" + o.hidden + ":" + o.lazy);
    }
    return out.join(" ");
});
show("defined, then stored to", () => { "use strict"; const o = definitions.valueAlone({}, "fixed", 1); try { o.fixed = 2; } catch (e) { return e.constructor.name + " " + o.fixed; } return "stored " + o.fixed; });
show("defined, then deleted", () => { "use strict"; const o = definitions.valueAlone({}, "fixed", 1); try { delete o.fixed; } catch (e) { return e.constructor.name + " " + o.fixed; } return "deleted " + o.fixed; });
show("defined, then defined again", () => { const o = definitions.configurable({}, "again", 1); definitions.allTrue(o, "again", 2); return spell(o, "again"); });
show("defined, then refused", () => { const o = definitions.valueAlone({}, "again", 1); definitions.allTrue(o, "again", 2); return spell(o, "again"); });
show("defined with the same value", () => { const o = definitions.valueAlone({}, "again", 1); definitions.valueAlone(o, "again", 1); return spell(o, "again"); });
show("an accessor becomes a value", () => { const o = definitions.both({}, "x", 1); definitions.allTrue(o, "x", 5); return spell(o, "x"); });

show("on a prototype that has been read through", () => {
    const prototype = {};
    const object = Object.create(prototype);
    const read = o => o.late;
    const before = [read(object), read(object), read(object)].join();
    definitions.valueAlone(prototype, "late", "now");
    const after = [read(object), read(object)].join();
    definitions.getter(prototype, "later", "by getter");
    return before + " " + after + " " + object.later;
});
show("on a prototype, over what is inherited from above", () => {
    const top = { shared: "top" };
    const middle = Object.create(top);
    const bottom = Object.create(middle);
    const read = o => o.shared;
    const before = [read(bottom), read(bottom), read(bottom)].join();
    definitions.enumerable(middle, "shared", "middle");
    return before + " " + read(bottom) + " " + read(bottom);
});
show("order of keys", () => { const o = { z: 1 }; definitions.enumerable(o, "b", 1); definitions.enumerable(o, "2", 1); definitions.enumerable(o, symbol, 1); definitions.enumerable(o, "a", 1); definitions.enumerable(o, "1", 1); return Reflect.ownKeys(o).map(String).join(); });
show("JSON and spread see what is enumerable", () => { const o = { a: 1 }; definitions.valueAlone(o, "hidden", 2); definitions.enumerable(o, "shown", 3); definitions.both(o, "computed", 4); return JSON.stringify(o) + " " + JSON.stringify({ ...o }) + " " + JSON.stringify(Object.assign({}, o)); });
show("many objects, one road", () => { let sum = 0; for (let i = 0; i < 3000; i++) { const o = { a: i }; definitions.valueAlone(o, "hidden", i); definitions.getter(o, "twice", i * 2); sum += o.hidden + o.twice + Object.keys(o).length; } return sum; });
show("storage grows", () => { const o = {}; for (let i = 0; i < 40; i++) definitions.enumerable(o, "k" + i, i); let sum = 0; for (const k in o) sum += o[k]; return sum + " " + Object.keys(o).length; });
console.log(lines.join("\n"));
