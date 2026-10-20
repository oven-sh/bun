// Prints one line for each value that is passed as an encoding to buffer.transcode() and to
// new StringDecoder(). Both take the encoding from Node's normalizeEncoding(). buffer.test.js runs
// this fixture under Node.js and under Bun and requires the two outputs to be equal.
"use strict";

const { Buffer, transcode } = require("node:buffer");
const { StringDecoder } = require("node:string_decoder");

// "é" gives different bytes for each of the four encodings of transcode(), as the source encoding
// and as the target encoding. So the result names the encoding that transcode() used.
const source = Buffer.from("é");
const usedAsSource = { c3a9: "utf8", c383c2a9: "latin1", efbfbdefbfbd: "ascii", eaa783: "ucs2" };
const usedAsTarget = { c3a9: "utf8", e9: "latin1", "3f": "ascii", e900: "ucs2" };
const consumers = {
  fromEnc: encoding => usedAsSource[transcode(source, encoding, "utf8").toString("hex")],
  toEnc: encoding => usedAsTarget[transcode(source, "utf8", encoding).toString("hex")],
  StringDecoder: encoding => new StringDecoder(encoding).encoding,
};

// The user code that the consumer ran on the value.
let calls = [];

// An encoding object that records the read of its length and its conversion to a string.
function recorder(length, string, name = "") {
  return {
    get length() {
      calls.push(name + "length");
      if (length instanceof Error) throw length;
      return length;
    },
    toString() {
      calls.push(name + "toString");
      if (string instanceof Error) throw string;
      return string;
    },
  };
}
function withToString(object, string) {
  return Object.assign(object, {
    toString() {
      calls.push("toString");
      return string;
    },
  });
}
function withToPrimitive(object, string) {
  return Object.assign(object, {
    [Symbol.toPrimitive](hint) {
      calls.push("toPrimitive " + hint);
      return string;
    },
  });
}

const names = ["utf8", "utf-8", "ucs2", "ucs-2", "utf16le", "utf-16le", "latin1", "binary", "ascii"];
const otherNames = ["hex", "base64", "base64url", "buffer"];
const sixteenBit = string => Buffer.from(string, "utf16le").toString("utf16le");

