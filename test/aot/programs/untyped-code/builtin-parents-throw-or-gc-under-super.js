const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const frames = error => String(error.stack).split("\n").map(line => line.replace(/@.*|\s*\(.*|^\s*at\s+/g, "").trim().replace(/^new /, "")).filter(name => /^[A-Za-z]+$/.test(name) && name !== "construct").slice(0, 4).join(" < ");

class Rows extends Array { constructor(...given) { super(...given); this.tag = "rows"; } }
class Later extends Promise { constructor(executor) { super(executor); this.tag = "later"; } }
class Table extends Map { constructor(entries) { super(entries); this.tag = "table"; } }
class Bag extends Set { constructor(values) { super(values); this.tag = "bag"; } }
class Bytes extends Uint8Array { constructor(...given) { super(...given); this.tag = "bytes"; } }
class Weak extends WeakMap { constructor(entries) { super(entries); this.tag = "weak"; } }
class Pattern extends RegExp { constructor(source, flags) { super(source, flags); this.tag = "pattern"; } }
class Buffered extends ArrayBuffer { constructor(length) { super(length); this.tag = "buffered"; } }
class Moment extends Date { constructor(...given) { super(...given); this.tag = "moment"; } }

const attempt = (label, make) => {
    let last = "";
    for (let i = 0; i < 40; i++) {
        try { const made = make(i); last = "made " + made.tag; } catch (error) { last = error.constructor.name + " | " + (typeof error.stack) + " | " + frames(error); }
    }
    console.log(label + ":", last);
};
function makesRows() { return new Rows(-1); }
function makesLater() { return new Later(5); }
function makesTable() { return new Table(5); }
function makesTableOfOddEntries() { return new Table([1]); }
function makesBag() { return new Bag(5); }
function makesBytes() { return new Bytes(-1); }
function makesWeak() { return new Weak([[1, 1]]); }
function makesPattern() { return new Pattern("(", "g"); }
function makesPatternWithOddFlags() { return new Pattern("a", "zz"); }
function makesBuffered() { return new Buffered(-1); }
attempt("an array of a length that is none", makesRows);
attempt("a promise without an executor", makesLater);
attempt("a map of what cannot be iterated", makesTable);
attempt("a map of entries that are no objects", makesTableOfOddEntries);
attempt("a set of what cannot be iterated", makesBag);
attempt("a typed array of a length that is none", makesBytes);
attempt("a weak map with a key that is no object", makesWeak);
attempt("a pattern that does not close", makesPattern);
attempt("a pattern with flags that are none", makesPatternWithOddFlags);
attempt("a buffer of a length that is none", makesBuffered);

function throwsInExecutor() { return new Later(() => { throw new RangeError("inside"); }); }
attempt("an executor that throws rejects", () => { const made = throwsInExecutor(); made.catch(() => { }); return made; });
function looksFromExecutor() { let seen; new Later(() => { seen = new Error("look"); }); return seen; }
for (let i = 0; i < 40; i++) looksFromExecutor();
console.log("the stack seen from inside an executor:", frames(looksFromExecutor()));
function looksFromIterator() { let seen; new Table({ [Symbol.iterator]() { seen = new Error("look"); return [][Symbol.iterator](); } }); return seen; }
for (let i = 0; i < 40; i++) looksFromIterator();
console.log("from inside the iterator a map is filled from:", frames(looksFromIterator()));
function throwsFromIterator() { return new Bag({ [Symbol.iterator]() { return { next() { throw new SyntaxError("from next"); } }; } }); }
attempt("an iterator that throws", throwsFromIterator);
function throwsFromAdder() { class Odd extends Set { add() { throw new EvalError("from add"); } constructor(values) { super(values); } } return new Odd([1]); }
attempt("an adder that throws", throwsFromAdder);
function throwsFromValueOf() { return new Moment({ valueOf() { throw new URIError("from valueOf"); } }); }
attempt("a date of a value that throws", throwsFromValueOf);
function throwsFromPrototypeOfNewTarget() { const made = Reflect.construct(Rows, [1], new Proxy(function () { }, { get(target, key) { if (key === "prototype") throw new ReferenceError("from the proxy"); return target[key]; } })); return made; }
attempt("new.target that throws when asked for its prototype", throwsFromPrototypeOfNewTarget);

let total = 0;
for (let i = 0; i < 60; i++) {
    const later = new Later(resolve => { collect(); resolve({ then(done) { collect(); done(i); } }); });
    const table = new Table({ *[Symbol.iterator]() { collect(); yield [{ key: i }, [i]]; collect(); yield [{ key: -i }, [i, i]]; } });
    const bag = new Bag({ *[Symbol.iterator]() { yield { i }; collect(); yield { i }; } });
    const rows = new Rows({ i }, [i], "text" + i);
    collect();
    const mapped = rows.map(value => { collect(); return [value]; });
    const bytes = new Bytes({ length: 3, get 0() { collect(); return i; }, 1: 2, 2: 3 });
    total += table.size + bag.size + rows.length + mapped.length + bytes[0] + [...table.values()].reduce((sum, list) => sum + list.length, 0) + (mapped instanceof Rows ? 1 : 0) + (later.tag === "later" ? 1 : 0);
    later.then(value => { total += value; });
}
await Promise.resolve();
await new Promise(resolve => setTimeout(resolve, 0));
console.log("made while the collector runs inside the parents:", total);
