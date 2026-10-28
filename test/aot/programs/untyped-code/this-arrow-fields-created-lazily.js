// A constructor stores arrow functions that capture `this` to `this`; objects are made over and over, and each function is read for the first time in every way there is: called, read, destructured, listed, described, overwritten, deleted, copied, frozen, in different orders, in and out of the cell, on young and on old objects.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : typeof Bun !== "undefined" ? () => Bun.gc(true) : () => {};
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function Router(base) {
  this.base = base;
  this.update = value => { this.base += value; return this.base; };
  this.emit = value => this.base * value;
  this.load = () => this.base + 1;
  this.self = () => this;
  this.never = () => this.base + 2;
}
class Service {
  constructor(base) {
    this.base = base;
    this.first = () => this.base + 1;
    this.second = (a, b) => this.base + a + b;
    this.third = async () => this.base + 3;
    this.fourth = function () { return this === undefined ? "no this" : this.base + 4; };
    this.a0 = 0; this.a1 = 1; this.a2 = 2; this.a3 = 3; this.a4 = 4; this.a5 = 5; this.a6 = 6; this.a7 = 7;
    this.far = () => this.base + this.a7;
    this.farther = () => this.far() + 1;
  }
}
function callThree(router) { return router.update(1) + router.emit(2) + router.load(); }
function callBackwards(router) { return router.load() + router.emit(2) + router.update(1); }
function readOne(router) { return router.emit; }
function callFar(service) { return service.farther() + service.far() + service.first() + service.second(1, 2); }
const table = { callThree, callBackwards, readOne, callFar };

for (let i = 0; i < 60; ++i) {
  table.callThree(new Router(i));
  table.callBackwards(new Router(i));
  table.readOne(new Router(i));
  table.callFar(new Service(i));
}
say("called", table.callThree(new Router(10)), table.callBackwards(new Router(10)), table.callFar(new Service(10)));
{
  const router = new Router(3);
  const emit = table.readOne(router);
  say("read", typeof emit, emit === router.emit, emit === table.readOne(router), emit(5), emit.name, emit.length, emit === new Router(3).emit);
  say("this", router.self() === router, router.self.call({ base: 99 }) === router);
  const { update, load } = new Router(7);
  say("destructured", update(1), load());
}
{
  const router = new Router(1);
  say("keys before any read", Object.keys(router).join(), "emit" in router, Object.hasOwn(router, "never"), JSON.stringify(router));
  const descriptor = Object.getOwnPropertyDescriptor(router, "emit");
  say("described", typeof descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable, "get" in descriptor, descriptor.value === router.emit);
  router.load();
  say("keys behind a read", Object.keys(router).join());
  const names = [];
  for (const name in new Router(1)) names.push(name);
  say("for in", names.join());
  say("entries", Object.entries(new Router(2)).map(([name, value]) => name + ":" + typeof value).join());
}
{
  const router = new Router(1);
  router.emit = 5;
  say("overwritten before the first read", router.emit, Object.keys(router).join(), table.readOne(router));
  const other = new Router(1);
  say("deleted before the first read", delete other.emit, other.emit, table.readOne(other), Object.keys(other).join());
  other.emit = value => value;
  say("stored again", other.emit(4), Object.keys(other).join());
  const third = new Router(2);
  third.load();
  third.load = () => "replaced";
  say("overwritten behind the first read", third.load());
}
{
  const frozen = Object.freeze(new Router(4));
  say("frozen before the first read", frozen.emit(2), table.readOne(frozen) === frozen.emit, Object.isFrozen(frozen), frozen.load());
  const sealed = Object.seal(new Router(4));
  say("sealed", table.callThree(sealed), Object.isSealed(sealed));
  const closed = Object.preventExtensions(new Router(4));
  say("not extensible", table.callThree(closed), Object.isExtensible(closed));
}
{
  const router = new Router(6);
  const copy = Object.assign({}, router);
  const spread = { ...router };
  say("copied", copy.emit(2), spread.load(), copy.emit === router.emit, spread.self() === router, Object.keys(copy).join() === Object.keys(router).join());
  const below = Object.create(new Router(8));
  say("inherited", below.emit(2), below.self() === Object.getPrototypeOf(below), Object.keys(below).length, table.callThree(below), Object.keys(below).join());
}
{
  const service = new Service(1);
  say("other functions", service.fourth(), typeof service.third().then, service.second.length, service.far(), service.farther());
}
{
  // A function that is given a property is of another make, and is left out of the count below.
  function Marked(base) { this.base = base; this.run = () => this.base + 1; }
  let sum = 0;
  for (let i = 0; i < 40; ++i) {
    const marked = new Marked(i);
    if (i % 2) marked.run.mark = "a property on the function " + i;
    sum += marked.run() + (marked.run.mark ? marked.run.mark.length : 0) + Object.keys(marked.run).length;
  }
  say("a property on the function", sum);
}
{
  function makeOne(base) { const o = {}; o.base = base; o.run = () => o.base + 1; return o; }
  function makeOther(base) { const o = {}; o.base = base; o.run = () => o.base * 100; return o; }
  function run(o) { return o.run(); }
  let sum = 0;
  for (let i = 0; i < 200; ++i) sum += run(i % 2 ? makeOne(i) : makeOther(i));
  say("two makers, one shape", sum, run(makeOne(1)), run(makeOther(1)));
}
{
  const old = [];
  for (let i = 0; i < 50; ++i) old.push(new Router(i), new Service(i));
  collect();
  collect();
  let sum = 0;
  for (let i = 0; i < old.length; i += 2) sum += table.callThree(old[i]) + table.callFar(old[i + 1]);
  collect();
  for (let i = 0; i < old.length; i += 2) sum += table.callBackwards(old[i]) + table.callFar(old[i + 1]) + old[i].never();
  say("old objects", sum);
}
{
  let sum = 0;
  const before = count("operationAOTGetByIdAndCache");
  for (let i = 0; i < 3000; ++i) sum += table.callThree(new Router(i)) + table.callFar(new Service(i)) + (i % 3 ? table.callBackwards(new Router(i)) : table.readOne(new Router(i))(1));
  const asked = count("operationAOTGetByIdAndCache") - before;
  say("rounds", sum);
  say(asked <= 300 ? "the reads asked the run time at most 300 times" : "the reads asked the run time " + asked + " times");
}
console.log(lines.join("\n"));
