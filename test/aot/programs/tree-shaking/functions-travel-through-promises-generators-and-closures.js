// Each function is named once and handed on as a value: resolved by a promise, yielded by a generator, sent into one, returned by a closure, captured in a loop, thrown and caught, kept in a WeakRef, passed through an async iterator and through a callback of a callback.
function a() { return "a resolved promise"; } function b() { return "Promise.all"; } function c() { return "a yield"; } function d() { return "sent into a generator"; }
function e() { return "returned by a closure"; } function f() { return "captured in a loop"; } function g() { return "thrown and caught"; } function h() { return "a WeakRef"; }
function i() { return "an async iterator"; } function j() { return "a callback of a callback"; } function k() { return "a rejected promise"; } function l() { return "the return value of a generator"; }
function m() { return "curried"; } function n() { return "composed"; }

console.log((await Promise.resolve(a))());
console.log((await Promise.all([1, b]))[1]());
console.log((function* () { yield c; })().next().value());
const receiver = (function* () { const got = yield; yield got(); })();
receiver.next();
console.log(receiver.next(d).value);
console.log((() => () => e)()()());
const captured = [];
for (const each of [f]) captured.push(() => each);
console.log(captured[0]()());
try { throw g; } catch (caught) { console.log(caught()); }
console.log(new WeakRef(h).deref()());
for await (const each of (async function* () { yield i; })()) console.log(each());
console.log((callback => callback(inner => inner()))(run => run(j)));
console.log(await Promise.reject(k).catch(reason => reason()));
console.log((function* () { return l; })().next().value());
console.log((first => second => third => third())(1)(2)(m));
console.log([value => value, value => value()].reduce((value, step) => step(value), n));
