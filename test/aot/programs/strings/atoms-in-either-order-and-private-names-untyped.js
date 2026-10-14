// A string that is both a property name and a constant in the source, and an equal string built at run time, are one key and equal strings whichever is interned first (the same program without type annotations).
class Keeps {
  #hidden = 1;
  hidden = 2;
  static has(o) {
    return #hidden in o;
  }
  get() {
    return this.#hidden;
  }
  set(v) {
    this.#hidden = v;
  }
}

class Other {
  #hidden = 3;
  static has(o) {
    return #hidden in o;
  }
  get() {
    return this.#hidden;
  }
}
const print = (s) => console.log(s);
function show(x) {
  if (typeof x !== "string")
    return Object.is(x, -0) ? "-0" : String(x);
  let out = '"';
  for (let i = 0;i < x.length; i++) {
    const c = x.charCodeAt(i);
    out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 65536).toString(16).slice(1);
  }
  return out + '"';
}
function attempt(f) {
  try {
    return show(f());
  } catch (e) {
    return "throws " + e.name;
  }
}
function cat(a, b) {
  return a + b;
}
function cat3(a, b, c) {
  return `${a}${b}${c}`;
}
function part(s, from, to) {
  return s.slice(from, to);
}
function flattened(s) {
  s.charCodeAt(0);
  return s;
}
const unseen = (f) => new Function("f", "return (...a) => f(...a)")(f);
const made = (...parts) => parts.map((p) => String.fromCharCode(...[...p].map((c) => c.charCodeAt(0)))).join("");
export function equalOutside(a, b) {
  return a === b;
}
export function equalInLoop(a, b) {
  let n = 0;
  for (let i = 0;i < 3; i++)
    if (a === b)
      n++;
  return n;
}
export function isAlpha(a) {
  return (a === "madeFirstAlpha") + "," + (a === "constantFirstAlpha") + "," + (a === "madeFirstAlpha");
}
export function which(a) {
  switch (a) {
    case "madeFirstAlpha":
      return 1;
    case "madeFirstBeta":
      return 2;
    case "constantFirstAlpha":
      return 3;
    case "constantFirstBeta":
      return 4;
    default:
      return 0;
  }
}
export function readFirst(o) {
  return o.madeFirstAlpha + o.madeFirstBeta;
}
export function readLater(o) {
  return o.constantFirstAlpha + o.constantFirstBeta;
}
export function readByKey(o, k) {
  return o[k];
}
export function hasKey(o, k) {
  return k in o;
}
function look(label, constants, computed, typed, read) {
  const parsed = JSON.parse("{" + computed.map((k, i) => JSON.stringify(k) + ":" + (i ? '"p"' : "7")).join() + "}");
  const byKey = {};
  computed.forEach((k, i) => {
    byKey[k] = i ? "k" : 5;
  });
  const map = new Map;
  const set = new Set;
  constants.forEach((c, i) => {
    map.set(c, i);
    set.add(c);
  });
  computed.forEach((k, i) => {
    map.set(k, i + 10);
    set.add(k);
  });
  const out = [];
  for (let i = 0;i < constants.length; i++) {
    const c = constants[i], k = computed[i], own = Object.keys(parsed)[i], ownTyped = Object.keys(typed)[i];
    for (const [x, y] of [[c, k], [k, c], [c, own], [own, k], [c, ownTyped], [ownTyped, own]])
      out.push(unseen(equalOutside)(x, y), unseen(equalInLoop)(x, y), equalOutside(x, y), x == y, Object.is(x, y));
    out.push(unseen(isAlpha)(k), unseen(which)(k), unseen(which)(own), unseen(which)(c));
    for (const o of [parsed, byKey, typed])
      out.push(unseen(readByKey)(o, c), unseen(readByKey)(o, k), unseen(readByKey)(o, own), unseen(hasKey)(o, c), unseen(hasKey)(o, k), Object.hasOwn(o, c), Object.hasOwn(o, k));
  }
  out.push(unseen(read)(typed), unseen(read)(parsed), unseen(read)(byKey), map.size, set.size, [...map.values()].join("/"), Object.keys({ ...parsed, ...typed, ...byKey }).length);
  print(label + ": " + out.join());
}
const early = [made("made", "First", "Alpha"), made("madeFirst", "Beta")];
const warm = {};
for (const k of early)
  warm[k] = 1;
JSON.parse('{"madeFirstAlpha":1,"madeFirstBeta":2}');
function firstConstants() {
  return ["madeFirstAlpha", "madeFirstBeta"];
}
function firstObject() {
  return { madeFirstAlpha: 1, madeFirstBeta: "t" };
}
look("made first", unseen(firstConstants)(), early, unseen(firstObject)(), readFirst);
function laterConstants() {
  return ["constantFirstAlpha", "constantFirstBeta"];
}
function laterObject() {
  return { constantFirstAlpha: 1, constantFirstBeta: "t" };
}
const constants = unseen(laterConstants)();
const object = unseen(laterObject)();
look("constant first", constants, [made("constant", "FirstAlpha"), made("constantFirst", "Beta")], object, readLater);
const keeps = new Keeps;
const other = new Other;
keeps.set(5);
const seen = [];
const proxy = new Proxy(keeps, { has(t, k) {
  seen.push("has " + String(k));
  return k in t;
}, get(t, k, r) {
  seen.push("get " + String(k));
  return Reflect.get(t, k, t);
}, ownKeys(t) {
  seen.push("ownKeys");
  return Reflect.ownKeys(t);
} });
print([
  Object.keys(keeps),
  JSON.stringify(keeps),
  Reflect.ownKeys(keeps).length,
  Object.getOwnPropertyNames(keeps),
  Object.getOwnPropertySymbols(keeps).length,
  Keeps.has(keeps),
  Keeps.has(other),
  Other.has(other),
  Other.has(keeps),
  keeps.get(),
  other.get(),
  "hidden" in keeps,
  "#hidden" in keeps,
  Reflect.ownKeys(keeps).some((k) => String(k).includes("#")),
  Object.keys({ ...keeps }),
  attempt(() => Keeps.prototype.get.call(other)),
  attempt(() => proxy.hidden),
  attempt(() => proxy.get()),
  Object.keys(proxy),
  seen.join("/")
].join(" | "));
for (const k in keeps)
  print("for in: " + k);
globalThis.kept = [equalOutside, equalInLoop, isAlpha, which, readFirst, readLater, readByKey, hasKey];
console.log("number");
