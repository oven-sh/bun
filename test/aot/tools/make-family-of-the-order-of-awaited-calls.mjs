// make-order-family.mjs <folder>: one program for each way into the caller, form of the call, body of the callee, awaited value and bystander.
// Each program pushes marks into a list as things happen and prints the list when all is over: the order of the marks is what is compared.
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const values = {
  "a-plain-value": `function awaited(tag) { return tag; }`,
  "one-settled-promise": `const settled = Promise.resolve("s"); function awaited(tag) { return settled; }`,
  "a-fresh-settled-promise": `function awaited(tag) { return Promise.resolve(tag); }`,
  "pending-until-a-job": `function awaited(tag) { return new Promise(resolve => queueMicrotask(() => { mark("resolves " + tag); resolve(tag); })); }`,
  "pending-until-a-timer": `function awaited(tag) { return new Promise(resolve => setTimeout(() => { mark("timer resolves " + tag); resolve(tag); }, 1)); }`,
  "a-rejected-promise": `function awaited(tag) { return Promise.reject(new Error("no " + tag)); }`,
  "a-thenable": `function awaited(tag) { return { then(resolve) { mark("then called " + tag); resolve(tag); } }; }`,
  "a-getter-then": `function awaited(tag) { return Object.defineProperty({ toString() { return tag; } }, "then", { get() { mark("then read " + tag); return undefined; } }); }`,
  "of-a-subclass": `class Mine extends Promise {} function awaited(tag) { return Mine.resolve(tag); }`,
  "another-constructor-laid-on-it": `function awaited(tag) { const made = Promise.resolve(tag); made.constructor = function Other() {}; return made; }`,
  "a-then-of-its-own": `function awaited(tag) { const made = Promise.resolve(tag); made.then = function (onDone, onFailed) { mark("own then " + tag); return Promise.prototype.then.call(this, onDone, onFailed); }; return made; }`,
  "a-species-laid-on-it": `function awaited(tag) { const made = Promise.resolve(tag); made.constructor = { [Symbol.species]: class extends Promise { constructor(run) { mark("species " + tag); super(run); } } }; return made; }`,
};

const callees = {
  "awaits": `mark(tag + " in"); const got = await awaited(tag); mark(tag + " on " + String(got)); return got;`,
  "queues-a-job-in-front": `mark(tag + " in"); Promise.resolve().then(() => mark(tag + " job")); const got = await awaited(tag); mark(tag + " on " + String(got)); return got;`,
  "queues-a-job-behind": `mark(tag + " in"); const got = await awaited(tag); Promise.resolve().then(() => mark(tag + " job")); mark(tag + " on " + String(got)); return got;`,
  "queues-a-microtask-in-front": `mark(tag + " in"); queueMicrotask(() => mark(tag + " microtask")); const got = await awaited(tag); mark(tag + " on " + String(got)); return got;`,
  "queues-a-microtask-behind": `mark(tag + " in"); const got = await awaited(tag); queueMicrotask(() => mark(tag + " microtask")); mark(tag + " on " + String(got)); return got;`,
  "asks-for-a-tick-in-front": `mark(tag + " in"); process.nextTick(() => mark(tag + " tick")); const got = await awaited(tag); mark(tag + " on " + String(got)); return got;`,
  "asks-for-an-immediate-and-a-timer": `mark(tag + " in"); setImmediate(() => mark(tag + " immediate")); setTimeout(() => mark(tag + " timer"), 0); const got = await awaited(tag); mark(tag + " on " + String(got)); return got;`,
  "throws-in-front": `mark(tag + " in"); if (tag.length) throw new Error(tag + " early"); return await awaited(tag);`,
  "throws-behind": `mark(tag + " in"); const got = await awaited(tag); mark(tag + " on " + String(got)); throw new Error(tag + " late");`,
  "awaits-twice": `mark(tag + " in"); const first = await awaited(tag); mark(tag + " between " + String(first)); const second = await awaited(tag + "2"); mark(tag + " on " + String(second)); return second;`,
  "never-awaits": `mark(tag + " in"); return tag;`,
  "never-awaits-and-throws": `mark(tag + " in"); throw new Error(tag + " failed");`,
  "never-awaits-and-throws-on-some-calls": `mark(tag + " in"); if (tag.endsWith("1") || tag === "b") throw new Error(tag + " failed"); return tag;`,
  "never-awaits-and-a-function-it-calls-throws": `mark(tag + " in"); const got = refuse(tag); mark(tag + " never"); return got;`,
  "never-awaits-and-catches-inside": `mark(tag + " in"); try { refuse(tag); } catch (error) { mark(tag + " caught inside " + error.message); } return tag;`,
  "never-awaits-and-rethrows-out-of-a-finally": `mark(tag + " in"); try { refuse(tag); } finally { mark(tag + " finally inside"); }`,
  "never-awaits-and-returns-out-of-a-finally": `mark(tag + " in"); try { return tag; } finally { mark(tag + " finally inside"); }`,
  "never-awaits-and-returns-a-settled-promise": `mark(tag + " in"); return Promise.resolve(tag + " promised");`,
  "never-awaits-and-returns-a-rejected-promise": `mark(tag + " in"); return Promise.reject(new Error(tag + " refused"));`,
  "never-awaits-and-returns-a-thenable": `mark(tag + " in"); return { then(resolve) { mark(tag + " then called"); resolve(tag + " from then"); } };`,
  "never-awaits-and-queues-a-job": `mark(tag + " in"); Promise.resolve().then(() => mark(tag + " job")); return tag;`,
  "never-awaits-and-loops": `let sum = 0; for (let i = 0; i < tag.length + 3; i++) sum += i; mark(tag + " summed " + sum); return sum;`,
  "never-awaits-and-reads-a-member-of-nothing": `mark(tag + " in"); let nothing = null; if (tag.length > 100) nothing = { name: tag }; return nothing.name;`,
  "never-awaits-and-runs-out-of-stack": `mark(tag + " in"); return deeper(tag);`,
  "awaits-under-a-finally": `mark(tag + " in"); try { return await awaited(tag); } finally { mark(tag + " finally"); }`,
};

