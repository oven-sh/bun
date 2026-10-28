import * as typed from "./core.ts";
import { Heir, Overrides, HeirOfTwice, HeirOfChooses, callThreeUntyped, readOneUntyped, lookUntyped, anything, removed, redefined, overwrittenUntyped } from "./untyped.js";

declare const aotOperationCount: undefined | ((name: string) => number);
declare const gc: undefined | (() => void);
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : typeof Bun !== "undefined" ? () => Bun.gc(true) : () => {};

function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  console.log(name + ": " + text);
}
const make = (base: number): typed.Core => anything(new Heir(base));

for (let i = 0; i < 60; ++i) {
  typed.callThree(make(i));
  typed.callBackwards(make(i));
  typed.readOne(make(i));
  callThreeUntyped(make(i));
  make(i).viaThis();
}
say("called", () => [typed.callThree(make(10)), typed.callBackwards(make(10)), callThreeUntyped(make(10)), make(10).viaThis()]);
say("read", () => {
  const core = make(3);
  const emit = typed.readOne(core);
  return [typeof emit, emit === core.emit, emit === typed.readOne(core), emit === readOneUntyped(core), emit === core.readsItsOwn(), emit(5), emit.name, emit.length, emit === make(3).emit];
});
say("read first by untyped code", () => {
  const core = make(3);
  const emit = readOneUntyped(core);
  return [emit === typed.readOne(core), emit(5)];
});
say("into a typed variable", () => typed.readIntoVariable(make(4)));
say("typeof", () => typed.kinds(make(1)));
say("the same twice", () => typed.sameTwice(make(1)));
say("two instances differ", () => typed.differ(make(1), make(1)));
say("this", () => {
  const core = make(2);
  return [core.self() === core, core.self.call({ base: 99 }) === core, core.both(make(5)), core.free(1), core.plain.call(undefined), core.plain()];
});
say("destructured", () => typed.destructured(make(7)));
say("spread", () => typed.spreadOf(make(6)));
say("spread with more", () => typed.spreadWithMore(make(6)));
say("assigned", () => typed.assigned(make(6)));
say("listed before any read", () => typed.listed(make(1)));
say("listed behind a read", () => {
  const core = make(1);
  core.load();
  return typed.listed(core);
});
say("listed by untyped code", () => lookUntyped(make(1)));
say("described", () => typed.described(make(1)));
say("overwritten before the first read", () => typed.overwritten(make(1)));
say("overwritten behind the first read", () => {
  const core = make(1);
  core.emit(1);
  return typed.overwritten(core);
});
say("replaced by a method", () => {
  const core = make(1);
  return [core.replaces(), core.load(), Object.keys(core).join()];
});
say("deleted before the first read", () => removed(make(1)));
say("deleted, stored again", () => {
  const core = make(1);
  removed(core);
  core.emit = value => value;
  return [core.emit(4), Object.keys(core).join()];
});
say("redefined", () => redefined(make(1)));
say("redefined, then read by typed code", () => {
  const core = make(1);
  redefined(core);
  return [typed.readOne(core)(1), typed.callThree(core), typed.kinds(core), typed.listed(core)];
});
say("overwritten by untyped code before the first read", () => {
  const core = make(1);
  overwrittenUntyped(core);
  return [typed.readOne(core)(10), typed.callThree(core), Object.keys(core).join()];
});
say("an optional one stored later", () => {
  const core = make(1);
  return [typed.storesLater(core), Object.keys(core).join()];
});
say("frozen before the first read", () => {
  const core = Object.freeze(make(4));
  return [core.emit(2), typed.readOne(core) === core.emit, Object.isFrozen(core), core.load()];
});
say("sealed", () => {
  const core = Object.seal(make(4));
  return [typed.callThree(core), Object.isSealed(core)];
});
say("not extensible", () => {
  const core = Object.preventExtensions(make(4));
  return [typed.callThree(core), Object.isExtensible(core)];
});
say("inherited", () => {
  const below: typed.Core = Object.create(make(8));
  return [below.emit(2), below.self() === Object.getPrototypeOf(below), Object.keys(below).length, typed.callThree(below), Object.keys(below).join()];
});
say("async", () => typeof make(1).waits().then);
say("an heir overrides", () => {
  const core: typed.Core = anything(new Overrides(2));
  return [core.emit(1), typed.readOne(core)(2), core.never(), core.load(), Object.keys(core).join(), (core as any).mine()];
});
say("stored twice", () => [typed.runOf(anything(new HeirOfTwice(false))), typed.runOf(anything(new HeirOfTwice(true))), Object.keys(new HeirOfTwice(true)).join()]);
say("one of two", () => [typed.runOf(anything(new HeirOfChooses(false))), typed.runOf(anything(new HeirOfChooses(true)))]);
say("a class that is made keeps its layout", () => [typed.runOf(typed.makeOne()), Object.keys(typed.makeOne()).join()]);
say("a property on the function", () => {
  let sum = 0;
  for (let i = 0; i < 40; ++i) {
    const core = make(i);
    if (i % 2) (core.marked as any).mark = "a property on the function " + i;
    sum += core.marked() + ((core.marked as any).mark ? (core.marked as any).mark.length : 0) + Object.keys(core.marked).length;
  }
  return sum;
});
say("old objects", () => {
  const old: typed.Core[] = [];
  for (let i = 0; i < 50; ++i) old.push(make(i));
  collect();
  collect();
  let sum = 0;
  for (const core of old) sum += typed.callThree(core);
  collect();
  for (const core of old) sum += typed.callBackwards(core) + core.never();
  return sum;
});
say("made and not read", () => {
  const closures = "operationAOTMaterializeDeferredClosure";
  const before = count(closures);
  let sum = 0;
  for (let i = 0; i < 20000; ++i) sum += make(i).base;
  const created = count(closures) - before;
  return [sum, created <= 20000 * 2 ? "at most two closures over `this` an object" : created + " closures over `this`"];
});
say("rounds", () => {
  let sum = 0;
  const names = ["operationAOTGetByIdAndCache", "operationAOTPutById", "operationAOTPutByIdAndCache", "operationAOTCreateThis"];
  const before = names.map(count);
  for (let i = 0; i < 3000; ++i) sum += typed.callThree(make(i)) + (i % 3 ? typed.callBackwards(make(i)) : typed.readOne(make(i))(1)) + callThreeUntyped(make(i));
  const asked = names.map((name, at) => count(name) - before[at]);
  return [sum, asked.every(times => times <= 300) ? "the run time was asked at most 300 times each" : names.map((name, at) => name + " " + asked[at]).join()];
});
