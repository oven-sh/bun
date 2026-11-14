// make-steps-family.mjs <folder>: one program for each body of an async generator, way of stepping it by hand, way into the consumer and bystander.
// Each program pushes marks into a list as things happen and prints the list when all is over: the order of the marks is what is compared.
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const producers = {
  "yields-values": `async function* pieces(tag) { mark(tag + " starts"); for (let i = 0; i < 3; i++) { const sent = yield tag + i; mark(tag + " was sent " + String(sent)); } mark(tag + " ends"); return tag + " result"; }`,
  "awaits-a-value-before-each-yield": `async function* pieces(tag) { for (let i = 0; i < 3; i++) { await null; mark(tag + " awaited " + i); const sent = yield tag + i; mark(tag + " was sent " + String(sent)); } }`,
  "awaits-what-arrives-later": `async function* pieces(tag) { for (let i = 0; i < 3; i++) { const got = await new Promise(resolve => queueMicrotask(() => { mark(tag + " resolves " + i); resolve(i); })); yield tag + got; } return tag + " result"; }`,
  "awaits-a-timer": `async function* pieces(tag) { for (let i = 0; i < 2; i++) { await new Promise(resolve => setTimeout(resolve, 1)); mark(tag + " behind the timer " + i); yield tag + i; } }`,
  "yields-promises": `async function* pieces(tag) { yield Promise.resolve(tag + " settled"); mark(tag + " between"); yield new Promise(resolve => queueMicrotask(() => resolve(tag + " later"))); mark(tag + " ends"); }`,
  "yields-a-rejected-promise": `async function* pieces(tag) { yield tag + 0; try { yield Promise.reject(new Error(tag + " refused")); } finally { mark(tag + " finally"); } yield tag + " never"; }`,
  "throws-behind-a-yield": `async function* pieces(tag) { yield tag + 0; mark(tag + " throws"); throw new Error(tag + " failed"); }`,
  "throws-at-once": `async function* pieces(tag) { mark(tag + " throws"); throw new Error(tag + " failed"); yield tag; }`,
  "returns-at-once": `async function* pieces(tag) { mark(tag + " returns"); return tag + " result"; }`,
  "returns-a-promise": `async function* pieces(tag) { yield tag + 0; return Promise.resolve(tag + " promised"); }`,
  "delegates-to-an-async-generator": `async function* inner(tag) { const sent = yield tag + " inner 0"; mark(tag + " inner was sent " + String(sent)); yield tag + " inner 1"; return tag + " inner result"; }
async function* pieces(tag) { const got = yield* inner(tag); mark(tag + " got " + got); yield tag + " own"; }`,
  "delegates-to-a-list": `async function* pieces(tag) { yield* [tag + 0, Promise.resolve(tag + 1)]; mark(tag + " ends"); }`,
  "queues-jobs-round-its-yields": `async function* pieces(tag) { for (let i = 0; i < 2; i++) { Promise.resolve().then(() => mark(tag + " job in front " + i)); yield tag + i; Promise.resolve().then(() => mark(tag + " job behind " + i)); } }`,
  "has-a-finally": `async function* pieces(tag) { try { yield tag + 0; yield tag + 1; } finally { mark(tag + " finally"); await null; mark(tag + " finally on"); } }`,
  "steps-another-generator-by-hand": `async function* inner(tag) { yield tag + " inner 0"; yield tag + " inner 1"; }
async function* pieces(tag) { const steps = inner(tag); for (;;) { const step = await steps.next(); if (step.done) break; mark(tag + " hands on"); yield step.value; } }`,
};