const forms = {
  "awaited-at-once": [``, `mark("before"); const got = await callee("a"); mark("after " + String(got));`],
  "awaited-later": [``, `const made = callee("a"); mark("behind the call"); const got = await made; mark("after " + String(got));`],
  "two-started-then-awaited": [``, `const first = callee("a"), second = callee("b"); mark("behind the calls"); mark("after " + String(await first) + String(await second));`],
  "under-promise-all": [``, `const got = await Promise.all([callee("a"), callee("b")]); mark("after " + got.map(String).join());`],
  "under-try-catch-finally": [``, `try { mark("after " + String(await callee("a"))); } catch (error) { mark("caught " + error.message); } finally { mark("finally"); } mark("behind the try");`],
  "in-a-loop": [``, `for (let i = 0; i < 3; i++) mark("after " + String(await callee("a" + i)));`],
  "in-a-loop-under-a-catch-that-reads-nothing": [``, `for (let i = 0; i < 3; i++) { try { mark("after " + String(await callee("a" + i))); } catch { mark("caught " + i); } }`],
  "in-a-loop-under-a-finally": [``, `for (let i = 0; i < 3; i++) { try { mark("after " + String(await callee("a" + i))); } finally { mark("finally " + i); } }`],
  "started-in-a-loop-and-awaited-later": [``, `const made = []; for (let i = 0; i < 3; i++) { made.push(callee("a" + i)); mark("behind the call " + i); } for (const one of made) { try { mark("after " + String(await one)); } catch (error) { mark("caught " + error.message); } }`],
  "in-a-loop-the-promise-is-looked-at": [``, `for (let i = 0; i < 3; i++) { const made = callee("a" + i); mark(String(made instanceof Promise) + " " + typeof made); try { mark("after " + String(await made)); } catch (error) { mark("caught " + error.message); } }`],
  "three-deep": [`async function middle(tag) { mark(tag + " middle in"); const got = await callee(tag); mark(tag + " middle on"); return got; }
async function upper(tag) { mark(tag + " upper in"); const got = await middle(tag); mark(tag + " upper on"); return got; }`, `mark("before"); const got = await upper("a"); mark("after " + String(got));`],
  "handed-on-by-return": [`async function withAwait(tag) { return await callee(tag); }
async function withoutAwait(tag) { return callee(tag); }`, `mark("after " + String(await withAwait("a"))); mark("after " + String(await withoutAwait("b")));`],
  "twice-in-a-row": [``, `mark("after " + String(await callee("a"))); mark("between"); mark("after " + String(await callee("b")));`],
  "a-caught-failure-then-a-call-awaited-later": [``, `try { mark("after " + String(await callee("a"))); } catch (error) { mark("caught " + error.message); } const made = callee("b"); mark("behind the call"); try { mark("after " + String(await made)); } catch (error) { mark("caught " + error.message); }`],
  "a-caught-failure-then-another-function-awaited-later": [`async function helper(tag) { mark(tag + " helper in"); await null; mark(tag + " helper on"); await tag; mark(tag + " helper out"); return tag; }`, `try { mark("after " + String(await callee("a"))); } catch (error) { mark("caught " + error.message); } const made = helper("h"); mark("behind the helper"); mark("after " + String(await made));`],
  "awaited-at-once-then-another-function-awaited-later": [`async function helper(tag) { mark(tag + " helper in"); await null; mark(tag + " helper on"); return tag; }`, `mark("after " + String(await callee("a"))); const made = helper("h"); mark("behind the helper"); mark("after " + String(await made));`],
  "through-a-function-that-starts-a-helper": [`async function helper(tag) { mark(tag + " helper in"); await null; mark(tag + " helper on"); return tag; }
async function starter(tag) { mark(tag + " starter in"); await null; const made = helper(tag); mark(tag + " behind the helper"); const got = await callee(tag); mark(tag + " starter on"); return String(got) + String(await made); }`, `mark("after " + String(await starter("a")));`],
  "with-more-arguments-than-registers": [`async function wide(a, b, c, d, e, f, g, h, i, j, k, l) { mark("wide in " + l); const got = await callee(a); mark("wide on " + [b, c, d, e, f, g, h, i, j, k, l].join("")); return got; }`, `mark("after " + String(await wide("a", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)));`],
  "a-failure-caught-two-frames-up": [`async function middle(tag) { mark(tag + " middle in"); const got = await callee(tag); mark(tag + " middle on"); return got; }
async function helper(tag) { mark(tag + " helper in"); await null; mark(tag + " helper on"); return tag; }`, `try { mark("after " + String(await middle("a"))); } catch (error) { mark("caught " + error.message); } const made = helper("h"), other = middle("m"); mark("behind the calls"); mark("after " + String(await made)); try { mark("after " + String(await other)); } catch (error) { mark("caught " + error.message); }`],
};

