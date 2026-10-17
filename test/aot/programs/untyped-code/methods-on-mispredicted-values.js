// Calls of methods whose names let a string, an array or a number be expected, in plain JavaScript, in functions that no loop of the text calls by name; now and then the receiver or an argument is something else.
const asked = {
  lower(value) { return value.toLowerCase(); },
  upper(value) { return value.toUpperCase(); },
  find(value, what) { return value.indexOf(what); },
  findFrom(value, what, from) { return value.indexOf(what, from); },
  cut(value, from, to) { return value.slice(from, to); },
  code(value, at) { return value.charCodeAt(at); },
  starts(value, what) { return value.startsWith(what); },
  trimmed(value) { return value.trim(); },
  parts(value, by) { return value.split(by); },
  joined(value, by) { return value.join(by); },
  pushed(value, what) { return value.push(what); },
  has(value, what) { return value.includes(what); },
  fixed(value, digits) { return value.toFixed(digits); },
  text(value) { return value.toString(); },
  floor(value) { return Math.floor(value); },
  most(a, b) { return Math.max(a, b); },
  isList(value) { return Array.isArray(value); },
};
const attempt = (f, ...given) => { try { const result = f(...given); return typeof result === "string" ? JSON.stringify(result) : Array.isArray(result) ? "[" + result.join("|") + "]" : String(result); } catch (error) { return error.constructor.name; } };
const own = { toLowerCase: () => "own lower", toUpperCase() { return "own upper " + (this === own); }, indexOf: (what, from) => "own " + what + from, slice: () => "own slice", charCodeAt: () => "own code", startsWith: () => "own", trim: () => "own", split: () => ["own"], join: () => "own", push: () => "own", includes: () => "own", toFixed: () => "own", toString: () => "own text" };
const receivers = ["Text/Plain; A=b", "", "É€ ok ", "a" + String(1) + ",b", ["x", "Y", 3], [], 12.5, -0, 7, true, null, undefined, {}, own, Symbol("s"), 10n, new String("Boxed"), Object.create(null)];
for (const receiver of receivers) {
  console.log(attempt(asked.lower, receiver), attempt(asked.upper, receiver), attempt(asked.find, receiver, "a"), attempt(asked.find, receiver, 3), attempt(asked.findFrom, receiver, "/", 2), attempt(asked.findFrom, receiver, "", -1.5), attempt(asked.cut, receiver, 1, -1), attempt(asked.cut, receiver, "1"), attempt(asked.code, receiver, 0), attempt(asked.code, receiver, 99),
    attempt(asked.starts, receiver, "T"), attempt(asked.trimmed, receiver), attempt(asked.parts, receiver, ","), attempt(asked.parts, receiver), attempt(asked.joined, receiver, "-"), attempt(asked.has, receiver, "Y"), attempt(asked.fixed, receiver, 1), attempt(asked.text, receiver), attempt(asked.floor, receiver), attempt(asked.most, receiver, 1), attempt(asked.isList, receiver));
}
const list = [1];
console.log(attempt(asked.pushed, list, 2), list.join(), attempt(asked.pushed, Object.freeze([1]), 2), attempt(asked.pushed, { length: 3, push: Array.prototype.push }, "x"), attempt(asked.starts, "abc", /a/), attempt(asked.fixed, 1.005, 200), attempt(asked.code, "abc", { valueOf: () => 1 }), attempt(asked.cut, "abcdef", { valueOf() { throw new RangeError("no"); } }));
