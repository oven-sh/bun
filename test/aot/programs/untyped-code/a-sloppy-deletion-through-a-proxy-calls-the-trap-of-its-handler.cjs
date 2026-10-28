// As a-deletion-through-a-proxy-calls-the-trap-of-its-handler.js, in sloppy code: a deletion that is refused answers false.
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message.replace(/ \(evaluating .*$/, ""); } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function " + held.name : typeof held === "symbol" ? String(held) : held);
function say(label, value) { console.log(label + ": " + shown(value) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const symbol = Symbol("s");
const targets = () => ({
  "plain": { alpha: 1, beta: 2, [symbol]: 3, 0: "zero" }, "empty": {}, "frozen": Object.freeze({ alpha: 1 }), "sealed": Object.seal({ alpha: 1 }), "closed": Object.preventExtensions({ alpha: 1 }),
  "a fixed property": Object.defineProperty({ beta: 2 }, "alpha", { value: 1 }), "a fixed getter": Object.defineProperty({}, "alpha", { get() { return 1; } }), "a getter": { get alpha() { return 1; } },
  "above": Object.create({ alpha: 1 }), "a list": [1, 2], "a function": function alpha() { }, "a class": class { static alpha = 1; }, "a map": new Map, "a proxy": new Proxy({ alpha: 1 }, {}),
  "a proxy that logs": new Proxy({ alpha: 1 }, { deleteProperty(target, key) { log.push("inner " + String(key)); return Reflect.deleteProperty(target, key); } }),
});
const handlers = () => ({
  "none": {}, "hands on": { deleteProperty(target, key) { log.push("trap " + String(key)); return Reflect.deleteProperty(target, key); } },
  "yes": { deleteProperty() { return true; } }, "no": { deleteProperty() { return false; } }, "one": { deleteProperty() { return 1; } }, "zero": { deleteProperty() { return 0; } }, "a text": { deleteProperty() { return "x"; } }, "nothing": { deleteProperty() { } },
  "throws": { deleteProperty() { throw new RangeError("thrown by the trap"); } }, "undefined": { deleteProperty: undefined }, "null": { deleteProperty: null }, "a number": { deleteProperty: 5 }, "an object": { deleteProperty: {} },
  "of a class": new class { deleteProperty(target, key) { log.push("class " + String(key)); return delete target[key]; } }, "above": Object.create({ deleteProperty(target, key) { log.push("above " + String(key)); return true; } }),
  "a proxy": new Proxy({ deleteProperty() { return true; } }, {}), "other traps": { get() { return 1; }, has() { return true; } },
});
function byName(from) { return delete from.alpha; }
function byKey(from, key) { return delete from[key]; }
function inCondition(from) { if (delete from.alpha) return "deleted"; return "kept"; }
const left = target => told(() => Reflect.ownKeys(target).map(String).join());
for (let round = 0; round < 2; round++) {
  for (const nameOfHandler of Object.keys(handlers()))
    say(nameOfHandler, Object.keys(targets()).map(nameOfTarget => {
      const inSight = told(() => { const target = targets()[nameOfTarget], proxy = new Proxy(target, handlers()[nameOfHandler]); return [delete proxy.alpha, left(target)].join(" "); });
      const elsewhere = told(() => { const target = targets()[nameOfTarget]; return [byName(new Proxy(target, handlers()[nameOfHandler])), left(target)].join(" "); });
      return inSight === elsewhere ? inSight : inSight + " BUT ELSEWHERE " + elsewhere;
    }));
  say("keys", ["alpha", "gamma", symbol, Symbol.iterator, 0, 1, "0", -1, 1.5, null, undefined, true, {}, { toString() { log.push("toString"); return "beta"; } }, ["alpha"]].map(key => told(() => { const target = targets().plain, proxy = new Proxy(target, handlers()["hands on"]); return [delete proxy[key], byKey(new Proxy(target, handlers()["hands on"]), key), left(target)].join(" "); })));
  say("a key that throws", told(() => delete new Proxy({}, handlers().yes)[{ toString() { throw new RangeError("no key"); } }]));
  say("lists", [0, 1, 5, "length", "0"].map(key => told(() => { const list = [1, 2, 3]; return [byKey(new Proxy(list, handlers()["hands on"]), key), byKey(new Proxy(list, {}), key), list.length, Object.keys(list).join()].join(" "); })));
  say("in a condition", ["none", "yes", "no", "hands on"].map(name => told(() => inCondition(new Proxy({ alpha: 1 }, handlers()[name])))));
  say("what is no proxy in the same places", [{ alpha: 1 }, Object.freeze({ alpha: 1 }), [1], 5, "text", null, undefined, () => 1].map(from => told(() => [byName(from), byKey(from, "alpha"), byKey(from, 0)].join())));
  say("a trap that comes and goes", (() => { const handler = {}, target = { alpha: 1 }, proxy = new Proxy(target, handler), said = []; for (let turn = 0; turn < 6; turn++) { target.alpha = turn; if (turn === 2) handler.deleteProperty = (held, key) => { log.push("late " + key); return true; }; if (turn === 4) delete handler.deleteProperty; said.push(byName(proxy), "alpha" in target); } return said; })());
  say("a target that is closed later", (() => { const target = { alpha: 1 }, proxy = new Proxy(target, handlers().yes); const said = [told(() => byName(proxy))]; Object.preventExtensions(target); said.push(told(() => byName(proxy))); delete target.alpha; said.push(told(() => byName(proxy))); return said; })());
  say("revoked", told(() => { const made = Proxy.revocable({ alpha: 1 }, {}); made.revoke(); return byName(made.proxy); }));
  say("revoked by the trap", told(() => { const made = Proxy.revocable({ alpha: 1 }, { deleteProperty(target, key) { made.revoke(); return delete target[key]; } }); return [byName(made.proxy), told(() => byName(made.proxy))]; }));
  say("what the trap is handed", (() => { const target = { alpha: 1 }, handler = { deleteProperty(...given) { log.push(given.length, given[0] === target, typeof given[1], this === handler); return true; } }; const proxy = new Proxy(target, handler); return [delete proxy.alpha, delete proxy[symbol], delete proxy[7]]; })());
  say("undefined or a proxy", [{ alpha: 1 }, undefined].map(target => told(() => { let held; try { held = new Proxy(target, handlers().yes); } catch { } return delete held.alpha; })));
}
const counted = { deletions: 0 }, often = new Proxy({ alpha: 1 }, { deleteProperty(target, key) { counted.deletions++; return delete target[key]; } }), bare = new Proxy({ alpha: 1 }, {});
let sum = 0;
for (let i = 0; i < 40000; i++) { if (byName(often)) sum++; if (byKey(often, "beta")) sum++; if (byName(bare)) sum++; if (delete often.gamma) sum++; }
console.log(sum, counted.deletions);
