// `k in o` followed by `o[k]`, with o and k of unknown type. Where nothing lies between that can touch a property the test may hand the read what it found. Here: own, inherited and absent properties, getters, undefined as a value, proxies (the order of their traps), arrays and indices, symbols, ropes, dictionaries, objects that are not objects; a store, a delete or a call between the two; a test that is skipped on some turns of a loop while the read is not; a key or an object that changes between turns.
const lines = [];
const say = (...words) => lines.push(words.map(String).join(" "));
const rope = (a, b) => a + b;
const symbol = Symbol("s");
const parent = { inherited: "from the parent", get computed() { return "by the parent's getter"; } };
const plain = Object.assign(Object.create(parent), { a: 1, b: undefined, c: null, d: 0, e: "", [symbol]: "by symbol", 7: "seven" });
Object.defineProperty(plain, "own getter", { get() { say("  the getter runs"); return "got"; }, enumerable: true, configurable: true });
Object.defineProperty(plain, "hidden", { value: "not enumerable", enumerable: false });
const keys = ["a", "b", "c", "d", "e", "f", symbol, 7, "7", "inherited", "computed", "own getter", "hidden", "toString", "__proto__", rope("inher", "ited"), rope("", "a"), 1.5, null, undefined, Symbol("other")];
const orElse = (o, k, d) => (k in o ? o[k] : d);
const inTwoSteps = (o, k) => {
  const has = k in o;
  const value = has ? o[k] : "missing";
  return has + ":" + String(value);
};
const underIf = (o, k) => {
  if (k in o) return o[k];
  return "none";
};
for (let round = 0; round < 3; round++) {
  say("orElse", keys.map(k => String(orElse(plain, k, "-"))).join(" | "));
  say("inTwoSteps", keys.map(k => inTwoSteps(plain, k)).join(" | "));
  say("underIf", keys.map(k => String(underIf(plain, k))).join(" | "));
}
const log = [];
const proxy = new Proxy({ x: 1 }, { has(t, k) { log.push("has " + String(k)); return k in t || k === "claimed"; }, get(t, k) { log.push("get " + String(k)); return k === "claimed" ? "made up" : t[k]; } });
for (let round = 0; round < 3; round++) say("proxy", orElse(proxy, "x", "-"), orElse(proxy, "y", "-"), orElse(proxy, "claimed", "-"), inTwoSteps(proxy, "x"));
say(log.join(", "));
const array = [10, , 30];
array.named = "a name on an array";
say("array", [0, 1, 2, 3, "0", "1", "length", "named", "push", -1].map(k => String(orElse(array, k, "-"))).join(" | "));
say("typed array", [0, 1, 2, "0", "length", "byteLength", "x"].map(k => String(orElse(new Uint8Array([5, 6]), k, "-"))).join(" | "));
for (const notAnObject of [1, "text", null, undefined, true, symbol, 10n]) {
  try { say("no error", orElse(notAnObject, "length", "-")); } catch (e) { say(e.constructor.name, "for", typeof notAnObject); }
}
const storeBetween = (o, k) => { const has = k in o; o[k] = "stored between"; return has ? o[k] : "was absent, now " + o[k]; };
const deleteBetween = (o, k) => { const has = k in o; delete o[k]; return has ? String(o[k]) : "absent"; };
const callBetween = (o, k, f) => { const has = k in o; f(o, k); return has ? String(o[k]) : "absent"; };
const otherStoreBetween = (o, k, other) => { const has = k in o; other.a = "through another name"; return has ? o[k] : "absent"; };
for (let round = 0; round < 3; round++) {
  const o = { a: "first", z: 1 };
  say("between", storeBetween({ a: 1 }, "a"), "|", storeBetween({}, "a"), "|", deleteBetween({ a: 1 }, "a"), "|", callBetween({ a: 1 }, "a", (x, k) => { x[k] = "changed by the call"; }), "|", callBetween({ a: 1 }, "a", (x, k) => { delete x[k]; }), "|", otherStoreBetween(o, "a", o), "|", otherStoreBetween({ a: "kept" }, "a", o));
}
const testedOnSomeTurns = (o, list, isSkipped) => {
  const out = [];
  let has = false;
  for (let i = 0; i < list.length; i++) {
    const k = list[i];
    if (!isSkipped(i)) has = k in o;
    if (has) out.push(String(o[k]));
    else out.push("-");
  }
  return out.join(",");
};
for (let round = 0; round < 3; round++) say("tested on some turns", testedOnSomeTurns(plain, ["a", "d", "f", "a", "inherited", "e", "a", "c"], i => i % 3 === 1), "|", testedOnSomeTurns(plain, ["a", "d", "f", "a"], i => i > 0));
const sameKeyWhileTheObjectChanges = (objects, k) => objects.map(o => (k in o ? o[k] : "-")).join(",");
const sameObjectChangedEveryTurn = (o, k, turns) => {
  const out = [];
  for (let i = 0; i < turns; i++) {
    const value = k in o ? o[k] : "-";
    out.push(value);
    if (i % 2) delete o[k]; else o[k] = i;
  }
  return out.join(",");
};
for (let round = 0; round < 3; round++) say("changing", sameKeyWhileTheObjectChanges([{ a: 1 }, { b: 2 }, { a: 3, b: 4 }, Object.create({ a: 5 }), { a: undefined }, []], "a"), "|", sameObjectChangedEveryTurn({}, "k", 7), "|", sameObjectChangedEveryTurn({ k: "start", other: 1 }, "k", 6));
const dictionary = {};
for (let i = 0; i < 200; i++) dictionary["key" + i] = i;
for (let i = 0; i < 200; i += 2) delete dictionary["key" + i];
say("dictionary", [0, 1, 2, 3, 198, 199, 200].map(i => orElse(dictionary, "key" + i, "-")).join(","));
delete dictionary.key1;
say("dictionary", [0, 1, 2, 3].map(i => orElse(dictionary, "key" + i, "-")).join(","));
const copyKnown = (record, names) => {
  const out = {};
  try {
    for (let index = 0; index < names.length; index++) {
      const name = names[index];
      const has = name === "__proto__" ? Object.prototype.hasOwnProperty.call(record, name) : name in record;
      const value = has ? record[name] : "missing";
      if (has) out[name] = value;
    }
  } catch (error) {
    return String(error);
  }
  return JSON.stringify(out);
};
let total = 0;
for (let round = 0; round < 500; round++) total += copyKnown({ id: round, name: "n" + round, active: round % 2 === 0, score: round / 2 }, ["id", "name", "active", "score", "absent", "__proto__"]).length;
say("copied", total, copyKnown({ id: 1, get name() { return "by a getter"; } }, ["id", "name", "x"]));
console.log(lines.join("\n"));