const values = [
  ["undefined", () => undefined],
  ["null", () => null],
  ['""', () => ""],

  // Strings. transcode() reads a string that is not a name as a C string, which ends at a NUL.
  ...[
    ...names.flatMap(name => [name, name.toUpperCase()]),
    ...otherNames.flatMap(name => [name, name.toUpperCase()]),
    ...["Utf-8", "Ucs2", "Latin1", "utf16-le", "b", " latin1", "latin1 ", "lat\u0131n1"],
    ...["latin1\0", "utf-16le\0", "ascii\0", "latin1\0xyz", "UTF8\0", "utf-8\0\0", "Ascii\0ucs2", "latin1\0\u0131"],
    ...["\0", "\0latin1", "l\0atin1", "b\0", "hex\0", "buffer\0"],
  ].map(name => [JSON.stringify(name), () => name]),
  ["a 16-bit string of latin1", () => sixteenBit("latin1")],
  ["a 16-bit string of UTF-16LE", () => sixteenBit("UTF-16LE")],

  // Values that are not a string and have no length of a name.
  ["0", () => 0],
  ["6", () => 6],
  ["NaN", () => NaN],
  ["true", () => true],
  ["6n", () => 6n],
  ["{}", () => ({})],
  ["[]", () => []],
  ['[""]', () => [""]],
  ['["latin1"]', () => ["latin1"]],
  ['["l","a","t","i","n","1"]', () => ["l", "a", "t", "i", "n", "1"]],
  ['new String("")', () => new String("")],
  ['new String("b")', () => new String("b")],
  ['Buffer.from("b")', () => Buffer.from("b")],
  ["new Uint8Array(6)", () => new Uint8Array(6)],
  ["function () {}", () => function () {}],
  ['{ toString: "latin1" }', () => withToString({}, "latin1")],
  ['{ toString: "" }', () => withToString({}, "")],
  ['{ toPrimitive: "latin1" }', () => withToPrimitive({}, "latin1")],
  ["{ toString: throws }", () => recorder(undefined, new RangeError("from user code"))],
  ...[
    ["0", 0],
    ["2", 2],
    ["10", 10],
    ["6.5", 6.5],
    ["-0", -0],
    ["NaN", NaN],
    ['"6"', "6"],
    ["6n", 6n],
    ["new Number(6)", new Number(6)],
    ["undefined", undefined],
  ].map(([label, length]) => [`{ length: ${label}, toString: "latin1" }`, () => recorder(length, "latin1")]),

  // Values that are not a string and have the length of a name.
  ...[...names, ...otherNames].map(name => [
    `{ length: ${name.length}, toString: ${JSON.stringify(name)} }`,
    () => recorder(name.length, name),
  ]),
  ['new String("latin1")', () => new String("latin1")],
  ['new String("ucs2")', () => new String("ucs2")],
  ['new String("hex")', () => new String("hex")],
  ['{ length: 6, toString: "LaTiN1" }', () => recorder(6, "LaTiN1")],
  ["{ length: Math.sqrt(36), toString: latin1 }", () => recorder(Math.sqrt(36), "latin1")],
  ["{ length: 6, toString: a 16-bit string of latin1 }", () => recorder(6, sixteenBit("latin1"))],
  ['new String("UTF8")', () => new String("UTF8")],
  ['new (class extends String {})("ascii")', () => new (class extends String {})("ascii")],
  ['Buffer.from("latin1")', () => Buffer.from("latin1")],
  ['Buffer.from("UCS-2")', () => Buffer.from("UCS-2")],
  ['[1, 2, 3, 4] with toString: "ucs2"', () => withToString([1, 2, 3, 4], "ucs2")],
  [
    'function (a, b, c, d, e, f) {} with toString: "binary"',
    () => withToString(function (a, b, c, d, e, f) {}, "binary"),
  ],
  ['{ length: 5, toPrimitive: "ASCII" }', () => withToPrimitive({ length: 5 }, "ASCII")],
  [
    '{ length: 5, toPrimitive: "ASCII", toString: "utf-8" }',
    () => withToString(withToPrimitive({ length: 5 }, "ASCII"), "utf-8"),
  ],
  [
    'a Proxy of new String("latin1")',
    () =>
      new Proxy(new String("latin1"), {
        get(target, key) {
          calls.push("get " + String(key));
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
  ],

  // Values that have the length of a name, and a string that is not a name of that length.
  ...[
    [4, "latin1"],
    [6, "utf8"],
    [3, "latin1"],
    [9, "latin1"],
    [6, " latin1"],
    [6, "latin1\0"],
    [7, "latin1\0"],
    [4, "utf-8"],
  ].map(([length, string]) => [
    `{ length: ${length}, toString: ${JSON.stringify(string)} }`,
    () => recorder(length, string),
  ]),
  ['new String("latin1\\0")', () => new String("latin1\0")],
  ['new String("latin1") with toString: "ascii"', () => withToString(new String("latin1"), "ascii")],
  ["{ length: throws }", () => recorder(new RangeError("from user code"), "latin1")],
  ["{ length: 6, toString: throws }", () => recorder(6, new RangeError("from user code"))],
  ["{ length: 6, toString: a symbol }", () => recorder(6, Symbol("latin1"))],
  ["{ length: 6 } with no prototype", () => Object.assign(Object.create(null), { length: 6 })],

  // Bun cannot put these in the message of StringDecoder's ERR_UNKNOWN_ENCODING, and throws a TypeError.
  ["a symbol", () => Symbol("latin1"), ["fromEnc", "toEnc"]],
  ["a Symbol object", () => Object(Symbol("latin1")), ["fromEnc", "toEnc"]],
  ["an object with no prototype", () => Object.create(null), ["fromEnc", "toEnc"]],
];

// Only the code, or the class of an error with no code, is printed: an engine words its own errors.
function outcomeOf(run) {
  calls = [];
  let outcome;
  try {
    outcome = run();
  } catch (error) {
    outcome = "throws " + (error.code ?? error.name);
  }
  return outcome + (calls.length ? " after " + calls.join(", ") : "");
}

const lines = [];
for (const [label, make, only = Object.keys(consumers)] of values) {
  const outcomes = only.map(consumer => `${consumer}: ${outcomeOf(() => consumers[consumer](make()))}`);
  lines.push(label + " | " + outcomes.join(" | "));
}

// The order in which transcode() reads its arguments.
const order = {
  "fromEnc and toEnc are objects": () =>
    transcode(source, recorder(6, "latin1", "fromEnc."), recorder(4, "ucs2", "toEnc.")),
  "one object is fromEnc and toEnc": () => {
    const encoding = recorder(6, "latin1");
    return transcode(source, encoding, encoding);
  },
  "fromEnc is rejected without a conversion": () =>
    transcode(source, recorder(1, "latin1", "fromEnc."), recorder(4, "ucs2", "toEnc.")),
  "fromEnc is a rejected string": () => transcode(source, "hex", recorder(4, "ucs2", "toEnc.")),
  "fromEnc throws": () =>
    transcode(source, recorder(new RangeError("from user code"), "latin1", "fromEnc."), recorder(4, "ucs2", "toEnc.")),
  "toEnc throws": () =>
    transcode(source, recorder(6, "latin1", "fromEnc."), recorder(4, new RangeError("from user code"), "toEnc.")),
  "a fourth argument": () => transcode(source, "utf8", "latin1", recorder(6, "latin1", "fourth.")),
  "the source is a string": () => transcode("é", recorder(6, "latin1", "fromEnc."), recorder(4, "ucs2", "toEnc.")),
  "the source is empty": () =>
    transcode(new Uint8Array(0), recorder(6, "latin1", "fromEnc."), recorder(4, "ucs2", "toEnc.")),
};
for (const [label, run] of Object.entries(order)) {
  lines.push(label + " | " + outcomeOf(() => run().toString("hex")));
}

console.log(lines.join("\n"));
