#!/usr/bin/env python3
# generate-natives-that-read-under-indexes.py <folder>: all 510; ../parallel/natives-that-read-under-indexes/ holds 6 of them: one program for each way of laying something under 0 and 1 ABOVE an object, times each built-in that reads an object it is handed under its indexes by [[Get]].
# What is found above is of another type than any field of the object, and what comes out of the built-in is used as that type. The reference is `bun <file>`.
import os, sys

shapes = {
    "getters-of-the-class": """class Pair { constructor(k, v) { this.k = k; this.v = v; } get 0() { return first(this.k); } get 1() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);""",
    "getters-under-texts": """class Pair { constructor(k, v) { this.k = k; this.v = v; } get "0"() { return first(this.k); } get "1"() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);""",
    "methods-of-the-class": """class Pair { constructor(k, v) { this.k = k; this.v = v; } 0() { return first(this.k); } 1() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);""",
    "getters-of-a-base": """class Base { get 0() { return first(this.k); } get 1() { return second(this.v); } }
class Pair extends Base { constructor(k, v) { super(); this.k = k; this.v = v; } }
const make = (k, v) => new Pair(k, v);""",
    "getters-of-a-base-two-up": """class Base { get 0() { return first(this.k); } get 1() { return second(this.v); } }
class Middle extends Base { other() { return 1; } }
class Pair extends Middle { constructor(k, v) { super(); this.k = k; this.v = v; } }
const make = (k, v) => new Pair(k, v);""",
    "one-own-one-above": """class Pair { constructor(k, v) { this[0] = first(k); this.v = v; } get 1() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);""",
    "getters-under-computed-keys": """const zero = 0, one = 1;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get [zero]() { return first(this.k); } get [one]() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);""",
    "values-on-the-prototype-of-a-function": """function Pair(k, v) { this.k = k; this.v = v; }
Pair.prototype[0] = first(7); Pair.prototype[1] = second(7);
const make = (k, v) => new Pair(k, v);""",
    "values-on-the-prototype-of-a-function-laid-late": """function Pair(k, v) { this.k = k; this.v = v; }
const make = (k, v) => new Pair(k, v);
function late() { Pair.prototype[0] = first(7); Pair.prototype[1] = second(7); }
late();""",
    "getters-defined-on-the-prototype-of-a-function": """function Pair(k, v) { this.k = k; this.v = v; }
Object.defineProperty(Pair.prototype, 0, { get() { return first(this.k); } });
Object.defineProperty(Pair.prototype, "1", { get() { return second(this.v); } });
const make = (k, v) => new Pair(k, v);""",
    "values-on-the-prototype-of-a-class": """class Pair { constructor(k, v) { this.k = k; this.v = v; } }
Pair.prototype[0] = first(7); Pair.prototype[1] = second(7);
const make = (k, v) => new Pair(k, v);""",
    "getters-defined-on-the-prototype-of-a-class": """class Pair { constructor(k, v) { this.k = k; this.v = v; } }
Object.defineProperties(Pair.prototype, { 0: { get() { return first(this.k); } }, 1: { get() { return second(this.v); } } });
const make = (k, v) => new Pair(k, v);""",
    "heir-of-a-literal-with-getters": """const above = { get 0() { return first(this.k); }, get 1() { return second(this.v); } };
const make = (k, v) => { const pair = Object.create(above); pair.k = k; pair.v = v; return pair; };""",
    "literal-put-under-a-literal-with-getters": """const above = { get 0() { return first(this.k); }, get 1() { return second(this.v); } };
const make = (k, v) => Object.setPrototypeOf({ k, v }, above);""",
    "literal-with-proto-written": """const above = { get 0() { return first(this.k); }, get 1() { return second(this.v); } };
const make = (k, v) => ({ __proto__: above, k, v });""",
    "ordinary-pairs": """const make = (k, v) => [first(k), second(v)];""",
    "getters-of-the-literal-itself": """const make = (k, v) => ({ k, v, get 0() { return first(this.k); }, get 1() { return second(this.v); } });""",
}

texts = """const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";"""
cells = """const cells = []; for (let i = 0; i < 64; i++) cells.push({ id: "C" + i });
const first = (k) => cells[k];
const second = (v) => "V" + v + "!";"""
entries = """const list = []; for (let i = 0; i < 40; i++) list.push(make(i, i * 2));"""
like = """const like = make(3, 4); like.length = 2;"""
show_map = """let total = 0; const seen = [];
for (const [key, value] of map) { total += key.length + value.length; seen.push(typeof key === "function" ? "function" : key, typeof value === "function" ? "function" : value); }
console.log(map.size, map.has("K7"), map.get("K7"), total, seen.slice(0, 6).join());"""
show_list = """let total = 0; for (const item of out) total += item === undefined ? -1000 : item.length;
console.log(out.length, total, out.map((item) => typeof item === "function" ? "function" : item).join());"""

