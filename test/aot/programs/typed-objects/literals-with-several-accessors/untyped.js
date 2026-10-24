import { makeCounter, makeOne, makeMany, sumOfCounter, sumOfMany } from "./shapes.ts";

function describe(o) {
  const descriptors = Object.getOwnPropertyDescriptors(o);
  return Reflect.ownKeys(o).map(key => {
    const d = descriptors[key];
    return String(key) + ":" + ("value" in d ? JSON.stringify(d.value) : (d.get ? "get" : "") + (d.set ? "set" : "")) + (d.enumerable ? "" : "!e") + (d.configurable ? "" : "!c");
  }).join();
}

export function run() {
  const said = new Set();
  let sum = 0;
  for (let i = 0; i < 300; i++) {
    const counter = makeCounter(i);
    sum += sumOfCounter(counter) + counter.next + counter["twice"];
    counter.twice = 10;
    counter.only = counter.start + i;
    counter.more = i;
    said.add(describe(counter).replace(/\d+/g, "n") + " | " + Object.keys(counter) + " | " + JSON.stringify(counter).replace(/\d+/g, "n") + " | " + Object.keys({ ...counter }));
    const one = makeOne(i);
    sum += one.next;
    said.add(describe(one).replace(/\d+/g, "n"));
    const many = makeMany(i);
    sum += sumOfMany(many) + many.j;
    if (i % 50 === 49) delete many.c;
    if (i % 70 === 69) Object.defineProperty(many, "k", { get() { return 1; }, enumerable: true, configurable: true });
    said.add(describe(many).replace(/\d+/g, "n"));
    if (typeof Bun !== "undefined" && i % 100 === 99) Bun.gc(true);
  }
  for (const line of said) console.log(line);
  console.log(sum);
}