const show = `function show(step) { return String(step.value) + (step.done ? " done" : ""); }`;
const consumers = {
  "reads-done-and-value": `const steps = pieces("a"); for (;;) { const step = await steps.next(); if (step.done) { mark("done " + String(step.value)); break; } mark("got " + String(step.value)); }`,
  "takes-the-result-apart": `const steps = pieces("a"); for (;;) { const { value, done } = await steps.next(); mark("got " + String(value) + " " + done); if (done) break; }`,
  "sends-values": `const steps = pieces("a"); let turn = 0; for (;;) { const step = await steps.next("s" + turn++); mark("got " + show(step)); if (step.done) break; }`,
  "keeps-the-results": `const steps = pieces("a"), kept = []; for (;;) { const step = await steps.next(); kept.push(step); if (step.done) break; } mark(kept.map(show).join()); mark(String(kept[0] === kept[kept.length - 1]) + " " + Object.keys(kept[0]).join() + " " + (Object.getPrototypeOf(kept[0]) === Object.prototype));`,
  "asks-three-times-then-awaits": `const steps = pieces("a"); const first = steps.next(), second = steps.next(); mark("asked twice"); const third = await steps.next(); mark("third " + show(third)); mark("first " + show(await first)); mark("second " + show(await second)); mark("fourth " + show(await steps.next()));`,
  "awaits-later": `const steps = pieces("a"); for (;;) { const asked = steps.next(); mark("behind the call"); const step = await asked; mark("got " + show(step)); if (step.done) break; }`,
  "goes-on-past-the-end": `const steps = pieces("a"); for (let i = 0; i < 6; i++) { let step; try { step = await steps.next(); } catch (error) { mark("caught " + error.message); continue; } mark("got " + show(step)); }`,
  "under-try-and-finally": `const steps = pieces("a"); try { for (;;) { const step = await steps.next(); if (step.done) break; mark("got " + String(step.value)); } } catch (error) { mark("caught " + error.message); } finally { mark("finally"); } mark("after " + show(await steps.next()));`,
  "closes-it-early": `const steps = pieces("a"); mark("got " + show(await steps.next())); mark("closed " + show(await steps.return("early"))); mark("after " + show(await steps.next()));`,
  "throws-into-it": `const steps = pieces("a"); mark("got " + show(await steps.next())); try { mark("thrown " + show(await steps.throw(new Error("thrown in")))); } catch (error) { mark("caught " + error.message); } mark("after " + show(await steps.next()));`,
  "mixes-with-for-await": `const steps = pieces("a"); mark("got " + show(await steps.next())); for await (const piece of steps) { mark("loop got " + String(piece)); } mark("after " + show(await steps.next()));`,
  "two-generators-in-turn": `const left = pieces("l"), right = pieces("r"); for (;;) { const a = await left.next(), b = await right.next(); mark("got " + show(a) + " | " + show(b)); if (a.done && b.done) break; }`,
  "outside-a-loop": `const steps = pieces("a"); const step = await steps.next(); mark("got " + String(step.value) + " " + step.done);`,
};

const kinds = {
  "an-async-function": [`async function outer() { FIRST BODY }`, `outer()`],
  "an-async-generator": [`async function* wrapped() { FIRST BODY yield "end"; }
async function outer() { for await (const piece of wrapped()) mark("wrapped gave " + piece); }`, `outer()`],
};

const ended = `.then(() => mark("outer done"), error => mark("outer failed " + error.message))`;
const entries = {
  "resumed-by-the-job-loop": [`await null;`, call => `${call}${ended}; mark("main behind outer");`],
  "called-by-ordinary-code": [``, call => `${call}${ended}; mark("main behind outer");`],
  "resumed-behind-a-timer": [`await new Promise(resolve => setTimeout(resolve, 1));`, call => `${call}${ended}; mark("main behind outer");`],
};

const bystanders = {
  "alone": ``,
  "beside-another-chain": `async function other() { for (let turn = 0; turn < 10; turn++) { mark("other " + turn); await null; } }
other();`,
};

const head = `const marks = [];
function mark(text) { marks.push(text); }
process.on("unhandledRejection", error => mark("unhandled " + (error && error.message)));
${show}
`;
const tail = `setTimeout(() => console.log(marks.join("\\n")), 60);
`;

let count = 0;
function write(name, text) {
  writeFileSync(`${out}/${name}.mjs`, text);
  count++;
}
for (const [producer, made] of Object.entries(producers))
  for (const [consumer, body] of Object.entries(consumers))
    for (const [kind, [shape, call]] of Object.entries(kinds))
      for (const [entry, [first, start]] of Object.entries(entries))
        for (const [bystander, beside] of Object.entries(bystanders))
          write(`${producer}--${consumer}--${kind}--${entry}--${bystander}`, `${head}${made}
${shape.replace("FIRST", first).replace("BODY", body)}
${beside}
${start(call)}
${tail}`);

