// A name on which a method is called that only strings have is probably a string, and an index handed to such a method is probably a number.
// Whatever they really are, the program does what the language says: every function here is run on strings and on everything else.
const lines = [];
function show(name, run) {
  let text;
  try {
    const value = run();
    text = typeof value + " " + (typeof value === "object" ? JSON.stringify(value) : String(value));
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(name + ": " + text);
}

function pathOf(url) {
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code === 63 || code === 35) break;
  }
  return url.slice(start, i);
}
function valueOf(url, key) {
  let at = url.indexOf("?", 8);
  if (at === -1) return undefined;
  if (!url.startsWith(key, at + 1)) at = url.indexOf("&" + key, at + 1);
  const after = url.charCodeAt(at + key.length + 1);
  return after === 61 ? url.slice(at + key.length + 2) : "";
}
function ofProperty(holder) {
  const text = holder.text;
  return text.toUpperCase() + text.length + text[0] + text.at(-1) + text.includes("b") + text.lastIndexOf("b") + text.concat("!", 1);
}
function letters(text) {
  let all = "";
  for (const letter of text) all += letter + "|";
  return text.toLowerCase() + all;
}
function compared(text) {
  return text === "abc" ? "same" : text.trim();
}
function nested(holder) {
  return holder.name.toLowerCase();
}
function codeAt(text, index) {
  return text.charCodeAt(index);
}
function cut(either, from, to) {
  return either.slice(from, to);
}
function found(either, what, from) {
  return either.indexOf(what, from);
}
function padded(text, width) {
  return text.padStart(width, "*");
}
function pushedAndSplit(either) {
  either.push("pushed");
  return either.split(",");
}
function multipliedAndTrimmed(either) {
  return either * 2 + either.trim();
}
function calledAndRead(either) {
  return either(1) + either.trim;
}
function storedLater(first) {
  let text = first;
  const before = text.charAt(0);
  text = [before, "second"];
  return text.slice(1).length + before;
}

const impostor = {
  charCodeAt: index => index * 2,
  charAt: () => "mine",
  length: 3,
  toLowerCase: () => "mine",
  toUpperCase: () => "MINE",
  startsWith: () => true,
  trim: () => "trimmed",
  indexOf: () => 1,
  lastIndexOf: () => 7,
  includes: () => "perhaps",
  slice: (from, to) => "slice " + from + " " + to,
  at: () => "at",
  concat: () => "concat",
  0: "z",
  2: "y",
  [Symbol.iterator]: function* () {
    yield "it";
  },
};
const values = () => [
  "abc", "", "a", " padded ", "http://host:3000/a/b?x=1&limit=25#f", "é中😀", "x".repeat(3) + "y", "left" + String(lines.length) + "right", new String("abc"), ["a", "b", "c"], [], { length: 2, 0: "a", 1: "b" }, impostor,
  new Uint8Array([97, 98]), 5, 5.5, NaN, null, undefined, true, 10n, Symbol.iterator, () => "f", new Map(),
];
const table = { pathOf, letters, compared, storedLater, pushedAndSplit, multipliedAndTrimmed, calledAndRead };
const reach = (from, name) => from[name.split("").join("")];
for (let round = 0; round < 3; round++) {
  for (const name of Object.keys(table)) for (const value of values()) show(name, () => reach(table, name)(value));
  for (const value of values()) {
    show("valueOf", () => valueOf(value, "limit"));
    show("valueOf key", () => valueOf("http://host:3000/a?limit=25", value));
    show("ofProperty", () => ofProperty({ text: value }));
    show("nested", () => nested({ name: value }));
  }
}
const indexed = { codeAt, cut, found, padded };
for (const index of [0, 1, 2, 3, -1, 1.5, -0, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1, "1", "x", null, undefined, true, 1n, {}, { valueOf() { return 2; } }, Symbol.iterator]) {
  show("codeAt", () => reach(indexed, "codeAt")("abc", index));
  show("cut", () => reach(indexed, "cut")("abcdef", index, 4));
  show("cut to", () => reach(indexed, "cut")("abcdef", 1, index));
  show("cut array", () => reach(indexed, "cut")([1, 2, 3, 4], index, 3));
  show("found", () => reach(indexed, "found")("abcabc", "b", index));
  show("found array", () => reach(indexed, "found")([1, 2, 1, 2], 2, index));
  show("padded", () => reach(indexed, "padded")("ab", index));
}
console.log(lines.join("\n"));
