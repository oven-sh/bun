// Prints one deterministic line per Buffer.prototype.fill() argument shape.
// buffer.test.js runs this fixture under both Node.js and Bun and requires
// the two outputs to be byte-identical.
// https://github.com/oven-sh/bun/pull/33033
"use strict";

const cases = [
  // value is NOT a string: Node never reinterprets a string offset/end as the encoding.
  ['fill(0, "1", 3)', b => b.fill(0, "1", 3)],
  ['fill(0, 1, "3")', b => b.fill(0, 1, "3")],
  ['fill(0, "hex")', b => b.fill(0, "hex")],
  ['fill(0, "bogus")', b => b.fill(0, "bogus")],
  ['fill(true, "1", 3)', b => b.fill(true, "1", 3)],
  ['fill(uint8, "1", 3)', b => b.fill(new Uint8Array([1]), "1", 3)],
  ['fill(uint8, 1, "3")', b => b.fill(new Uint8Array([1]), 1, "3")],
  ["fill(0, null, 3)", b => b.fill(0, null, 3)],
  ["fill(0, 1, null)", b => b.fill(0, 1, null)],

  // `end` is never read (or validated) when `offset` is undefined.
  ['fill(0, undefined, "3")', b => b.fill(0, undefined, "3")],
  ["fill(0, undefined, 3)", b => b.fill(0, undefined, 3)],
  ["fill(0, undefined, null)", b => b.fill(0, undefined, null)],
  ["fill(0, undefined, -1)", b => b.fill(0, undefined, -1)],
  ['fill("b", undefined, 3)', b => b.fill("b", undefined, 3)],

  // fill(string, encoding) has no end slot, so anything there is discarded.
  ['fill("b", "utf8", 3)', b => b.fill("b", "utf8", 3)],

  // An undefined offset also takes the encoding slot in Node, shadowing an
  // explicit 4th-argument encoding. A numeric offset keeps it.
  ['fill("ab", undefined, undefined, "utf16le")', b => b.fill("ab", undefined, undefined, "utf16le")],
  ['fill("a", undefined, undefined, "bogus")', b => b.fill("a", undefined, undefined, "bogus")],
  ['fill("ab", 0, undefined, "utf16le")', b => b.fill("ab", 0, undefined, "utf16le")],
  ['fill("a", 1, undefined, "bogus")', b => b.fill("a", 1, undefined, "bogus")],

  // A null or empty-string encoding is the same as an absent one: Node's
  // normalizeEncoding returns utf8 for undefined, null, and "".
  ['fill("a", 1, 3, null)', b => b.fill("a", 1, 3, null)],
  ['fill("a", undefined, undefined, null)', b => b.fill("a", undefined, undefined, null)],
  ['fill("a", 1, 3, "")', b => b.fill("a", 1, 3, "")],
  ['fill("a", "")', b => b.fill("a", "")],
  ['fill("a", 1, "")', b => b.fill("a", 1, "")],

  // No arguments: Node routes an undefined value into the numeric path (0).
  ["fill()", b => b.fill()],
  ["fill(undefined)", b => b.fill(undefined)],

  // Positional arguments past the fourth are ignored.
  ['fill(0, 1, 3, "utf8", "x")', b => b.fill(0, 1, 3, "utf8", "x")],
  ['fill("b", 1, 3, "utf8", "x")', b => b.fill("b", 1, 3, "utf8", "x")],
  ['fill("ab", 0, 4, "utf16le", "x")', b => b.fill("ab", 0, 4, "utf16le", "x")],

  // Shapes that already agreed, pinned so a regression in either direction shows up.
  ["fill(0)", b => b.fill(0)],
  ["fill(0, 1)", b => b.fill(0, 1)],
  ["fill(0, 1, 3)", b => b.fill(0, 1, 3)],
  ["fill(0, 1.5, 3)", b => b.fill(0, 1.5, 3)],
  ["fill(0, -1, 3)", b => b.fill(0, -1, 3)],
  ["fill(0, 1, 99)", b => b.fill(0, 1, 99)],
  ["fill(0, NaN, 3)", b => b.fill(0, NaN, 3)],
  ['fill(0, 1, 3, "bogus")', b => b.fill(0, 1, 3, "bogus")],
  ['fill("b")', b => b.fill("b")],
  ['fill("b", "utf8")', b => b.fill("b", "utf8")],
  ['fill("b", 1)', b => b.fill("b", 1)],
  ['fill("b", 1, 3)', b => b.fill("b", 1, 3)],
  ['fill("b", 1, "utf8")', b => b.fill("b", 1, "utf8")],
  ['fill("b", 1, 3, "utf8")', b => b.fill("b", 1, 3, "utf8")],
  ['fill("b", "1", 3)', b => b.fill("b", "1", 3)],
  ['fill("b", 1, "3")', b => b.fill("b", 1, "3")],
  ['fill("b", "bogus")', b => b.fill("b", "bogus")],
  ['fill("b", -1)', b => b.fill("b", -1)],
  ['fill("abc", "hex")', b => b.fill("abc", "hex")],
];

const lines = [];
for (const [name, run] of cases) {
  const buf = Buffer.alloc(5, 0xaa);
  let result;
  try {
    run(buf);
    result = "ok     " + buf.toString("hex");
  } catch (err) {
    // Only the class and code are printed: Node rewords messages far more
    // often than it changes codes, and the exact messages are pinned
    // separately in buffer.test.js.
    result = "throws " + err.name + " " + err.code;
  }
  lines.push(name.padEnd(44) + " " + result);
}
process.stdout.write(lines.join("\n") + "\n");