const plain = producers["yields-values"];
const others = {
  "next-laid-on-the-generator-itself": `${plain}
async function outer() { await null; const steps = pieces("a"); mark("got " + show(await steps.next())); steps.next = function (sent) { mark("own next"); return Promise.resolve({ value: "mine", done: false }); }; mark("got " + show(await steps.next())); delete steps.next; mark("got " + show(await steps.next())); }
outer();`,
  "next-laid-on-the-prototype-of-the-function": `${plain}
async function outer() { await null; const steps = pieces("a"); mark("got " + show(await steps.next())); pieces.prototype.next = function (sent) { mark("next of the prototype"); return { value: "no promise", done: true }; }; mark("got " + show(await steps.next())); delete pieces.prototype.next; mark("got " + show(await steps.next())); }
outer();`,
  "another-prototype-laid-on-the-generator": `${plain}
async function outer() { await null; const steps = pieces("a"); mark("got " + show(await steps.next())); Object.setPrototypeOf(steps, { next() { mark("foreign next"); return { value: "foreign", done: false }; } }); mark("got " + show(await steps.next())); }
outer();`,
  "next-borrowed-for-another-receiver": `${plain}
async function outer() { await null; const steps = pieces("a"); const holder = { next: steps.next }; try { mark("got " + show(await holder.next())); } catch (error) { mark("caught " + error.constructor.name); } mark("got " + show(await steps.next())); }
outer();`,
  "the-generator-steps-itself": `let self;
async function* pieces(tag) { mark(tag + " starts"); const asked = self.next("from inside"); mark(tag + " asked itself"); const sent = yield tag + 0; mark(tag + " was sent " + String(sent)); const again = yield tag + 1; mark(tag + " was sent " + String(again)); mark(tag + " own step " + show(await asked)); }
async function outer() { await null; self = pieces("a"); for (let i = 0; i < 4; i++) mark("got " + show(await self.next("s" + i))); }
outer();`,
  "a-context-of-async-local-storage": `import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
async function* pieces(tag) { mark(tag + " starts in " + storage.getStore()); const sent = yield tag + 0; mark(tag + " goes on in " + storage.getStore()); storage.enterWith(tag + " entered"); yield tag + 1; mark(tag + " ends in " + storage.getStore()); }
async function outer() { await null; const steps = storage.run("made", () => pieces("a")); mark("got " + show(await storage.run("first", () => steps.next())) + " in " + storage.getStore()); mark("got " + show(await steps.next()) + " in " + storage.getStore()); mark("got " + show(await steps.next()) + " in " + storage.getStore()); mark("got " + show(await steps.next()) + " in " + storage.getStore()); }
storage.run("main", () => outer());`,
  "a-collection-between-the-steps": `async function* pieces(tag) { for (let i = 0; i < 4; i++) { const kept = { tag, list: [i, i + 1] }; Bun.gc(true); yield kept; mark(kept.tag + kept.list.join()); } }
async function outer() { await null; const steps = pieces("a"), held = []; for (;;) { const step = await steps.next(); Bun.gc(true); if (step.done) break; held.push(step.value); } mark(held.map(one => one.list.join("")).join()); }
outer();`,
  "many-values-alive-across-the-step": `${plain}
async function outer(a, b, c, d, e, f, g, h) { await null; const steps = pieces("a"); let sum = 0; for (;;) { const step = await steps.next(a + b); if (step.done) break; sum += step.value.length + a + b + c + d + e + f + g + h; } mark("sum " + sum); }
outer(1, 2, 3, 4, 5, 6, 7, 8);`,
  "a-result-that-is-changed-and-read-again": `${plain}
async function outer() { await null; const steps = pieces("a"); const step = await steps.next(); step.value += "!"; step.extra = 1; mark(JSON.stringify(step)); const next = await steps.next(); mark(JSON.stringify(next) + " " + ("extra" in next)); }
outer();`,
  "the-step-under-a-race": `${plain}
async function outer() { await null; const steps = pieces("a"); const won = await Promise.race([steps.next(), new Promise(resolve => setTimeout(() => resolve({ value: "timer", done: false }), 5))]); mark("won " + show(won)); mark("got " + show(await steps.next())); }
outer();`,
  "an-object-that-only-looks-like-a-generator": `function counted() { let turn = 0; return { next(sent) { mark("plain next " + String(sent)); return turn < 2 ? { value: turn++, done: false } : Promise.resolve({ value: "end", done: true }); } }; }
async function outer() { await null; const steps = counted(); for (;;) { const step = await steps.next("s"); mark("got " + show(step)); if (step.done) break; } }
outer();`,
  "a-sync-generator-stepped-with-await": `function* pieces(tag) { const sent = yield tag + 0; mark(tag + " was sent " + String(sent)); yield Promise.resolve(tag + 1); }
async function outer() { await null; const steps = pieces("a"); for (;;) { const step = await steps.next("s"); mark("got " + String(step.value instanceof Promise ? "a promise" : step.value) + " " + step.done); if (step.done) break; } }
outer();`,
  "receivers-of-many-kinds-in-one-loop": `${plain}
async function drain(name, steps) { try { for (let turn = 0; turn < 5; turn++) { const step = await steps.next("s" + turn); mark(name + " got " + show(step)); if (step.done) break; } } catch (error) { mark(name + " failed " + error.constructor.name); } }
function* plainSteps() { yield "p0"; yield "p1"; }
async function outer() { await null;
  await drain("generator", pieces("a"));
  await drain("null", null);
  await drain("undefined", undefined);
  await drain("number", 5);
  await drain("text", "text");
  await drain("proxy", new Proxy(pieces("b"), {}));
  await drain("proxy with a trap", new Proxy(pieces("c"), { get(target, key) { mark("trap " + String(key)); const found = target[key]; return typeof found === "function" ? found.bind(target) : found; } }));
  await drain("heir", Object.create(pieces("d")));
  await drain("sync", plainSteps());
  await drain("list iterator", [1, 2][Symbol.iterator]());
  await drain("frozen", Object.freeze(pieces("e")));
  await drain("generator again", pieces("f")); }
outer();`,
  "a-generator-of-another-realm": `import vm from "node:vm";
${plain}
async function drain(name, steps) { try { for (let turn = 0; turn < 4; turn++) { const step = await steps.next("s" + turn); mark(name + " got " + show(step)); if (step.done) break; } } catch (error) { mark(name + " failed " + error.name); } }
async function outer() { await null; await drain("own", pieces("a")); await drain("foreign", vm.runInNewContext("(async function* () { const sent = yield 'f0'; yield 'f1 ' + sent; })()")); const own = pieces("b"), foreign = vm.runInNewContext("(async function* () { yield 'g0'; })()"); await drain("own next on foreign", { next: sent => own.next.call(foreign, sent) }); await drain("own", own); }
outer();`,
  "a-getter-next-and-an-argument-with-effects": `${plain}
async function outer() { await null; const steps = pieces("a"); let reads = 0; Object.defineProperty(steps, "next", { configurable: true, get() { mark("next read " + ++reads); return Object.getPrototypeOf(Object.getPrototypeOf(steps)).next; } }); for (let turn = 0; turn < 5; turn++) { const step = await steps.next((mark("argument " + turn), "s" + turn)); mark("got " + show(step)); if (step.done) break; } }
outer();`,
  "an-argument-that-replaces-next": `${plain}
async function outer() { await null; const steps = pieces("a"); for (let turn = 0; turn < 4; turn++) { const step = await steps.next((turn === 1 && (steps.next = () => ({ value: "replaced", done: true })), "s" + turn)); mark("got " + show(step)); if (step.done) break; } }
outer();`,
  "an-argument-that-steps-the-generator": `${plain}
async function outer() { await null; const steps = pieces("a"); const asked = []; for (let turn = 0; turn < 3; turn++) { const step = await steps.next((asked.push(steps.next("inner " + turn)), "outer " + turn)); mark("got " + show(step)); } for (const one of asked) mark("asked " + show(await one)); }
outer();`,
  "the-result-is-read-by-other-keys": `${plain}
async function outer() { await null; const steps = pieces("a"); for (;;) { const step = await steps.next(); mark(String(step.done) + String(step.value) + String(step.other) + String("value" in step) + String(step.hasOwnProperty("done")) + typeof step + String(step === null) + String(step == undefined)); if (step.done) break; } }
outer();`,
  "the-result-goes-through-a-join": `${plain}
async function outer(flag) { await null; const steps = pieces("a"); for (let turn = 0; ; turn++) { let step; if (turn & 1) step = await steps.next("odd"); else step = await steps.next("even"); const seen = flag ? step : null; mark("got " + show(seen)); if (seen.done) break; } }
outer(true);`,
  "a-step-in-each-arm-of-a-condition": `${plain}
async function outer() { await null; const left = pieces("l"), right = pieces("r"); for (let turn = 0; turn < 8; turn++) { const step = turn % 3 ? await left.next(turn) : await right.next(turn); mark("got " + show(step)); } }
outer();`,
  "a-receiver-that-is-one-of-two-kinds": `${plain}
function counted() { let turn = 0; return { next() { return { value: "plain " + turn, done: turn++ > 1 }; } }; }
async function drain(steps) { for (;;) { const step = await steps.next(); mark("got " + show(step)); if (step.done) break; } }
async function outer() { await null; await drain(pieces("a")); await drain(counted()); await drain(pieces("b")); }
outer();`,
};
const contextProducers = {
  "reads-the-context": `async function* pieces(tag) { for (let i = 0; i < 3; i++) { mark(tag + " makes " + i + " in " + storage.getStore()); yield tag + i; } mark(tag + " ends in " + storage.getStore()); }`,
  "enters-in-front-of-its-yield": `async function* pieces(tag) { for (let i = 0; i < 3; i++) { storage.enterWith(tag + " entered " + i); yield tag + i; mark(tag + " goes on in " + storage.getStore()); } }`,
  "enters-behind-its-yield": `async function* pieces(tag) { for (let i = 0; i < 3; i++) { yield tag + i; storage.enterWith(tag + " entered " + i); mark(tag + " goes on in " + storage.getStore()); } }`,
  "awaits-then-enters": `async function* pieces(tag) { for (let i = 0; i < 3; i++) { await null; storage.enterWith(tag + " entered " + i); mark(tag + " awaited in " + storage.getStore()); yield tag + i; } }`,
  "waits-for-a-job-then-reads": `async function* pieces(tag) { for (let i = 0; i < 2; i++) { await new Promise(resolve => queueMicrotask(resolve)); mark(tag + " resumed in " + storage.getStore()); yield tag + i; } }`,
  "throws-behind-entering": `async function* pieces(tag) { yield tag + 0; storage.enterWith(tag + " entered"); throw new Error(tag + " failed"); }`,
};
const contextConsumers = {
  "reads-behind-each-step": `for (;;) { const step = await steps.next(); mark("got " + show(step) + " in " + storage.getStore()); if (step.done) break; }`,
  "enters-between-the-steps": `for (let turn = 0; ; turn++) { storage.enterWith("turn " + turn); const step = await steps.next(); mark("got " + show(step) + " in " + storage.getStore()); if (step.done) break; }`,
  "steps-under-run": `for (let turn = 0; ; turn++) { const step = await storage.run("run " + turn, async () => { const inner = await steps.next(); mark("inner " + show(inner) + " in " + storage.getStore()); return inner; }); mark("got " + show(step) + " in " + storage.getStore()); if (step.done) break; }`,
  "asks-twice-then-awaits": `const first = steps.next(); storage.enterWith("between"); const second = await steps.next(); mark("second " + show(second) + " in " + storage.getStore()); mark("first " + show(await first) + " in " + storage.getStore()); mark("third " + show(await steps.next()) + " in " + storage.getStore());`,
};
for (const [producer, made] of Object.entries(contextProducers))
  for (const [consumer, body] of Object.entries(contextConsumers))
    for (const [entry, [first]] of Object.entries(entries))
      write(`context--${producer}--${consumer}--${entry}`, `import { AsyncLocalStorage } from "node:async_hooks";
${head}const storage = new AsyncLocalStorage();
${made}
async function outer() { ${first} const steps = pieces("a"); try { ${body} } catch (error) { mark("caught " + error.message + " in " + storage.getStore()); } await null; mark("a turn on in " + storage.getStore()); }
storage.run("main", () => { outer().then(() => mark("done in " + storage.getStore())); mark("main behind outer in " + storage.getStore()); });
${tail}`);

