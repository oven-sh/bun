import { Options, Packed, Extended, makeSettings } from "./shapes.ts";

class Heir extends Extended {}
class HeirWithSetter extends Extended {
  set k2(value) {
    this.caughtByTheHeir = value;
  }
  get k2() {
    return "of the heir";
  }
}

const keys = [];
for (let i = 0; i < 12; i++) keys.push("k" + i);
const mark = Symbol("mark");
const odd = ["host", "watched", "__proto__", "7", "toString", "constructor", "always"];

function give(o, count, value) {
  for (let i = 0; i < count; i++) o[keys[i]] = value;
}
function giveOne(o, key, value) {
  o[key] = value;
}

function describe(o) {
  return Reflect.ownKeys(o).map(String).join() + " " + JSON.stringify(o);
}

function many(label, make, change, rounds = 60) {
  const said = new Map();
  for (let i = 0; i < rounds; i++) {
    const o = make();
    let refused = "";
    try {
      change(o, i);
    } catch (error) {
      refused = " " + error.constructor.name;
    }
    const text = describe(o) + refused;
    said.set(text, (said.get(text) ?? 0) + 1);
  }
  console.log(label, [...said].map(([text, count]) => count + " x " + text).join(" || "));
}

const makers = {
  Options: () => new Options(),
  Packed: () => new Packed(),
  Extended: () => new Extended(),
  Heir: () => new Heir(),
  HeirWithSetter: () => new HeirWithSetter(),
  record: () => makeSettings(1),
  plain: () => ({}),
};

export function run() {
  for (const maker in makers) {
    const make = makers[maker];
    many(maker + " one", make, o => give(o, 1, 5));
    many(maker + " three", make, o => give(o, 3, 5));
    many(maker + " twelve", make, o => give(o, 12, 5));
    many(maker + " a number that goes round", make, (o, i) => give(o, i % 5, 5));
    many(maker + " then fields", make, o => { give(o, 2, 5); if (o.fill) o.fill(1); give(o, 4, 6); });
    many(maker + " a symbol", make, o => { giveOne(o, mark, 1); give(o, 2, 5); });
    many(maker + " by name first", make, o => { o.named = 1; give(o, 2, 5); o.last = 2; });
    many(maker + " deleted in between", make, o => { give(o, 3, 5); delete o[keys[1]]; give(o, 3, 6); });
    for (const key of odd) {
      if (key === "always" && maker === "Packed") continue;
      many(maker + " under " + key, make, o => { give(o, 1, 5); giveOne(o, key, key === "host" ? "h" : 3); give(o, 2, 6); }, 20);
    }
    many(maker + " not extensible from the thirtieth on", make, (o, i) => { give(o, 1, 5); if (i >= 30) Object.preventExtensions(o); give(o, 2, 6); });
    many(maker + " frozen from the thirtieth on", make, (o, i) => { give(o, 1, 5); if (i >= 30) Object.freeze(o); give(o, 2, 6); });
  }

  many("the prototype gets a setter in the middle", () => new Heir(), (o, i) => {
    if (i === 30) Object.defineProperty(Heir.prototype, keys[1], { set(value) { this.caughtLater = value; }, get() { return "later"; }, configurable: true });
    give(o, 3, 5);
  });
  many("Object.prototype is asked", () => new Options(), o => { giveOne(o, "valueOf", 1); giveOne(o, "hasOwnProperty", 2); });

  many("across collections", () => new Options(), (o, i) => {
    give(o, 4, i >> 5);
    if (typeof Bun !== "undefined" && i % 32 === 31) Bun.gc(true);
  }, 128);

  const held = [];
  for (let i = 0; i < 3000; i++) {
    const o = i & 1 ? new Options() : new Packed();
    give(o, 1 + (i % 7), { i });
    held.push(o);
  }
  let sum = 0;
  for (const o of held) for (const key of Object.keys(o)) sum += typeof o[key] === "object" ? o[key].i : 0;
  console.log("held", sum);
}
