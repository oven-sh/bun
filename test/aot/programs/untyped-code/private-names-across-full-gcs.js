// A server that lives long: classes with private names, with fields under symbols, and copies of property descriptors, whose objects are made for a request and are all gone when a full collection comes. What the run
// time has learnt about them dies with their shapes and is learnt again; that may be done any number of times. Three hundred rounds, a full collection behind each: the objects stay what they are, and the last round
// asks the run time no more than the second did. Only the jsc shell can count; elsewhere the counts are zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : typeof Bun === "object" ? () => Bun.gc(true) : () => {};
class Inner { #a; #b; raw; path; index = 0; cache = {}; constructor(raw, path) { this.raw = raw; this.path = path; this.#a = 1; this.#b = 2; } sum() { return this.#a + this.#b + this.index + this.raw; } }
class Outer {
    #raw; #inner; env = {}; #vars; done = false; error; #status; #res; #path;
    constructor(raw, options) { this.#raw = raw; this.#path = options.path; this.#status = 200; }
    get inner() { return this.#inner ??= new Inner(this.#raw, this.#path); }
    status() { return this.#status + (this.#vars === undefined ? 0 : 1) + (this.#res === undefined ? 0 : 1); }
}
const kFirst = Symbol("first"), kSecond = Symbol("second"), kThird = Symbol("third");
class Marked { [kFirst] = 1; [kSecond] = 2; plain = 3; [kThird] = 4; sum() { return this[kFirst] + this[kSecond] + this.plain + this[kThird]; } }
function Stamped(n) { this[kFirst] = n; this[kSecond] = n + 1; this[kThird] = n + 2; }
const copyOf = source => Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
const sources = [{ a: 1, b: 2 }, { c: 1, d: 2, e: 3 }, { f: 1, g: 2 }, { h: 1, i: 2, j: 3, k: 4 }, { l: 1, m: 2 }, { n: 1, o: 2 }, { p: 1, q: 2, r: 3 }, { s: 1, t: 2 }];
const names = ["operationAOTTryPutProperties", "operationAOTPrivateFieldAdd", "operationAOTDefineField", "operationAOTPutByIdAndCache"];
const asked = () => names.map(count);
let check = 0, second = null, last = null;
const shown = new Set();
for (let round = 0; round < 300; round++) {
    const before = asked();
    for (let i = 0; i < 100; i++) {
        const outer = new Outer(i, { path: "/" }), marked = new Marked(), stamped = new Stamped(i);
        check = (check + outer.status() + outer.inner.sum() + marked.sum() + stamped[kFirst] + stamped[kThird]) % 1000003;
        for (const source of sources) check = (check + Object.values(copyOf(source)).length) % 1000003;
        if (i === 99) shown.add([Object.keys(outer).join(), Object.keys(outer.inner).join(), Reflect.ownKeys(marked).map(String).join(), Reflect.ownKeys(stamped).map(String).join(), sources.map(source => Object.keys(copyOf(source)).join("")).join()].join(" | "));
    }
    last = asked().map((n, k) => n - before[k]);
    if (round === 1) second = last;
    collect();
}
console.log([...shown].join("\n"));
console.log(check);
console.log("the last of 300 rounds asks the run time no more than the second: " + last.every((n, k) => n <= second[k]));
