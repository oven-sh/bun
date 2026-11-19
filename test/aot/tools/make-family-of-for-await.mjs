// Writes the family: `for await` over every kind of iterable, left in every way, each program printing the order of its marks.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const folder = process.argv[2];
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });
let count = 0;
function write(name, text) { writeFileSync(`${folder}/${name}.mjs`, text); count++; }
const head = `const marks = []; function mark(text) { marks.push(String(text)); }
function later(value) { return new Promise(resolve => setTimeout(resolve, 1, value)); }
`;
const tail = `await ended; await later(0); await later(0); console.log(marks.join("\\n"));
`;
const iterables = {
  "an-async-generator": [`async function* make() { try { mark("starts"); yield 1; mark("goes on"); yield 2; yield 3; mark("ends"); } finally { mark("cleans up"); } }`, `make()`],
  "an-async-generator-that-waits": [`async function* make() { try { yield await later(1); mark("goes on"); yield later(2); yield 3; } finally { await later(0); mark("cleans up late"); } }`, `make()`],
  "an-async-generator-that-throws": [`async function* make() { try { yield 1; throw new Error("from the generator"); } finally { mark("cleans up"); } }`, `make()`],
  "an-async-generator-that-yields-in-its-finally": [`async function* make() { try { yield 1; yield 2; } finally { mark("last words"); yield 99; mark("behind last words"); } }`, `make()`],
  "an-async-generator-that-returns-a-value": [`async function* make() { yield 1; return "result"; }`, `make()`],
  "a-generator": [`function* make() { try { yield 1; yield Promise.resolve(2); yield later(3); } finally { mark("cleans up"); } }`, `make()`],
  "a-generator-that-yields-a-rejection": [`function* make() { try { yield 1; yield Promise.reject(new Error("rejected")); yield 3; } finally { mark("cleans up"); } }`, `make()`],
  "a-list": [``, `[1, Promise.resolve(2), later(3)]`],
  "a-list-with-a-rejection": [``, `[1, Promise.reject(new Error("rejected")), 3]`],
  "an-empty-list": [``, `[]`],
  "a-set": [``, `new Set([1, 2, 3])`],
  "a-text": [``, `"abc"`],
  "an-iterator-of-its-own": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { mark("opened"); return this; }, next(sent) { mark("next " + String(sent) + " " + arguments.length); return Promise.resolve(i < 3 ? { done: false, value: ++i } : { done: true, value: "end" }); }, return(value) { mark("return " + String(value) + " " + arguments.length); return Promise.resolve({ done: true }); } }; }`, `make()`],
  "an-iterator-whose-next-answers-without-a-promise": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, next() { return i < 3 ? { done: false, value: Promise.resolve(++i) } : { done: true }; }, return() { mark("return"); return {}; } }; }`, `make()`],
  "an-iterator-without-return": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return i < 3 ? { done: false, value: ++i } : { done: true }; } }; }`, `make()`],
  "an-iterator-whose-return-is-null": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return { done: i >= 4, value: ++i }; }, return: null }; }`, `make()`],
  "an-iterator-whose-return-is-no-function": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return { done: i >= 4, value: ++i }; }, return: 5 }; }`, `make()`],
  "an-iterator-whose-return-throws": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return { done: i >= 3, value: ++i }; }, return() { mark("return throws"); throw new Error("from return"); } }; }`, `make()`],
  "an-iterator-whose-return-rejects": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return { done: i >= 3, value: ++i }; }, async return() { mark("return rejects"); throw new Error("rejected by return"); } }; }`, `make()`],
  "an-iterator-whose-return-gives-no-object": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return { done: i >= 3, value: ++i }; }, async return() { mark("return gives 7"); return 7; } }; }`, `make()`],
  "an-iterator-whose-next-throws": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, next() { if (++i === 2) throw new Error("from next"); return Promise.resolve({ done: i > 4, value: i }); }, return() { mark("return"); return {}; } }; }`, `make()`],
  "an-iterator-whose-next-rejects": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { if (++i === 2) throw new Error("rejected by next"); return { done: i > 4, value: i }; }, return() { mark("return"); return {}; } }; }`, `make()`],
  "an-iterator-whose-next-gives-no-object": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { return ++i === 2 ? 7 : { done: i > 4, value: i }; }, return() { mark("return"); return {}; } }; }`, `make()`],
  "an-iterator-whose-done-is-a-getter": [`function make() { let i = 0; return { [Symbol.asyncIterator]() { return this; }, async next() { const n = ++i; return { get done() { mark("done read " + n); return n > 3; }, get value() { mark("value read " + n); return n; } }; }, return() { mark("return"); return {}; } }; }`, `make()`],
  "an-iterator-whose-next-is-replaced-in-the-loop": [`const shared = { i: 0, [Symbol.asyncIterator]() { return this; }, async next() { return { done: this.i >= 3, value: ++this.i }; }, return() { mark("return"); return {}; } };
