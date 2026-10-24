import { sumOfSix, sumOfFifty, sumOfSeventy } from "./core.ts";
import { HeirOfSix, HeirOfFifty, HeirOfSeventy, HeirOfTheHeir } from "./untyped.js";

declare const aotOperationCount: undefined | ((name: string) => number);
declare const gc: undefined | (() => void);
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : typeof Bun !== "undefined" ? () => Bun.gc(true) : () => {};

function rounds(name: string, Heir: new (seed: number) => any, sumOf: (value: any) => number, mayAsk: number) {
  const before = count("operationAOTCreateThis");
  const kept: any[] = [];
  let sum = 0;
  for (let i = 0; i < 3000; ++i) {
    const made = new Heir(i);
    made.o0 = i;
    made.f3 = "s" + i;
    sum += made.sum() + made.own + sumOf(made);
    if (i % 500 === 0) {
      kept.push(made);
      collect();
    }
  }
  const asked = count("operationAOTCreateThis") - before;
  const last = kept[kept.length - 1];
  console.log(name, sum, Object.keys(last).length, Object.keys(last).slice(0, 3).join(), Object.keys(last).slice(-3).join());
  console.log(name, "each its own:", kept.map(made => made.f1 + ":" + made.f3 + ":" + made.o0 + ":" + made.own).join(" "));
  console.log(name, "untouched fields:", last.f0, last.f2, last.o1, JSON.stringify(last).length);
  console.log(name, asked <= mayAsk ? "the run time made at most " + mayAsk + " of 3,000" : "the run time made " + asked + " of 3,000");
}

rounds("six", HeirOfSix, sumOfSix, 300);
rounds("fifty", HeirOfFifty, sumOfFifty, 300);
rounds("an heir of the heir", HeirOfTheHeir, sumOfFifty, 300);
rounds("seventy", HeirOfSeventy, sumOfSeventy, 3000);
