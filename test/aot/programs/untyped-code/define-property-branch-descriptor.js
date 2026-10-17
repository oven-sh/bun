// Object.defineProperty() whose descriptor is a literal on one branch and another value on the other branch, as in TypeScript's __createBinding and __exportStar.
const lines = [];
const show = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ":" + ("value" in d ? "v" + String(d.value) : (d.get ? "g" + d.get.call(o) : "-") + (d.set ? "s" : "")) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" ");
var __createBinding = Object.create ? function (o, m, k, k2) {
  if (k2 === undefined) k2 = k;
  var desc = Object.getOwnPropertyDescriptor(m, k);
  if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
    desc = { enumerable: true, get: function () { return m[k]; } };
  }
  Object.defineProperty(o, k2, desc);
} : function (o, m, k, k2) { if (k2 === undefined) k2 = k; o[k2] = m[k]; };
var __exportStar = function (m, exports) { for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p); };
const plain = { a: 1, b: "two", default: "no" };
const marked = Object.defineProperty({ get live() { return plain.a * 10; }, c: 3 }, "__esModule", { value: true });
const unmarked = { get live() { return plain.a * 100; } };
const fixed = Object.freeze({ f: "fixed" });
const out = { b: "kept" };
__exportStar(plain, out); __exportStar(marked, out); __exportStar(fixed, out);
lines.push(show(out));
plain.a = 7; lines.push(show(out));
const other = {}; __createBinding(other, unmarked, "live"); __createBinding(other, plain, "a", "renamed"); __createBinding(other, plain, "missing"); __createBinding(other, fixed, "f", "g");
lines.push(show(other));
function either(target, key, given) { let d; if (given) d = given; else d = { value: key + "!", writable: true }; Object.defineProperty(target, key, d); return target; }
lines.push(show(either(either({}, "x"), "y", { get() { return "got"; }, configurable: true })));
function returned(target, key, flag) { const d = flag ? { value: 1, enumerable: true } : { value: 2, configurable: true }; return Object.defineProperty(target, key, d) === target; }
const both = {}; lines.push(returned(both, "p", true) + " " + returned(both, "q", false) + " " + show(both));
function seenAgain(target, key, flag) { let d = null; if (flag) d = { value: "lit", enumerable: true }; else d = Object.getOwnPropertyDescriptor(plain, "b"); Object.defineProperty(target, key, d); d.value = "changed later"; return d.value + " " + target[key]; }
lines.push(seenAgain({}, "k", true) + " | " + seenAgain({}, "k", false));
function throwing(target, flag) { let d; if (flag) d = { value: 1, get() { return 2; } }; else d = 5; try { Object.defineProperty(target, "t", d); return "defined"; } catch (e) { return e.constructor.name; } }
lines.push(throwing({}, true) + " " + throwing({}, false) + " " + throwing(Object.freeze({}), true));
function outsideTry(target, flag) { let d; try { d = flag ? { value: "in", enumerable: true } : JSON.parse('{"value":"parsed"}'); } catch (e) { d = { value: "caught" }; } Object.defineProperty(target, "o", d); return show(target); }
lines.push(outsideTry({}, true) + " " + outsideTry({}, false));
function order(target) { const seen = []; let d; if (seen.push("test") && target) d = { get value() { seen.push("read value"); return 1; } }; else d = { value: 0 }; Object.defineProperty((seen.push("target"), target), (seen.push("key"), "k"), d); return seen.join(); }
lines.push(order({}));
function keyIsJoined(target, flag) { let k, d; if (flag) { k = "first"; d = { value: 1, enumerable: true }; } else { k = "second"; d = { value: 2, enumerable: true }; } Object.defineProperty(target, k, d); return target; }
lines.push(show(keyIsJoined(keyIsJoined({}, true), false)));
let total = 0; for (let i = 0; i < 3000; i++) { const t = {}; __createBinding(t, i & 1 ? plain : marked, i & 1 ? "a" : "live"); total += t.a ?? t.live; } lines.push(String(total));
console.log(lines.join("\n"));
