import { describe, expect, it } from "bun:test";
import { withoutAggressiveGC } from "harness";

const RealStringDecoder = require("string_decoder").StringDecoder;

it("require('string_decoder')", async () => {
  expect((await import("string_decoder")).StringDecoder).toBe(RealStringDecoder);
});

it("Bun.inspect(StringDecoder)", async () => {
  expect((await Bun.inspect(RealStringDecoder).length) > 0).toBe(true);
});

function FakeStringDecoderCall() {
  RealStringDecoder.apply(this, arguments);
}
require("util").inherits(FakeStringDecoderCall, RealStringDecoder);

// extending StringDecoder is not supported
for (const StringDecoder of [FakeStringDecoderCall, RealStringDecoder]) {
  describe(StringDecoder.name, () => {
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
        "\u02e4\u0064\u12e4\u0030\u3045",
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
      expect(decoder.write(Buffer.from("\ufffd\ufffd\ufffd"))).toBe("\ufffd\ufffd\ufffd");
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
      withoutAggressiveGC(() => {
        let sequences;
        if (!singleSequence) {
          sequences = writeSequences(input.length);
        } else {
          sequences = [singleSequence];
        }
        sequences.forEach(sequence => {
          const decoder = new StringDecoder(encoding);
          let output = "";
          sequence.forEach(write => {
            output += decoder.write(input.slice(write[0], write[1]));
          });
          output += decoder.end();
          expect(output).toBe(expected);
        });
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

    describe("StringDecoder.end", () => {
      const encodings = ["base64", "base64url", "hex", "utf8", "utf16le", "ucs2"];

      const bufs = ["☃💩", "asdf"].map(b => Buffer.from(b));

      // Also test just arbitrary bytes from 0-15.
      for (let i = 1; i <= 16; i++) {
        const bytes = "."
          .repeat(i - 1)
          .split(".")
          .map((_, j) => j + 0x78);
        bufs.push(Buffer.from(bytes));
      }

      encodings.forEach(testEncoding);

      testEnd("utf8", Buffer.of(0xe2), Buffer.of(0x61), "\uFFFDa");
      testEnd("utf8", Buffer.of(0xe2), Buffer.of(0x82), "\uFFFD\uFFFD");
      testEnd("utf8", Buffer.of(0xe2), Buffer.of(0xe2), "\uFFFD\uFFFD");
      testEnd("utf8", Buffer.of(0xe2, 0x82), Buffer.of(0x61), "\uFFFDa");
      testEnd("utf8", Buffer.of(0xe2, 0x82), Buffer.of(0xac), "\uFFFD\uFFFD");
      testEnd("utf8", Buffer.of(0xe2, 0x82), Buffer.of(0xe2), "\uFFFD\uFFFD");
      testEnd("utf8", Buffer.of(0xe2, 0x82, 0xac), Buffer.of(0x61), "€a");

      testEnd("utf16le", Buffer.of(0x3d), Buffer.of(0x61, 0x00), "a");
      testEnd("utf16le", Buffer.of(0x3d), Buffer.of(0xd8, 0x4d, 0xdc), "\u4DD8");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8), Buffer.of(), "\uD83D");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8), Buffer.of(0x61, 0x00), "\uD83Da");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8), Buffer.of(0x4d, 0xdc), "\uD83D\uDC4D");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8, 0x4d), Buffer.of(), "\uD83D");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8, 0x4d), Buffer.of(0x61, 0x00), "\uD83Da");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8, 0x4d), Buffer.of(0xdc), "\uD83D");
      testEnd("utf16le", Buffer.of(0x3d, 0xd8, 0x4d, 0xdc), Buffer.of(0x61, 0x00), "👍a");

      testEnd("base64", Buffer.of(0x61), Buffer.of(), "YQ==");
      testEnd("base64", Buffer.of(0x61), Buffer.of(0x61), "YQ==YQ==");
      testEnd("base64", Buffer.of(0x61, 0x61), Buffer.of(), "YWE=");
      testEnd("base64", Buffer.of(0x61, 0x61), Buffer.of(0x61), "YWE=YQ==");
      testEnd("base64", Buffer.of(0x61, 0x61, 0x61), Buffer.of(), "YWFh");
      testEnd("base64", Buffer.of(0x61, 0x61, 0x61), Buffer.of(0x61), "YWFhYQ==");

      testEnd("base64url", Buffer.of(0x61), Buffer.of(), "YQ");
      testEnd("base64url", Buffer.of(0x61), Buffer.of(0x61), "YQYQ");
      testEnd("base64url", Buffer.of(0x61, 0x61), Buffer.of(), "YWE");
      testEnd("base64url", Buffer.of(0x61, 0x61), Buffer.of(0x61), "YWEYQ");
      testEnd("base64url", Buffer.of(0x61, 0x61, 0x61), Buffer.of(), "YWFh");
      testEnd("base64url", Buffer.of(0x61, 0x61, 0x61), Buffer.of(0x61), "YWFhYQ");

      function testEncoding(encoding) {
        it(encoding + " testbuf", () => {
          bufs.forEach(buf => {
            testBuf(encoding, buf);
          });
        });
      }

      function testBuf(encoding, buf) {
        // Write one byte at a time.
        let s = new StringDecoder(encoding);
        let res1 = "";
        for (let i = 0; i < buf.length; i++) {
          res1 += s.write(buf.slice(i, i + 1));
        }
        res1 += s.end();

        // Write the whole buffer at once.
        let res2 = "";
        s = new StringDecoder(encoding);
        res2 += s.write(buf);
        res2 += s.end();

        // .toString() on the buffer
        const res3 = buf.toString(encoding);

        // One byte at a time should match toString
        expect(res1).toEqual(res3);
        // All bytes at once should match toString
        expect(res2).toEqual(res3);
      }

      function testEnd(encoding, incomplete, next, expected) {
        it(`${encoding} partial ${JSON.stringify(expected)}`, () => {
          let res = "";
          const s = new StringDecoder(encoding);
          res += s.write(incomplete);
          res += s.end();
          res += s.write(next);
          res += s.end();

          expect(res).toEqual(expected);
        });
      }
    });
  });
}

it("invalid utf-8 input, pr #3562", () => {
  const decoder = new RealStringDecoder("utf-8");
  let output = "";
  output += decoder.write(Buffer.from("B9", "hex"));
  output += decoder.write(Buffer.from("A9", "hex"));
  output += decoder.end();
  expect(output).toStrictEqual("\uFFFD\uFFFD");
});

it("decoding latin1, issue #3738", () => {
  const decoder = new RealStringDecoder("latin1");
  let output = "";
  output += decoder.write(Buffer.from("DD", "hex"));
  output += decoder.write(Buffer.from("59", "hex"));
  output += decoder.write(Buffer.from("DE", "hex"));
  output += decoder.end();
  expect(output).toStrictEqual("ÝYÞ");
});
