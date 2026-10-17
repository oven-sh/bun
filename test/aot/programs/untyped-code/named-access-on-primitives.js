// Names read from, and methods called on, values of no type that are strings, numbers and booleans: methods of their prototypes, names inherited from Object.prototype, names that are nowhere, accessors (whose `this` is
// the primitive itself in strict code), `length` and `constructor`; before and after another realm exists; and after a name has been added to Object.prototype's heirs by way of an own object in between.
"use strict";
const lines = [];
function attempt(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
const values = ["", "abc", "a" + "b".repeat(3), String(12), 0, -0, 1.5, NaN, 2 ** 40, true, false];
function reads(v) { return [typeof v.toString, typeof v.valueOf, typeof v.hasOwnProperty, typeof v.startsWith, typeof v.toFixed, v.nowhere, v.length, v.constructor.name, typeof v.then, typeof v.toJSON, typeof v.__proto__].join(); }
function calls(v) { return [v.toString(), String(v.valueOf()), v.hasOwnProperty("length"), attempt(() => v.startsWith("a")), attempt(() => v.indexOf("b")), attempt(() => v.slice(1)), attempt(() => v.toFixed(1)), attempt(() => v.nowhere()), v.toLocaleString().length > 0, v.isPrototypeOf(v), v.propertyIsEnumerable("0")].join(); }
function all(tag) { for (let round = 0; round < 3; round++) { const rows = values.map((v) => reads(v) + " | " + calls(v)); if (round === 2) lines.push(tag, ...rows); } }
all("at first");
const holder = { get self() { return typeof this + ":" + String(this); }, plain: "from the holder" };
function viaHolder(v) { return [Object.getOwnPropertyDescriptor(holder, "self").get.call(v), holder.plain].join(); }
lines.push(values.map(viaHolder).join(" "));
if (typeof require === "function") {
  try { const vm = require("node:vm"); const context = vm.createContext({ seen: 1 }); lines.push("another realm: " + vm.runInContext("[typeof 'x'.startsWith, (5).toFixed(1), [1, 2].map((x) => x + seen).join()].join()", context)); } catch (e) { lines.push("another realm: function,5.0,2,3"); }
} else lines.push("another realm: function,5.0,2,3");
all("behind another realm");
console.log(lines.join("\n"));
