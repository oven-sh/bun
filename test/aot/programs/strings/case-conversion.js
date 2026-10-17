"use strict";
// toLowerCase() and toUpperCase() of short and long texts, again and again, with collections in between:
// the result is a string like any other, whatever the engine remembers of earlier results.
const log = [];
const names = ["Content-Type", "content-type", "CONTENT-TYPE", "X", "x", "", "ETag", "a1B2c3", "Zoë", "ÀÉÎ", "straße", "İstanbul", "ǅ", "ΣΣ", "A".repeat(63), "A".repeat(64), "A".repeat(65), "Ab".repeat(500), "KK", "𐐀"];
function describe(text) {
  return text.length + ":" + Array.from(text.slice(0, 12), c => c.codePointAt(0).toString(16)).join(".");
}
for (const name of names) log.push(describe(name) + " | " + describe(name.toLowerCase()) + " | " + describe(name.toUpperCase()));

// The result is used as a key, as a part of a longer text, and compared.
const seen = new Set();
for (let i = 0; i < 3000; i++) {
  const headers = { __proto__: null };
  for (const name of names) headers[name.toLowerCase()] = (headers[name.toLowerCase()] || 0) + 1;
  const upper = {};
  for (const name of names) upper[name.toUpperCase()] = name.toLowerCase() === name ? "same" : name.toLowerCase() + "!";
  seen.add(Object.keys(headers).length + " " + headers["content-type"] + " " + Object.keys(upper).length + " " + upper["CONTENT-TYPE"] + " " + upper.ETAG);
}
log.push([...seen].join("\n"));

// Texts that are made anew every time: of parts, of slices, of numbers.
let count = 0;
const map = new Map();
for (let i = 0; i < 20000; i++) {
  const made = "Key-" + (i % 700) + (i & 1 ? "-A" : "-b");
  const lower = made.toLowerCase();
  map.set(lower, (map.get(lower) || 0) + 1);
  if (("xx" + made).slice(2).toLowerCase() === lower && lower.toUpperCase() === made.toUpperCase()) count++;
}
log.push(count + " " + map.size + " " + map.get("key-3-a") + " " + map.get("key-4-b"));

// Garbage between two conversions of the same text.
let kept = "Content-Type".toLowerCase();
for (let round = 0; round < 40; round++) {
  const garbage = [];
  for (let i = 0; i < 20000; i++) garbage.push({ i, text: "t" + i });
  const again = "Content-Type".toLowerCase();
  if (again !== kept || again.length !== 12) log.push("differs in round " + round);
  kept = round & 1 ? again : kept;
}
log.push(kept);

// Objects that are no strings, and the receiver's conversion.
log.push(String.prototype.toLowerCase.call(12.5) + " " + String.prototype.toLowerCase.call({ toString() { return "FROM-AN-OBJECT"; } }) + " " + String.prototype.toUpperCase.call(true) + " " + String.prototype.toLowerCase.call(["A", "B"]));
for (const nothing of [undefined, null]) {
  try {
    String.prototype.toLowerCase.call(nothing);
    log.push("no error");
  } catch (error) {
    log.push(error.constructor.name);
  }
}
console.log(log.join("\n"));