const endsOfBodies = {
  "returns": `mark(tag + " returns"); return tag + " result";`,
  "throws": `mark(tag + " throws"); throw new Error(tag + " failed");`,
  "returns-a-promise": `mark(tag + " returns"); return Promise.resolve(tag + " promised");`,
  "awaits-then-returns": `await null; mark(tag + " returns"); return tag + " result";`,
  "yields-once-more": `mark(tag + " yields"); yield tag + " more"; mark(tag + " ends");`,
  "falls-off-the-end": `mark(tag + " ends");`,
  "awaits-then-falls-off-the-end": `await null; mark(tag + " ends");`,
  "awaits-then-throws": `await null; mark(tag + " throws"); throw new Error(tag + " failed");`,
  "returns-under-a-finally-that-awaits": `try { mark(tag + " returns"); return tag + " result"; } finally { await null; mark(tag + " finally"); }`,
};
const askersInside = {
  "asks-itself-twice": `self.next("x").then(step => mark("queued one " + show(step)), error => mark("queued one failed " + error.message)); self.next("y").then(step => mark("queued two " + show(step)), error => mark("queued two failed " + error.message));`,
  "asks-itself-and-closes-itself": `self.next("x").then(step => mark("queued next " + show(step)), error => mark("queued next failed " + error.message)); self.return("z").then(step => mark("queued return " + show(step)), error => mark("queued return failed " + error.message));`,
  "a-function-it-calls-asks": `askFromOutside();`,
};
for (const [end, last] of Object.entries(endsOfBodies))
  for (const [asker, asks] of Object.entries(askersInside))
    for (const [entry, [first]] of Object.entries(entries))
      for (const [bystander, beside] of Object.entries(bystanders))
        write(`requests-queued-in-the-step--${end}--${asker}--${entry}--${bystander}`, `${head}let self;
function askFromOutside() { self.next("o").then(step => mark("asked from outside " + show(step)), error => mark("asked from outside failed " + error.message)); }
async function* pieces(tag) { yield tag + 0; ${asks} ${last} }
async function outer() { ${first} self = pieces("a"); for (let turn = 0; turn < 5; turn++) { try { mark("got " + show(await self.next("s" + turn))); } catch (error) { mark("caught " + error.message); } } }
${beside}
outer().then(() => mark("outer done")); mark("main behind outer");
${tail}`);

