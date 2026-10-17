// Several stores by name in a row: in small functions that are copied into their callers, in loops, beside stores under symbols, twice with the same names in one
// function, and on receivers that make the run fall back to one store at a time. Covers the order of properties, the order of effects and where an error is thrown.
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => String(k) + "=" + String(o[k])).join();
const tag = Symbol("tag");
function fill(o, a, b, c) { o.first = a; o.second = b; o.third = c; return o; }
function fillMore(o, n) { o.alpha = n; o.beta = n + 1; o.gamma = n + 2; o.delta = n + 3; o.epsilon = n + 4; return o; }
function fillUnderSymbol(o, n) { o.before = n; o[tag] = n + 1; o.after = n + 2; return o; }
function fillTwice(p, q, n) { p.first = n; p.second = n + 1; p.third = n + 2; q.first = -n; q.second = -n - 1; q.third = -n - 2; return [p, q]; }
function several(n) { return [fill({}, n, n + 1, n + 2), fillMore({}, n), fill({ zero: 0 }, n, "s", null), fillUnderSymbol({}, n), ...fillTwice({}, { own: 1 }, n)]; }
for (let round = 0; round < 40; round++) {
    const made = several(round);
    if (round % 13 === 0) lines.push("round " + round + " " + made.map(show).join(" | "));
}
function place(error) { const found = /:(\d+):\d+\)?$/.exec(String(error.stack).split("\n").find(line => /fill/.test(line)) ?? ""); return found ? "line " + found[1] : "no line"; }
function attempt(label, make) {
    for (let i = 0; i < 6; i++) {
        const before = lines.length;
        try { const o = fill(make(i), i, i + 1, i + 2); lines.push(label + " " + i + " " + show(o)); } catch (error) { lines.push(label + " " + i + " THROWN " + error.constructor.name + " " + place(error) + " after " + (lines.length - before) + " lines"); }
    }
}
attempt("no prototype", () => Object.create(null));
attempt("a setter on the prototype", () => Object.create({ set second(v) { lines.push("  setter " + v + " sees " + show(this)); } }));
attempt("a setter that throws", () => Object.create({ set second(v) { throw new RangeError("no " + v); } }));
attempt("a getter alone", () => Object.create({ get third() { return 1; } }));
attempt("read-only on the prototype", () => Object.create(Object.freeze({ first: 0 })));
attempt("frozen", () => Object.freeze({ zero: 0 }));
attempt("sealed with one of them", () => Object.seal({ second: "was" }));
attempt("not extensible", () => Object.preventExtensions({ first: "was", second: "was" }));
attempt("has them already", () => ({ third: "c", first: "a", second: "b" }));
attempt("has one of them", i => (i & 1 ? { second: "b" } : { other: 1, third: "c" }));
attempt("a function", () => function named() {});
attempt("an arrow function", () => () => 1);
attempt("an array", () => [7, 8]);
attempt("a Map", () => new Map());
attempt("an instance", () => new (class Point { x = 1; set third(v) { this.y = v; } })());
attempt("many properties", () => Object.fromEntries(Array.from({ length: 70 }, (_, k) => ["k" + k, k]).slice(68)));
attempt("a dictionary", () => { const o = {}; for (let k = 0; k < 80; k++) o["d" + k] = k; for (let k = 0; k < 79; k++) delete o["d" + k]; return o; });
attempt("a proxy", () => new Proxy({}, { set(target, key, value) { lines.push("  trap " + String(key)); target[key] = value; return key !== "third"; } }));
attempt("a number", () => 5);
attempt("a string", () => "text");
attempt("null", () => null);
attempt("undefined", () => undefined);
let shared = 1;
function fillFromVariable(o) { o.first = shared; o.second = shared; o.third = shared; return o; }
for (let i = 0; i < 6; i++) lines.push("a variable that a setter changes " + show(fillFromVariable(Object.create({ set first(v) { shared += 10; } }))));
function Shape(a, b) { this.kind = "shape"; this.a = a; this.b = b; this.sum = a + b; }
Shape.prototype.describe = function () { return show(this); };
for (let i = 0; i < 20; i++) { const shape = new Shape(i, i * 2); if (i % 9 === 0) lines.push("constructed " + shape.describe()); }
console.log(lines.join("\n"));
