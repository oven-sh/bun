// Prints one deterministic line per Buffer.prototype.toString(encoding, start, end)
// argument shape. buffer.test.js runs this fixture under both Node.js and Bun and
// requires the two outputs to be identical.
// https://github.com/nodejs/node/blob/v26.3.0/lib/buffer.js#L904-L934
"use strict";

// Throws when it is coerced. The code names the argument, so a line shows which
// argument was coerced first. The objects here use Symbol.toPrimitive because an
// encoding object with valueOf() or toString() is a known difference (#43426).
const throwing = name => ({
  label: `throwing("${name}")`,
  [Symbol.toPrimitive]() {
    throw Object.assign(new Error(name), { code: "COERCED_" + name.toUpperCase() });
  },
});

// Logs its name when it is coerced. Node coerces start and end more than once
// (`start <= 0`, `start >= length`, `MathTrunc(start)`), so only the first
// coercion of each argument is printed.
const logged = (log, name, value) => ({
  [Symbol.toPrimitive]() {
    if (!log.includes(name)) log.push(name);
    return value;
  },
});

const show = value => {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return "Symbol()";
  if (typeof value === "string") return JSON.stringify(value);
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "object" && value !== null) return value.label;
  return String(value);
};

const lines = [];
const record = (name, run) => {
  let result;
  try {
    result = "ok     " + JSON.stringify(run());
  } catch (err) {
    // Only the class and code are printed: the two engines word a TypeError for
    // a BigInt or a Symbol differently.
    result = "throws " + err.name + " " + err.code;
  }
  lines.push(name.padEnd(52) + " " + result);
};

const buffers = [
  ["abc", () => Buffer.from("abc")],
  ["empty", () => Buffer.alloc(0)],
];
// Absent, valid, two values that getEncodingOps rejects, and one that throws.
const encodings = [undefined, "utf8", "bogus", "", throwing("encoding")];
const starts = [undefined, 0, -0, 1, 2.9, 3, -1, NaN, "1", 0n, 1n, 3n, Symbol("start"), throwing("start")];
const ends = [undefined, 0, 1, 2.1, 3, 5, -1, null, 0n, 4n, Symbol("end"), throwing("end")];

for (const [bufferName, makeBuffer] of buffers) {
  for (const encoding of encodings) {
    for (const start of starts) {
      for (const end of ends) {
        record(`${bufferName}.toString(${show(encoding)}, ${show(start)}, ${show(end)})`, () =>
          makeBuffer().toString(encoding, start, end),
        );
      }
    }
  }
}

// Fewer than three arguments, the alias, and a receiver that is not a Buffer. The Uint8Array
// row keeps an empty range: Node before v24 decodes through a method of the receiver
// (`buf.hexSlice`), which a plain Uint8Array does not have.
record('abc.toString("bogus")', () => Buffer.from("abc").toString("bogus"));
record('abc.toString("bogus", 3)', () => Buffer.from("abc").toString("bogus", 3));
record('abc.toString("bogus", 2)', () => Buffer.from("abc").toString("bogus", 2));
record('empty.toString("bogus")', () => Buffer.alloc(0).toString("bogus"));
record('empty.toString(throwing("encoding"))', () => Buffer.alloc(0).toString(throwing("encoding")));
record('abc.toLocaleString("bogus", 1, 1)', () => Buffer.from("abc").toLocaleString("bogus", 1, 1));
record('abc.toLocaleString("bogus", 1, 2)', () => Buffer.from("abc").toLocaleString("bogus", 1, 2));
record('toString.call(uint8, "bogus", 1, 1)', () =>
  Buffer.prototype.toString.call(new Uint8Array([97, 98, 99]), "bogus", 1, 1),
);

// The order of the first coercion of each argument.
for (const [bufferName, makeBuffer] of buffers) {
  for (const [start, end] of [
    [1, 2],
    [1, 1],
    [2, 1],
    [3, 1],
    [0, 0],
    [-1, 5],
    [1n, 2],
    [3n, 2],
  ]) {
    record(`${bufferName} coercion order, start ${show(start)}, end ${show(end)}`, () => {
      const log = [];
      let result;
      try {
        result = makeBuffer().toString(
          logged(log, "encoding", "latin1"),
          logged(log, "start", start),
          logged(log, "end", end),
        );
      } catch (err) {
        result = "throws " + err.name;
      }
      return [result, log.join(",")];
    });
  }
}

console.log(lines.join("\n"));
