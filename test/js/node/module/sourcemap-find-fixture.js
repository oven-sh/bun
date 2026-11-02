// Prints one line for each pair of arguments of SourceMap.prototype.findEntry and findOrigin: the answer and its
// keys, or the class of the error. sourcemap.test.js runs this file with Node.js and with Bun and requires the
// same output.
"use strict";

const { SourceMap } = require("node:module");

// No map here has what Bun reads in another way than Node.js: a four-field segment after a five-field one, or a
// one-field segment that ends the string.
const maps = [
  ["no segment", { names: [], mappings: "" }],
  ["one segment", { names: [], mappings: "AAAA" }],
  ["a line with no segment", { names: [], mappings: "EAAA,IACE;;GCEA" }],
  ["three lines before the first segment", { names: [], mappings: ";;;AAAA,CAAC,CAAC;AAAA" }],
  ["a one-field segment", { names: [], mappings: "AAAA,I,IAAQ;;AAEA" }],
  ["a name in each segment", { names: ["x", "y"], mappings: "AAAAA,IAAQC;;;EAAAD" }],
];

const values = [
  ["0", 0],
  ["1", 1],
  ["2", 2],
  ["3", 3],
  ["6", 6],
  ["99", 99],
  ["-1", -1],
  ["0.5", 0.5],
  ["2.5", 2.5],
  ["-0.5", -0.5],
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["2 ** 31", 2 ** 31],
  ["undefined", undefined],
  ["null", null],
  ["true", true],
  ['"2"', "2"],
  ['"abc"', "abc"],
  ["4n", 4n],
  ["2n ** 70n", 2n ** 70n],
  ["Symbol()", Symbol()],
  ["{ valueOf: () => 2 }", { valueOf: () => 2 }],
];

function answer(find) {
  let found;
  try {
    found = find();
  } catch (error) {
    return "throws " + error.constructor.name;
  }
  const json = JSON.stringify(found, (key, value) => (typeof value === "number" ? String(value) : value));
  return json + " keys: " + Object.keys(found).join(",");
}

const lines = [];
for (const [title, payload] of maps) {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts", "b.ts"], ...payload });
  for (const [lineLabel, line] of values) {
    for (const [columnLabel, column] of values) {
      const position = `${title}: (${lineLabel}, ${columnLabel})`;
      lines.push(`findEntry, ${position}: ${answer(() => sourceMap.findEntry(line, column))}`);
      lines.push(`findOrigin, ${position}: ${answer(() => sourceMap.findOrigin(line, column))}`);
    }
  }
}
console.log(lines.join("\n"));