const ended = `.then(() => mark("outer done"), error => mark("outer failed " + error.message))`;
const entries = {
  "resumed-by-the-job-loop": [`await null;`, `outer()${ended}; mark("main behind outer");`],
  "called-by-ordinary-code": [``, `outer()${ended}; mark("main behind outer");`],
  "called-by-a-reaction": [``, `Promise.resolve().then(() => { outer()${ended}; mark("reaction behind outer"); });`],
  "called-by-a-timer": [``, `setTimeout(() => { outer()${ended}; mark("timer behind outer"); }, 0);`],
  "resumed-behind-a-timer": [`await new Promise(resolve => setTimeout(resolve, 1));`, `outer()${ended}; mark("main behind outer");`],
  "called-by-a-tick": [``, `process.nextTick(() => { outer()${ended}; mark("tick behind outer"); });`],
};

const bystanders = {
  "alone": ``,
  "beside-another-chain": `async function other() { for (let turn = 0; turn < 8; turn++) { mark("other " + turn); await null; } }
other();`,
};

const head = `const marks = [];
function mark(text) { marks.push(text); }
function refuse(tag) { mark(tag + " refuses"); throw new Error(tag + " refused"); }
function deeper(tag) { return deeper(tag + "") + 1; }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
`;
const tail = `setTimeout(() => console.log(marks.join("\\n")), 40);
`;

let count = 0;
function write(name, text) {
  writeFileSync(`${out}/${name}.mjs`, text);
  count++;
}
const fewValues = ["a-plain-value", "one-settled-promise", "pending-until-a-job"];
for (const [form, [helpers, use]] of Object.entries(forms)) {
  for (const [entry, [first, start]] of Object.entries(entries)) {
    for (const [bystander, beside] of Object.entries(bystanders)) {
      for (const [callee, body] of Object.entries(callees)) {
        for (const value of callee === "awaits" ? Object.keys(values) : callee.startsWith("never-awaits-") ? ["a-plain-value"] : fewValues) {
          write(`${form}--${callee}--${value}--${entry}--${bystander}`, `${head}${values[value]}
async function callee(tag) { ${body} }
${helpers}
async function outer() { ${first} ${use} }
${beside}
${start}
${tail}`);
        }
      }
    }
  }
}

