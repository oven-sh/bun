import { expect, it } from "bun:test";
import { StringDecoder } from "string_decoder";

it("StringDecoder-utf8", () => {
  test("utf-8", Buffer.from("$", "utf-8"), "$");
  test("utf-8", Buffer.from("¢", "utf-8"), "¢");
  test("utf-8", Buffer.from("€", "utf-8"), "€");
  test("utf-8", Buffer.from("𤭢", "utf-8"), "𤭢");
  // A mixed ascii and non-ascii string
  // Test stolen from deps/v8/test/cctest/test-strings.cc
  // U+02E4 -> CB A4
  // U+0064 -> 64
  // U+12E4 -> E1 8B A4
  // U+0030 -> 30
  // U+3045 -> E3 81 85
  test(
    "utf-8",
    Buffer.from([0xcb, 0xa4, 0x64, 0xe1, 0x8b, 0xa4, 0x30, 0xe3, 0x81, 0x85]),
    "\u02e4\u0064\u12e4\u0030\u3045"
  );
});

it("StringDecoder-ucs-2", () => {
  test("ucs2", Buffer.from("ababc", "ucs2"), "ababc");
});

it("StringDecoder-utf16le", () => {
  test("utf16le", Buffer.from("3DD84DDC", "hex"), "\ud83d\udc4d");
});

it("StringDecoder-utf8-additional", () => {
  let decoder = new StringDecoder("utf8");
  expect(decoder.write(Buffer.from("E18B", "hex"))).toBe("");
  expect(decoder.end()).toBe("\ufffd");

  decoder = new StringDecoder("utf8");
  expect(decoder.write(Buffer.from("\ufffd"))).toBe("\ufffd");
  expect(decoder.end()).toBe("");

  decoder = new StringDecoder("utf8");
  expect(decoder.write(Buffer.from("\ufffd\ufffd\ufffd"))).toBe(
    "\ufffd\ufffd\ufffd"
  );
  expect(decoder.end()).toBe("");

  decoder = new StringDecoder("utf8");
  expect(decoder.write(Buffer.from("EFBFBDE2", "hex"))).toBe("\ufffd");
  expect(decoder.end()).toBe("\ufffd");

  decoder = new StringDecoder("utf8");
  expect(decoder.write(Buffer.from("F1", "hex"))).toBe("");
  expect(decoder.write(Buffer.from("41F2", "hex"))).toBe("\ufffdA");
  expect(decoder.end()).toBe("\ufffd");

  // Additional utf8Text test
  decoder = new StringDecoder("utf8");
  expect(decoder.text(Buffer.from([0x41]), 2)).toBe("");
});

it("StringDecoder-utf16le-additional", () => {
  // Additional UTF-16LE surrogate pair tests
  let decoder = new StringDecoder("utf16le");
  expect(decoder.write(Buffer.from("3DD8", "hex"))).toBe("");
  expect(decoder.write(Buffer.from("4D", "hex"))).toBe("");
  expect(decoder.write(Buffer.from("DC", "hex"))).toBe("\ud83d\udc4d");
  expect(decoder.end()).toBe("");

  decoder = new StringDecoder("utf16le");
  expect(decoder.write(Buffer.from("3DD8", "hex"))).toBe("");
  expect(decoder.end()).toBe("\ud83d");

  decoder = new StringDecoder("utf16le");
  expect(decoder.write(Buffer.from("3DD8", "hex"))).toBe("");
  expect(decoder.write(Buffer.from("4D", "hex"))).toBe("");
  expect(decoder.end()).toBe("\ud83d");

  decoder = new StringDecoder("utf16le");
  expect(decoder.write(Buffer.from("3DD84D", "hex"))).toBe("\ud83d");
  expect(decoder.end()).toBe("");
});

// Test verifies that StringDecoder will correctly decode the given input
// buffer with the given encoding to the expected output. It will attempt all
// possible ways to write() the input buffer, see writeSequences(). The
// singleSequence allows for easy debugging of a specific sequence which is
// useful in case of test failures.
function test(encoding, input, expected, singleSequence) {
  let sequences;
  if (!singleSequence) {
    sequences = writeSequences(input.length);
  } else {
    sequences = [singleSequence];
  }
  sequences.forEach((sequence) => {
    const decoder = new StringDecoder(encoding);
    let output = "";
    sequence.forEach((write) => {
      output += decoder.write(input.slice(write[0], write[1]));
    });
    output += decoder.end();
    expect(output).toBe(expected);
  });
}

// writeSequences returns an array of arrays that describes all possible ways a
// buffer of the given length could be split up and passed to sequential write
// calls.
//
// e.G. writeSequences(3) will return: [
//   [ [ 0, 3 ] ],
//   [ [ 0, 2 ], [ 2, 3 ] ],
//   [ [ 0, 1 ], [ 1, 3 ] ],
//   [ [ 0, 1 ], [ 1, 2 ], [ 2, 3 ] ]
// ]
function writeSequences(length, start, sequence) {
  if (start === undefined) {
    start = 0;
    sequence = [];
  } else if (start === length) {
    return [sequence];
  }
  let sequences = [];
  for (let end = length; end > start; end--) {
    const subSequence = sequence.concat([[start, end]]);
    const subSequences = writeSequences(length, end, subSequence, sequences);
    sequences = sequences.concat(subSequences);
  }
  return sequences;
}
