import { Options, Packed, Extended, Wide, makeSettings, fillSettings, fillSettingsBackwards, makeTagAndFill } from "./shapes.ts";

class Heir extends Extended {}
class HeirWithSetter extends Extended {
  set port(value) {
    this.seen = value;
  }
  get port() {
    return -1;
  }
}
class HeirWithFields extends Extended {
  before = "before";
  constructor() {
    super();
    this.inConstructor = true;
  }
}

function digest(text) {
  if (text.length <= 240) return text;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return text.slice(0, 60) + " .. " + text.length + " characters, " + (hash >>> 0).toString(16);
}

function describe(o) {
  const inLoop = [];
  for (const key in o) inLoop.push(key);
  const keys = Object.keys(o).join();
  const others = [Reflect.ownKeys(o).map(String).join(), inLoop.join(), Object.keys({ ...o }).join(), Object.keys(JSON.parse(JSON.stringify(o))).join()];
  return digest(keys) + " | " + digest(JSON.stringify(o)) + " | " + others.map(other => (other === keys ? "same" : digest(other))).join(" | ");
}

function fillLost(o, port) {
  o.host = "localhost";
  o.port = port;
  o.path = "/";
  o.secure = false;
}

const makers = {
  Options: () => new Options(),
  Packed: () => new Packed(),
  Extended: () => new Extended(),
  Heir: () => new Heir(),
  HeirWithSetter: () => new HeirWithSetter(),
  HeirWithFields: () => new HeirWithFields(),
  Wide: () => new Wide(),
  byValue: () => new (globalThis.chosen ?? Options)(),
  reflected: () => Reflect.construct(Options, [], Options),
  underAnotherPrototype: () => Reflect.construct(Extended, [], Heir),
};

const givers = {
  nothing(o) {},
  oneByName(o, i) { o.tag = i; },
  twoByName(o, i) { o.tag = i; o.more = i; },
  twoTheOtherWayRound(o, i) { o.more = i; o.tag = i; },
  byKey(o, i) { o["key" + (i & 3)] = i; },
  byKeyAndName(o, i) { o["key" + (i & 3)] = i; o.tag = i; },
  symbol(o, i) { o[Symbol.for("mark")] = i; o.tag = i; },
  index(o, i) { o[7] = i; o.tag = i; o[3] = i; },
  defined(o, i) { Object.defineProperty(o, "hidden", { value: i, enumerable: false, configurable: true, writable: true }); o.tag = i; },
  accessor(o, i) { Object.defineProperty(o, "computed", { get() { return i; }, enumerable: true, configurable: true }); },
  deleted(o, i) { o.tag = i; o.more = i; delete o.tag; },
  deletedAndGivenAgain(o, i) { o.tag = i; o.more = i; delete o.tag; o.tag = i + 1; },
  many(o, i) { for (let n = 0; n < 80; n++) o["n" + n] = i; },
  manyThenFewer(o, i) { for (let n = 0; n < 80; n++) o["n" + n] = i; for (let n = 0; n < 78; n++) delete o["n" + n]; },
};

const fillers = {
  atOnce(o, i) { o.fill(i); },
  backwards(o, i) { o.fillBackwards(i); },
  apart(o, i) { o.setHost("h"); o.setPort(i); o.setPath("p"); o.setSecure(true); },
  someThenAll(o, i) { o.setPath("first"); o.fill(i); },
  withMoreBetween(o, i) { o.setHost("h"); o.between1 = i; o.setPort(i); o.between2 = i; o.setPath("p"); o["between" + 3] = i; o.setSecure(false); },
  lost(o, i) { fillLost(o, i); },
  deletedAndCreatedAgain(o, i) { o.fill(i); delete o.port; o.afterDelete = i; o.setPort(i + 1); },
};

export function run() {
  for (const maker in makers) {
    for (const giver in givers) {
      for (const filler in fillers) {
        const said = new Set();
        for (let i = 0; i < 6; i++) {
          const o = makers[maker]();
          givers[giver](o, i);
          fillers[filler](o, i);
          said.add(describe(o));
        }
        console.log(maker, giver, filler, said.size, [...said].at(-1));
      }
    }
  }
  for (const giver in givers) {
    for (const fill of [fillSettings, fillSettingsBackwards, fillLost]) {
      const said = new Set();
      for (let i = 0; i < 6; i++) {
        const o = makeSettings(100);
        givers[giver](o, i);
        fill(o, i);
        said.add(describe(o));
      }
      console.log("record", giver, fill.name, said.size, [...said].at(-1));
    }
  }
  for (let i = 0; i < 4; i++) console.log("inferred", describe(makeTagAndFill(i)));

  const shapes = [];
  for (let i = 0; i < 700; i++) {
    const o = i & 1 ? new Options() : new Packed();
    o["shape" + (i % 350)] = i;
    if (i % 3 === 0) o.tag = i;
    if (i % 5 === 0) o.setPath("early");
    o.fill(i);
    shapes.push(Object.keys(o).join());
  }
  console.log("many shapes", new Set(shapes).size, shapes[0], shapes[1], shapes[349], shapes[350], shapes[699]);

  const kept = [];
  for (let round = 0; round < 40; round++) {
    const garbage = [];
    for (let i = 0; i < 2000; i++) {
      const o = i & 1 ? new Options() : new Packed();
      o["round" + round + "shape" + (i & 7)] = i;
      o.fill(i);
      garbage.push(o);
    }
    kept.push(Object.keys(garbage[round]).join(), Object.keys(garbage[1999 - round]).join());
    if (typeof Bun !== "undefined" && round % 8 === 0) Bun.gc(true);
  }
  console.log("across collections", new Set(kept).size, kept[0], kept[1], kept[78], kept[79]);

  const frozen = new Options();
  frozen.tag = 1;
  Object.preventExtensions(frozen);
  let refused = "no";
  try {
    frozen.fill(1);
  } catch (error) {
    refused = error.constructor.name;
  }
  console.log("not extensible", refused, describe(frozen));
}
