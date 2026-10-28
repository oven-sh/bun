import { Options, Packed, makeSettings, makeNarrow, asWider, laterOf } from "./shapes.ts";

const keys = ["tag", "more", "host", "port", "always", "computed", "method", "missing", "toString", "__proto__", "constructor", "7"];
const mark = Symbol("mark");

function readAll(o) {
  const read = [];
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < keys.length; i++) {
      const value = o[keys[i]];
      read.push(typeof value === "function" || (typeof value === "object" && value) ? typeof value : String(value));
    }
    read.push(String(o[mark]));
  }
  return read.join();
}

function storeAll(o, value) {
  const refused = [];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === "__proto__" || keys[i] === "host" || keys[i] === "port" || keys[i] === "method") continue;
    try {
      o[keys[i]] = value;
    } catch (error) {
      refused.push(keys[i] + ":" + error.constructor.name);
    }
  }
  o[mark] = value;
  return refused.join();
}

const makers = {
  Options: () => new Options(),
  Packed: () => new Packed(),
  record: () => makeSettings(1),
  bare: () => Object.create(null),
  plain: () => ({}),
};

export function run() {
  for (const maker in makers) {
    for (let round = 0; round < 4; round++) {
      const o = makers[maker]();
      console.log(maker, round, "empty", readAll(o));
      o.tag = 1;
      o[keys[1]] = 2;
      console.log(maker, round, "two more", readAll(o));
      for (let i = 0; i < 20; i++) {
        o[keys[0]] = i;
        o[keys[1]] = i + 1;
      }
      console.log(maker, round, "replaced", readAll(o), Object.keys(o).join());
      console.log(maker, round, "stored to all", storeAll(o, round), readAll(o), Reflect.ownKeys(o).map(String).join());
      delete o[keys[0]];
      console.log(maker, round, "one deleted", readAll(o));
      o[keys[0]] = "again";
      console.log(maker, round, "given again", readAll(o), Object.keys(o).join());
      Object.defineProperty(o, keys[1], { get() { return "from a getter"; }, set(value) { this.caught = value; }, configurable: true, enumerable: true });
      o[keys[1]] = "to the setter";
      console.log(maker, round, "an accessor", readAll(o), o.caught);
      Object.defineProperty(o, keys[0], { value: "fixed", writable: false, configurable: true, enumerable: true });
      let refused = "stored";
      try {
        o[keys[0]] = "not stored";
      } catch (error) {
        refused = error.constructor.name;
      }
      console.log(maker, round, "read only", refused, readAll(o));
    }
  }

  for (let round = 0; round < 3; round++) {
    const frozen = new Options();
    frozen[keys[0]] = 1;
    for (let i = 0; i < 5; i++) frozen[keys[0]] = i;
    Object.freeze(frozen);
    let refused = "stored";
    try {
      frozen[keys[0]] = 9;
    } catch (error) {
      refused = error.constructor.name;
    }
    console.log("frozen", refused, frozen[keys[0]]);
  }

  const later = "later";
  for (let round = 0; round < 3; round++) {
    const o = makeNarrow(round);
    o[later] = 1;
    for (let i = 0; i < 5; i++) o[later] = o[later] + 1;
    const wider = asWider(o);
    console.log("cast", laterOf(wider), wider[later]);
    wider[later] = 50;
    console.log("stored under the key behind the cast", laterOf(wider), wider[later], Object.keys(wider).join());
  }
}
