import * as typed from "./core.ts";
import { sumOf, type Wide } from "./wide.ts";
import * as plain from "./untyped.js";

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
const behind = (base: number): typed.BehindCode => plain.anything(new plain.HeirBehindCode(base));

for (let i = 0; i < 40; ++i) typed.callAll(behind(i));
say("behind code", () => [typed.callAll(behind(3)), typed.namesOf(behind(3)), JSON.stringify(behind(3))]);
say("identity", () => {
  const one = behind(1), other = behind(1);
  return [one.add === one.add, one.add !== other.add, one.self() === one, other.self() === other, one.add.name, one.add.length, one.last.call(other)];
});
say("not read, listed", () => {
  const core = behind(2);
  return [Object.entries(core).map(([name, value]) => name + ":" + typeof value).join(), Object.getOwnPropertyNames(core).length, "twice" in core];
});
say("described", () => {
  const descriptor = Object.getOwnPropertyDescriptor(behind(1), "twice")!;
  return [typeof descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable, "get" in descriptor];
});
say("spread", () => {
  const core = behind(4);
  const copy = { ...core, more: 1 };
  return [Object.keys(copy).join(), copy.add(1), copy.self() === core, copy.add === core.add];
});
say("async", () => typeof behind(1).waits().then);
say("an heir adds", () => {
  const core: typed.BehindCode & { more(): number } = plain.anything(new plain.HeirWithMore(5));
  return [core.more(), Object.keys(core).join()];
});
say("an heir has accessors of those names", () => {
  const core: typed.BehindCode = plain.anything(new plain.HeirWithAccessors(5));
  return [core.add(1), core.twice(), Object.keys(core).join()];
});
say("reads ahead", () => {
  const core: typed.ReadsAhead = plain.anything(new plain.HeirReadsAhead());
  return [core.early, core.first(), core.later()];
});
say("shown in the middle", () => {
  const core: typed.ShownInTheMiddle = plain.anything(new plain.HeirShown());
  return [core.seen, core.before(), core.after(), Object.keys(core).join()];
});
say("asks its heir", () => {
  const core: typed.AsksItsHeir = plain.anything(new plain.HeirAsked());
  return [core.answer, core.before(), core.after()];
});
say("stores sometimes", () => [false, true].map(stores => {
  const core: typed.StoresSometimes = plain.anything(new plain.HeirSometimes(stores));
  return [typeof core.run, core.run?.(), core.always(), Object.keys(core).join()];
}));
say("returns early", () => [false, true].map(stops => {
  const core: typed.ReturnsEarly = plain.anything(new plain.HeirReturnsEarly(stops));
  return [typeof core.late, core.late?.(), core.other?.(), Object.keys(core).join()];
}));
say("stores twice", () => [false, true].map(again => {
  const core: typed.StoresTwice = plain.anything(new plain.HeirTwice(again));
  return core.run();
}));
say("stores in a loop", () => [0, 1, 3].map(turns => {
  const core: typed.StoresInALoop = plain.anything(new plain.HeirLoop(turns));
  return [typeof core.run, core.seen.length, new Set(core.seen).size, core.seen.at(-1) === core.run, core.run?.()];
}));
say("overwrites with a value", () => [false, true].map(overwrites => {
  const core: typed.OverwritesWithAValue = plain.anything(new plain.HeirOverwrites(overwrites));
  const run = core.run;
  return typeof run === "function" ? run() : run;
}));
say("throws in the middle", () => {
  let message = "";
  try {
    new plain.HeirThrows();
  } catch (error) {
    message = (error as Error).message;
  }
  const left: typed.ThrowsInTheMiddle = plain.kept.at(-1);
  return [message, Object.keys(left).join(), typeof left.before, typeof left.between, typeof left.after, left.before(), left.between()];
});
say("throws unseen", () => {
  const core: typed.ThrowsUnseen = plain.anything(new plain.HeirThrowsUnseen());
  return core.before();
});
say("catches", () => [false, true].map(throws => {
  const core: typed.Catches = plain.anything(new plain.HeirCatches(throws));
  return [core.caught, typeof core.second, core.second?.(), core.first()];
}));
say("returns another", () => {
  const other: object = { value: 99, run: () => 99 };
  const core: typed.ReturnsAnother = plain.anything(new plain.HeirReturnsAnother(undefined));
  return [plain.anything(new plain.HeirReturnsAnother(other)) === other, core.run()];
});
say("a typed heir between", () => {
  const low: typed.Base = plain.anything(new plain.HeirOfBase()), high: typed.Middle = plain.anything(new plain.HeirOfMiddle());
  return [low.shared(), low.replaced(), low.own(), Object.keys(low).join(), high.sawShared, high.shared(), high.replaced(), high.own(), high.mine(), Object.keys(high).join()];
});
say("stores itself", () => {
  const core: typed.StoresItself = plain.anything(new plain.HeirStoresItself());
  return [core.me === core, core.run()];
});
say("hands out a closure", () => {
  const core: typed.HandsOutAClosure = plain.anything(new plain.HeirHandsOut());
  return [plain.kept.at(-1)(), core.after()];
});
say("captures more", () => {
  const core: typed.CapturesMore = plain.anything(new plain.HeirCapturesMore(5));
  return [core.both(), core.one()];
});
say("another new.target", () => {
  const core: typed.GivenAway & { marker: string } = plain.constructAs(typed.GivenAway, [], plain.Other);
  return [core.marker, core.run(), core.self() === core, Object.keys(core).join(), core instanceof typed.GivenAway];
});
say("a class that is made keeps its layout", () => [typed.makeOne().run(), Object.keys(typed.makeOne()).join()]);
say("more fields than a structure takes lazily", () => {
  let sum = 0;
  const all: Wide[] = [];
  for (let i = 0; i < 300; ++i) {
    const wide: Wide = plain.anything(new plain.HeirOfWide());
    wide.f1 = i;
    all.push(wide);
    if (i % 100 === 50) collect();
  }
  for (const wide of all) sum += sumOf(wide) + (wide.self() === wide ? 1 : 0) + (wide.sum === wide.sum ? 1 : 0);
  return [sum, Object.keys(all[0]).length, all[0].sum !== all[1].sum, all[7].never()];
});
say("old objects", () => {
  const old: typed.BehindCode[] = [];
  for (let i = 0; i < 60; ++i) old.push(behind(i));
  collect();
  collect();
  let text = "";
  for (const core of old) text = typed.callAll(core);
  collect();
  return [text, old[5].twice(), old[59].self() === old[59]];
});
say("made and not read", () => {
  const closures = "operationAOTMaterializeDeferredClosure";
  const names = ["operationAOTPutById", "operationAOTPutByIdAndCache", "operationAOTCreateThis", "operationAOTGetByIdAndCache"];
  const before = names.map(count), closuresBefore = count(closures);
  let sum = 0;
  for (let i = 0; i < 20000; ++i) sum += behind(i).base;
  const asked = names.map((name, at) => count(name) - before[at]), created = count(closures) - closuresBefore;
  return [
    sum,
    created <= 20000 * 2 ? "at most two closures over `this` an object" : created + " closures over `this`",
    asked.every(times => times <= 300) ? "the run time was asked at most 300 times each" : names.map((name, at) => name + " " + asked[at]).join(),
  ];
});
