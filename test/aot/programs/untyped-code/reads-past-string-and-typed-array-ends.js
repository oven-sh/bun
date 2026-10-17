// Reads `x[i]` where x has no type and is a string or a typed array and i is an integer outside it: past the end, at the end, negative.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function at(x, i) { return x[i]; }
function last(x) { return x[x.length - 1]; }
function next(x, i) { return x[i + 1]; }
const table = { at, last, next };
function around(x) { return [table.at(x, 0), table.last(x), table.at(x, x.length), table.next(x, x.length), table.at(x, -1), table.at(x, -2147483648), table.at(x, 2147483647)]; }

for (let i = 0; i < 60; ++i) {
  table.at("warm", i % 6);
  table.at(new Uint8Array(2), i % 4);
  table.last("");
}
say("a string", around("abc"));
say("the empty string", around(""));
say("one character", around("x"));
say("sixteen bits", around("あい"), around("a\u{1F600}"));
say("joined", around("ab" + String(12)), around(["x", "y"].join("")));
say("cut", around("abcdef".slice(2, 4)), around("abc".substring(3)));
say("a string object", around(new String("ab")), around(Object("")));
{
  const withProperty = new String("ab");
  withProperty[5] = "five";
  withProperty[-1] = "minus one";
  say("a string object with properties", table.at(withProperty, 5), table.at(withProperty, -1), table.at(withProperty, 2));
}
for (const Kind of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array]) {
  const filled = Kind === BigInt64Array ? new Kind([1n, 2n]) : new Kind([1, 2]);
  say(Kind.name, around(filled).map(String), around(new Kind(0)).map(String));
}
{
  class Bytes extends Uint8Array {
    get [5]() { return "never asked"; }
  }
  say("a derived typed array", around(new Bytes(2)), table.at(new Bytes(2), 5));
  const view = new Uint8Array(new ArrayBuffer(8), 2, 3);
  say("a view", around(view));
  const growing = new ArrayBuffer(2, { maxByteLength: 8 });
  const tracking = new Uint8Array(growing);
  say("tracking its buffer", around(tracking), tracking.length);
  growing.resize(4);
  say("grown", around(tracking), tracking.length, table.at(tracking, 3), table.at(tracking, 4));
  growing.resize(0);
  say("shrunk", around(tracking), tracking.length);
  const given = new Uint8Array([1, 2, 3]);
  given.buffer.transfer();
  say("detached", around(given), given.length);
  say("a data view", table.at(new DataView(new ArrayBuffer(2)), 5), table.at(new ArrayBuffer(2), 0));
}
say("other keys", table.at("abc", 1.5), table.at("abc", "1"), table.at("abc", "9"), table.at("abc", -0), table.at(new Uint8Array(2), 1.5), table.at(new Uint8Array(2), "-0"), table.at(new Uint8Array(2), "9"), table.at(new Uint8Array(2), NaN));
{
  let seen = 0;
  const text = "scanned";
  const bytes = new Uint8Array(4);
  const before = count("operationAOTGetByVal");
  for (let i = 0; i < 3000; ++i) {
    if (table.at(text, text.length) === undefined) ++seen;
    if (table.last("") === undefined) ++seen;
    if (table.next(text, text.length) === undefined) ++seen;
    if (table.at(bytes, 4 + (i & 3)) === undefined) ++seen;
    if (table.at(bytes, -1) === undefined) ++seen;
  }
  const asked = count("operationAOTGetByVal") - before;
  say("rounds", seen);
  say(asked <= 200 ? "the reads asked the run time at most 200 times" : "the reads asked the run time " + asked + " times");
}
console.log(lines.join("\n"));