const deedsOnResults = {
  "a-member-is-stored": `step.value = "stored";`,
  "a-member-is-deleted": `delete step.done;`,
  "a-member-is-redefined": `Object.defineProperty(step, "value", { get() { mark("getter runs"); return "from a getter"; } });`,
  "a-function-changes-it": `change(step);`,
  "it-is-changed-during-a-later-await": `Promise.resolve().then(() => { step.value = "changed in a job"; step.done = "no boolean"; }); await null;`,
  "it-is-frozen-then-stored-to": `Object.freeze(step); try { step.value = "stored"; } catch (error) { mark("refused " + error.constructor.name); }`,
  "its-prototype-is-replaced": `delete step.value; Object.setPrototypeOf(step, { value: "inherited" });`,
  "it-is-stored-under-a-computed-key": `step[keyOf("val", "ue")] = "computed";`,
  "it-is-assigned-over": `Object.assign(step, { value: "assigned", done: 1 });`,
  "another-name-stores": `const alias = step; alias.value = "by another name";`,
};
for (const [deed, does] of Object.entries(deedsOnResults))
  for (const [entry, [first]] of Object.entries(entries))
    for (const place of ["in-a-loop", "outside-a-loop"])
      write(`the-result--${deed}--${entry}--${place}`, `${head}${plain}
function change(step) { step.value = "changed by a function"; step.done = undefined; }
function keyOf(left, right) { return left + right; }
async function outer() { ${first} const steps = pieces("a"); ${place === "in-a-loop" ? "for (let turn = 0; turn < 3; turn++) {" : "{"} const step = await steps.next(); mark("read " + String(step.value) + " " + String(step.done)); ${does} mark("read again " + String(step.value) + " " + String(step.done)); } }
outer().then(() => mark("outer done"), error => mark("outer failed " + error.message));
${tail}`);

