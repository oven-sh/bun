import { Options, Packed, makeSettings, makeSettingsWithKeys, setHostOf, setPortOf, setPathOf, setSecureOf, makeNarrow, asWider, laterOf } from "./shapes.ts";

let seed = 12345;
function random(below) {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % below;
}

function listings(o) {
  const inLoop = [];
  for (const key in o) inLoop.push(key);
  return [Object.keys(o).join(), inLoop.join(), JSON.stringify(o), Object.keys({ ...o }).join(), Object.entries(o).join(";"), Reflect.ownKeys(o).map(String).join(), Object.getOwnPropertyNames(o).join()].join(" | ");
}

function hashOf(text, hash) {
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash;
}

const names = ["a", "b", "c", "d", "e", "f", "g", "h2", "i", "j", "k", "l"];
const symbols = [Symbol("s0"), Symbol("s1"), Symbol("s2")];
const fields = ["host", "port", "path", "secure"];
const valuesOfFields = { host: "h", port: 1, path: "p", secure: true };

const typedSetters = {
  class: { host: o => o.setHost("h"), port: o => o.setPort(1), path: o => o.setPath("p"), secure: o => o.setSecure(true) },
  record: { host: o => setHostOf(o, "h"), port: o => setPortOf(o, 1), path: o => setPathOf(o, "p"), secure: o => setSecureOf(o, true) },
};

function step(o, kind, said) {
  const what = random(16);
  const name = names[random(names.length)];
  const field = fields[random(fields.length)];
  switch (what) {
    case 0: case 1: case 2: o[name] = said.length; return "add " + name;
    case 3: switch (name) { case "a": o.a = 1; break; case "b": o.b = 1; break; case "c": o.c = 1; break; default: o.d = 1; } return "add by name";
    case 4: case 5: case 6: typedSetters[kind][field](o); return "typed " + field;
    case 7: o[field] = valuesOfFields[field]; return "untyped " + field;
    case 8: case 9: delete o[name]; return "delete " + name;
    case 10: delete o[field]; return "delete " + field;
    case 11: o[symbols[random(3)]] = 1; return "symbol";
    case 12: o[random(5)] = 1; return "index";
    case 13: Object.defineProperty(o, name, { get() { return 7; }, set(value) {}, enumerable: true, configurable: true }); return "accessor " + name;
    case 14: Object.defineProperty(o, name, { value: 8, enumerable: random(2) === 0, configurable: true, writable: true }); return "define " + name;
    default: delete o[symbols[random(3)]]; delete o[random(5)]; return "delete symbol and index";
  }
}

export function run() {
  const makers = [["class", () => new Options()], ["class", () => new Packed()], ["record", () => makeSettings(1)]];
  for (let round = 0; round < 240; round++) {
    const [kind, make] = makers[round % 3];
    const o = make();
    const said = [];
    let hash = 2166136261;
    for (let i = 0; i < 40; i++) {
      said.push(step(o, kind, said));
      hash = hashOf(listings(o), hash);
    }
    console.log(round, (hash >>> 0).toString(16), round % 20 === 0 ? said.join(", ") + " => " + listings(o) : Reflect.ownKeys(o).map(String).join());
  }

  for (const [first, second] of [["x", "y"], ["y", "x"], ["x", "x"], ["y", "id"], ["x", "host"], ["5", "y"], ["x", "7"]]) {
    for (let i = 0; i < 3; i++) {
      const o = makeSettingsWithKeys(first, second);
      const made = listings(o);
      setPortOf(o, 1);
      o.z = 1;
      delete o[first];
      setPathOf(o, "p");
      console.log("literal", first, second, made, "=>", listings(o));
    }
  }

  for (let i = 0; i < 4; i++) {
    const o = makeNarrow(i);
    o.before = 1;
    o.later = 2;
    o.after = 3;
    if (i & 1) o.other = "o";
    o.last = 4;
    const wider = asWider(o);
    console.log("cast", laterOf(wider), listings(wider), wider === o);
    delete wider.before;
    wider.more = 5;
    console.log("cast, then changed", listings(wider));
  }

  const big = new Options();
  for (let i = 0; i < 5000; i++) big["n" + i] = i;
  big.setHost("h");
  for (let i = 0; i < 5000; i += 2) delete big["n" + i];
  big.setPort(1);
  big.tail = 1;
  const keysOfBig = Object.keys(big);
  console.log("big", keysOfBig.length, keysOfBig.slice(0, 4).join(), keysOfBig.slice(-4).join(), keysOfBig.indexOf("host"), keysOfBig.indexOf("port"));
}