function make() { shared.i = 0; return shared; }
function meddle() { shared.next = async function () { mark("the other next"); return { done: true }; }; }`, `make()`],
  "a-generator-whose-next-is-laid-on-it": [`async function* inner() { yield 1; yield 2; yield 3; }
function make() { const made = inner(); let calls = 0; made.next = function () { mark("own next " + ++calls); return Object.getPrototypeOf(made).next.call(made); }; return made; }`, `make()`],
  "a-proxy-over-a-generator": [`async function* inner() { yield 1; yield 2; }
function make() { const made = inner(); return new Proxy(made, { get(target, key) { mark("get " + String(key)); const found = target[key]; return typeof found === "function" ? found.bind(target) : found; } }); }`, `make()`],
  "nothing": [`const nothing = [undefined][0];`, `nothing`],
  "what-is-not-iterable": [``, `{ plain: true }`],
  "a-method-that-gives-no-object": [``, `{ [Symbol.asyncIterator]() { mark("opened"); return 5; } }`],
  "an-async-method-that-is-null-beside-a-sync-one": [``, `{ [Symbol.asyncIterator]: null, *[Symbol.iterator]() { yield 1; yield 2; } }`],
};
const bodies = {
  "runs-to-the-end": `mark("got " + String(value));`,
  "breaks": `mark("got " + String(value)); if (++turns === 2) break;`,
  "breaks-at-once": `mark("got " + String(value)); break;`,
  "returns": `mark("got " + String(value)); if (++turns === 2) return "returned";`,
  "throws": `mark("got " + String(value)); if (++turns === 2) throw new Error("from the body");`,
  "goes-on-early": `if (++turns === 1) continue; mark("got " + String(value));`,
  "awaits": `mark("got " + String(value)); await null; mark("behind an await"); await later(0); mark("behind a timer");`,
  "awaits-then-breaks": `mark("got " + String(value)); await later(0); if (++turns === 2) break;`,
  "leaves-an-outer-loop": `mark("got " + String(value)); if (++turns === 2) break outer;`,
  "goes-on-with-an-outer-loop": `mark("got " + String(value)); if (++turns === 2) continue outer;`,
  "meddles": `mark("got " + String(value)); if (typeof meddle === "function") meddle();`,
  "catches-its-own": `try { mark("got " + String(value)); if (++turns === 2) throw new Error("inside"); } catch (error) { mark("caught inside " + error.message); }`,
};
const kinds = {
  "an-async-function": [`async function consume() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of ITERABLE) { BODY } mark("behind the loop"); } return "ended"; }`, `consume()`],
  "an-async-generator": [`async function* walk() { let turns = 0; outer: for (let round = 0; round < 2; round++) { mark("round " + round); for await (const value of ITERABLE) { BODY } mark("behind the loop"); yield round; } return "ended"; }
async function consume() { let last; for (;;) { const step = await walk.made.next(); if (step.done) return step.value; last = step.value; } }
walk.made = walk();`, `consume()`],
};
const entries = { "called-by-ordinary-code": ``, "behind-a-job": `await null;`, "behind-a-timer": `await later(0);` };
for (const [iterable, [text, made]] of Object.entries(iterables))
  for (const [body, does] of Object.entries(bodies))
    for (const [kind, [shape, call]] of Object.entries(kinds))
      for (const [entry, first] of Object.entries(entries)) {
        if (entry !== "behind-a-job" && !["runs-to-the-end", "breaks", "throws"].includes(body)) continue;
        write(`${iterable}--${body}--${kind}--${entry}`, `${head}${text}
${shape.replace("ITERABLE", made).replace("BODY", does)}
Promise.resolve().then(() => mark("a job beside")).then(() => mark("a second job beside"));
${first}
const ended = ${call}.then(value => mark("gave " + String(value)), error => mark("failed " + (error && error.message)));
mark("behind the call");
${tail}`);
      }
console.log(count + " programs");