const firstContexts = {
  "behind-an-await-of-a-value": `await null; storage.enterWith(tag + " entered"); yield tag + 0; mark(tag + " goes on in " + storage.getStore()); yield tag + 1;`,
  "behind-an-await-of-a-timer": `await new Promise(resolve => setTimeout(resolve, 1)); storage.enterWith(tag + " entered"); yield tag + 0; mark(tag + " goes on in " + storage.getStore()); yield tag + 1;`,
  "behind-an-await-of-a-job": `await new Promise(resolve => queueMicrotask(resolve)); storage.enterWith(tag + " entered"); yield tag + 0; yield tag + 1;`,
  "in-front-of-every-await": `storage.enterWith(tag + " entered"); yield tag + 0; mark(tag + " goes on in " + storage.getStore()); yield tag + 1;`,
  "behind-a-yield": `yield tag + 0; storage.enterWith(tag + " entered"); yield tag + 1; mark(tag + " goes on in " + storage.getStore());`,
  "behind-an-await-then-it-throws": `await null; storage.enterWith(tag + " entered"); throw new Error(tag + " failed");`,
  "behind-an-await-then-it-returns": `await null; storage.enterWith(tag + " entered"); return tag + " result";`,
  "behind-an-await-then-it-falls-off-its-end": `await null; storage.enterWith(tag + " entered");`,
  "in-a-generator-it-loops-over": `for await (const piece of inner(tag)) yield piece;`,
  "under-run-behind-an-await": `await null; yield storage.run(tag + " run", () => tag + " " + storage.getStore()); mark(tag + " goes on in " + storage.getStore()); yield tag + 1;`,
  "with-the-storage-made-there-too": `await null; const late = new AsyncLocalStorage(); late.enterWith(tag + " late"); others.push(late); yield tag + 0; yield tag + 1;`,
};
for (const [place, body] of Object.entries(firstContexts))
  for (const [entry, [first]] of Object.entries(entries))
    for (const [kind, [shape, call]] of Object.entries(kinds))
      write(`the-first-context--${place}--${kind}--${entry}`, `import { AsyncLocalStorage } from "node:async_hooks";
${head}const storage = new AsyncLocalStorage(), others = [];
function seen() { return String(storage.getStore()) + others.map(one => " " + one.getStore()).join(""); }
async function* inner(tag) { await null; storage.enterWith(tag + " inner entered"); yield tag + " inner 0"; yield tag + " inner 1"; }
async function* pieces(tag) { ${body} }
${shape.replace("FIRST", first).replace("BODY", `const steps = pieces("a"); for (let turn = 0; turn < 4; turn++) { try { const step = await steps.next(); mark("got " + show(step) + " in " + seen()); if (step.done) break; } catch (error) { mark("caught " + error.message + " in " + seen()); } } await null; mark("a turn on in " + seen());`)}
${call}.then(() => mark("done in " + seen())); mark("main behind outer in " + seen());
${tail}`);