natives = {
    "new-map": (texts, entries, "const map = new Map(list);\n" + show_map),
    "new-map-of-an-iterator": (texts, entries, "const map = new Map(list.values());\n" + show_map),
    "new-map-of-a-set": (texts, entries, "const map = new Map(new Set(list));\n" + show_map),
    "new-map-in-a-function": (texts, entries, "function build(from) { return new Map(from); }\nconst map = build(list);\n" + show_map),
    "new-map-of-values-of-a-map": (texts, entries, "const held = new Map(); list.forEach((entry, i) => held.set(i, entry));\nconst map = new Map(held.values());\n" + show_map),
    "new-map-of-values-of-a-set": (texts, entries, "const map = new Map(new Set(list).values());\n" + show_map),
    "new-map-of-a-helper": (texts, entries, "const map = new Map(list.values().map((entry) => entry));\n" + show_map),
    "new-map-of-a-generator": (texts, entries, "function* all() { for (const entry of list) yield entry; }\nconst map = new Map(all());\n" + show_map),
    "new-map-of-a-spread": (texts, entries, "const map = new Map([...list]);\n" + show_map),
    "new-map-of-array-from": (texts, entries, "const map = new Map(Array.from(list));\n" + show_map),
    "new-map-of-a-slice": (texts, entries, "const map = new Map(list.slice());\n" + show_map),
    "new-map-of-a-concat": (texts, entries, "const map = new Map([].concat(list));\n" + show_map),
    "new-weak-map": (cells, entries, "const map = new WeakMap(list);\nlet total = 0; for (let i = 0; i < 40; i++) { const got = map.get(cells[i]); total += got === undefined ? -1000 : got.length; }\nconsole.log(map.has(cells[7]), map.get(cells[7]), total);"),
    "from-entries": (texts, entries, "const record = Object.fromEntries(list);\nlet total = 0; for (const key in record) total += typeof record[key] === \"function\" ? 1 : key.length + String(record[key]).length;\nconsole.log(Object.keys(record).length, typeof record.K7 === \"function\" ? \"function\" : record.K7, total);"),
    "array-from": (texts, like, "const out = Array.from(like);\n" + show_list),
    "array-from-with-a-callback": (texts, like, "const out = Array.from(like, (item) => item);\n" + show_list),
    "slice-call": (texts, like, "const out = Array.prototype.slice.call(like);\n" + show_list),
    "map-call": (texts, like, "const out = Array.prototype.map.call(like, (item) => item);\n" + show_list),
    "filter-call": (texts, like, "const out = Array.prototype.filter.call(like, () => true);\n" + show_list),
    "for-each-call": (texts, like, "const out = []; Array.prototype.forEach.call(like, (item) => { out.push(item); });\n" + show_list),
    "reduce-call": (texts, like, "const out = Array.prototype.reduce.call(like, (all, item) => { all.push(item); return all; }, []);\n" + show_list),
    "join-call": (texts, like, "const text = Array.prototype.join.call(like, \"-\");\nconsole.log(text.length > 40 ? \"functions\" : text);"),
    "index-of-call": (texts, like, "console.log(Array.prototype.indexOf.call(like, \"V4!\"), Array.prototype.includes.call(like, \"K3\"), Array.prototype.lastIndexOf.call(like, \"K3\"));"),
    "concat-of-what-spreads": (texts, like, "like[Symbol.isConcatSpreadable] = true;\nconst out = [].concat(like);\n" + show_list),
    "reflect-apply": (texts, like, "const out = Reflect.apply((a, b) => [a, b], null, like);\n" + show_list),
    "function-apply": (texts, like, "function both(a, b) { return [a, b]; }\nconst out = both.apply(null, like);\n" + show_list),
    "reflect-construct": (texts, like, "class Both { constructor(a, b) { this.all = [a, b]; } }\nconst out = Reflect.construct(Both, like).all;\n" + show_list),
    "string-raw": (texts, like, "const text = String.raw({ raw: like }, \"+\");\nconsole.log(text.length > 40 ? \"functions\" : text);"),
    "typed-array-of": (texts.replace('"K" + k', "k + 40").replace('"V" + v + "!"', "v + 50"), like, "const out = new Uint8Array(like);\nconsole.log(out.length, out[0] + out[1]);"),
    "typed-array-set": (texts.replace('"K" + k', "k + 40").replace('"V" + v + "!"', "v + 50"), like, "const out = new Uint8Array(2); out.set(like);\nconsole.log(out.length, out[0] + out[1]);"),
}

folder = sys.argv[1]
os.makedirs(folder, exist_ok=True)
count = 0
for shape, made in shapes.items():
    for native, (helpers, subject, use) in natives.items():
        with open(os.path.join(folder, shape + "--" + native + ".js"), "w") as file:
            file.write("\n".join([helpers, made, subject, "try {", use, "} catch (error) { console.log(error.constructor.name); }", ""]))
        count += 1
print(count, "programs")