const others = {
  "a-context-of-async-local-storage-across-the-await": `import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
async function callee(tag) { mark(tag + " in " + storage.getStore()); await tag; mark(tag + " on " + storage.getStore()); return storage.run("inner", async () => { await tag; mark(tag + " inner " + storage.getStore()); return tag; }); }
async function outer() { await null; mark("before " + storage.getStore()); const got = await storage.run("outer", () => callee("a")); mark("after " + got + " " + storage.getStore()); const again = await callee("b"); mark("after " + again + " " + storage.getStore()); }
storage.run("main", () => outer().then(() => mark("done " + storage.getStore())));`,
  "the-moment-of-an-unhandled-rejection": `async function callee(tag) { await tag; Promise.reject(new Error("dropped " + tag)); mark(tag + " on"); return tag; }
async function outer() { await null; mark("after " + await callee("a")); await null; mark("one turn on"); await new Promise(resolve => setTimeout(resolve, 2)); mark("behind a timer"); }
outer();`,
  "a-rejection-that-is-caught-a-turn-later": `async function callee(tag) { await tag; throw new Error("late " + tag); }
async function outer() { await null; const made = callee("a"); await null; mark("a turn on"); try { await made; } catch (error) { mark("caught " + error.message); } try { await callee("b"); } catch (error) { mark("caught " + error.message); } }
outer();`,
  "recursion-far-deeper-than-the-stack": `async function down(left) { await null; if (!left) return 0; return 1 + await down(left - 1); }
async function outer() { await null; mark("depth " + await down(60000)); }
outer().catch(error => mark("failed " + error.constructor.name));`,
  "recursion-that-needs-much-stack-at-its-bottom": `function deep(left) { return left ? 1 + deep(left - 1) : 0; }
async function down(left) { await null; if (!left) return deep(6000); return await down(left - 1); }
async function outer() { await null; mark("reached " + await down(300)); }
outer().catch(error => mark("failed " + error.constructor.name));`,
  "a-collection-in-the-middle": `async function callee(tag) { const kept = { tag, list: [1, 2, 3] }; await tag; Bun.gc(true); mark(kept.tag + " on " + kept.list.length); await tag; Bun.gc(true); return kept; }
async function outer() { await null; const held = ["x", "y"]; const got = await callee("a"); Bun.gc(true); mark("after " + got.tag + held.join()); }
outer();`,
  "an-async-generator-under-for-await": `async function callee(tag) { mark(tag + " in"); await tag; mark(tag + " on"); return tag; }
async function* pieces() { for (let i = 0; i < 3; i++) { mark("makes " + i); yield await callee("p" + i); mark("made " + i); } }
async function outer() { await null; for await (const piece of pieces()) { mark("got " + piece); mark("after " + await callee("c" + piece)); } }
async function other() { for (let turn = 0; turn < 6; turn++) { mark("other " + turn); await null; } }
outer(); other();`,
  "a-worker-with-a-loop-of-its-own": `import { Worker, isMainThread, parentPort } from "node:worker_threads";
if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  worker.on("message", text => { mark("worker said " + text); worker.terminate(); });
} else {
  const seen = [];
  async function callee(tag) { seen.push(tag + " in"); Promise.resolve().then(() => seen.push(tag + " job")); await tag; seen.push(tag + " on"); return tag; }
  async function outer() { await null; seen.push("after " + await callee("a")); seen.push("after " + await callee("b")); parentPort.postMessage(seen.join()); }
  outer();
}`,
  "a-caller-that-is-a-method-with-this-and-arguments": `class Shelf { constructor() { this.name = "shelf"; } async read(tag) { mark(this.name + " in " + arguments.length); await tag; mark(this.name + " on"); return this.name + tag; } async all() { await null; mark("after " + await this.read("a", 1)); mark("after " + await this.read("b")); } }
new Shelf().all();`,
  "many-values-alive-across-the-call": `async function callee(tag) { await tag; return tag.length; }
async function outer(a, b, c, d, e, f, g, h) { await null; let sum = 0; for (let i = 0; i < 4; i++) { sum += await callee("x".repeat(i)) + a + b + c + d + e + f + g + h; Promise.resolve().then(() => mark("job " + i)); } mark("sum " + sum); }
outer(1, 2, 3, 4, 5, 6, 7, 8);`,
  "the-callee-drains-nothing-but-starts-another-caller": `async function callee(tag) { mark(tag + " in"); await tag; mark(tag + " on"); return tag; }
async function second() { mark("second in"); mark("second after " + await callee("s")); }
async function first(tag) { mark(tag + " first in"); await tag; second(); mark(tag + " first behind second"); await tag; mark(tag + " first on"); return tag; }
async function outer() { await null; mark("after " + await first("a")); }
outer();`,
  "the-callee-drains-the-queue-itself": `import { drainMicrotasks } from "bun:jsc";
async function side(tag) { mark(tag + " side in"); await null; mark(tag + " side on"); await null; mark(tag + " side out"); }
async function callee(tag) { mark(tag + " in"); await tag; mark(tag + " on"); side(tag); mark(tag + " behind side"); drainMicrotasks(); mark(tag + " drained"); await tag; mark(tag + " out"); return tag; }
async function outer() { await null; mark("after " + await callee("a")); const made = side("o"); mark("behind side"); await made; mark("end"); }
outer();`,
  "a-timer-that-is-due-while-the-chain-runs": `async function callee(tag) { mark(tag + " in"); await tag; const until = performance.now() + 3; while (performance.now() < until); mark(tag + " on"); await tag; return tag; }
async function outer() { await null; setTimeout(() => mark("timer"), 0); setImmediate(() => mark("immediate")); process.nextTick(() => mark("tick")); mark("after " + await callee("a")); mark("after " + await callee("b")); }
outer();`,
  "a-getter-and-a-proxy-run-code-between": `const box = new Proxy({}, { get(target, name) { mark("proxy " + String(name)); return undefined; } });
async function callee(tag) { mark(tag + " in"); const got = await box; mark(tag + " on " + typeof got); return tag; }
async function outer() { await null; mark("after " + await callee("a")); }
outer();`,
};
const contextMoves = {
  "no-move": ["", ""],
  "entered-in-front": [`storage.enterWith(tag + " front");`, ""],
  "entered-behind": ["", `storage.enterWith(tag + " behind");`],
  "entered-in-front-and-behind": [`storage.enterWith(tag + " front");`, `storage.enterWith(tag + " behind");`],
  "disabled-behind": ["", `storage.disable();`],
  "run-round-the-rest": ["", `await storage.run(tag + " scoped", async () => { mark(tag + " scoped sees " + storage.getStore()); await tag; mark(tag + " scoped on sees " + storage.getStore()); });`],
};
const contextEnds = {
  "returns": `return tag;`,
  "throws": `throw new Error(tag + " failed");`,
  "waits-for-a-timer-then-returns": `await new Promise(resolve => setTimeout(resolve, 1)); mark(tag + " behind the timer sees " + storage.getStore()); return tag;`,
  "awaits-again-then-returns": `await tag; mark(tag + " second sees " + storage.getStore()); return tag;`,
};
const contextDepths = {
  "one-deep": [``, `callee("a")`],
  "two-deep": [`async function middle(tag) { mark(tag + " middle in sees " + storage.getStore()); try { return await callee(tag); } finally { mark(tag + " middle on sees " + storage.getStore()); } }`, `middle("a")`],
  "three-deep-with-a-move-in-the-middle": [`async function middle(tag) { mark(tag + " middle in sees " + storage.getStore()); const got = await callee(tag); mark(tag + " middle on sees " + storage.getStore()); storage.enterWith(tag + " middle"); return got; }
async function upper(tag) { mark(tag + " upper in sees " + storage.getStore()); let got; try { got = await middle(tag); } catch (error) { got = "caught " + error.message; } mark(tag + " upper on sees " + storage.getStore()); return got; }`, `upper("a")`],
};
const contextEntries = {
  "resumed-by-the-job-loop": `await null;`,
  "called-by-ordinary-code": ``,
  "resumed-behind-a-timer": `await new Promise(resolve => setTimeout(resolve, 1));`,
};
for (const [move, [front, behind]] of Object.entries(contextMoves))
  for (const [end, last] of Object.entries(contextEnds))
    for (const [depth, [helpers, call]] of Object.entries(contextDepths))
      for (const [entry, first] of Object.entries(contextEntries))
        write(`context--${move}--${end}--${depth}--${entry}`, `import { AsyncLocalStorage } from "node:async_hooks";
${head}const storage = new AsyncLocalStorage();
async function callee(tag) { mark(tag + " in sees " + storage.getStore()); ${front} await tag; mark(tag + " on sees " + storage.getStore()); ${behind} mark(tag + " moved sees " + storage.getStore()); ${last} }
${helpers}
async function outer() { ${first} mark("before sees " + storage.getStore()); try { mark("after " + await ${call} + " sees " + storage.getStore()); } catch (error) { mark("caught " + error.message + " sees " + storage.getStore()); } await null; mark("a turn on sees " + storage.getStore()); mark("again " + await callee("b") + " sees " + storage.getStore()); }
storage.run("main", () => { outer().then(() => mark("done sees " + storage.getStore()), error => mark("failed " + error.message)); mark("main behind outer sees " + storage.getStore()); });
${tail}`);

for (const [name, text] of Object.entries(others))
  write(name, head + text + "\n" + tail);
console.log(count + " programs");