const delegates = {
  "delegates-and-a-request-waits": `self.next("x").then(step => mark("queued " + show(step))); yield* inner(tag);`,
  "delegates-and-two-requests-wait": `self.next("x").then(step => mark("queued one " + show(step))); self.next("y").then(step => mark("queued two " + show(step))); yield* inner(tag);`,
  "yields-and-a-request-waits": `self.next("x").then(step => mark("queued " + show(step))); yield tag + 0; Promise.resolve().then(() => mark(tag + " job behind 0")); yield tag + 1;`,
  "delegates-to-a-list-and-a-request-waits": `self.next("x").then(step => mark("queued " + show(step))); yield* [tag + 0, tag + 1];`,
};
for (const [shape, body] of Object.entries(delegates))
  for (const [entry, [first]] of Object.entries(entries))
    for (const [bystander, beside] of Object.entries(bystanders))
      write(`a-yield-with-requests--${shape}--${entry}--${bystander}`, `${head}let self;
async function* inner(tag) { yield tag + " i0"; Promise.resolve().then(() => mark(tag + " job behind i0")); yield tag + " i1"; Promise.resolve().then(() => mark(tag + " job behind i1")); }
async function* pieces(tag) { ${body} }
async function outer() { ${first} const steps = self = pieces("a"); for (let turn = 0; turn < 4; turn++) { const step = await steps.next("s" + turn); mark("got " + show(step)); } }
${beside}
outer().then(() => mark("outer done")); mark("main behind outer");
${tail}`);

for (const [name, text] of Object.entries(others))
  write(name, (text.startsWith("import ") ? text.slice(0, text.indexOf("\n") + 1) + head + text.slice(text.indexOf("\n") + 1) : head + text) + "\n" + tail);
console.log(count + " programs");
