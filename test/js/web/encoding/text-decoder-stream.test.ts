import { expect, test } from "bun:test";
import { readableStreamFromArray } from "harness";

{
  // META: global=window,worker
  // META: script=resources/readable-stream-from-array.js
  // META: script=resources/readable-stream-to-array.js
  // META: script=/common/sab.js

  // https://github.com/WebKit/WebKit/blob/443e796d1538654c34f2690e39600c70c8052b63/LayoutTests/imported/w3c/web-platform-tests/encoding/streams/decode-utf8.any.js#L5

  [ArrayBuffer, SharedArrayBuffer].forEach(arrayBufferOrSharedArrayBuffer => {
    const inputChunkData = [73, 32, 240, 159, 146, 153, 32, 115, 116, 114, 101, 97, 109, 115];

    const emptyChunk = new Uint8Array(new arrayBufferOrSharedArrayBuffer(0));
    const inputChunk = new Uint8Array(new arrayBufferOrSharedArrayBuffer(inputChunkData.length));

    inputChunk.set(inputChunkData);

    const expectedOutputString = "I \u{1F499} streams";

    test(
      "decoding one UTF-8 chunk should give one output string - " + arrayBufferOrSharedArrayBuffer.name,
      async () => {
        const input = readableStreamFromArray([inputChunk]);
        const output = input.pipeThrough(new TextDecoderStream());
        const array = await Bun.readableStreamToArray(output);
        expect(array, "the output should be in one chunk").toEqual([expectedOutputString]);
      },
    );

    test("decoding an empty chunk should give no output chunks - " + arrayBufferOrSharedArrayBuffer.name, async () => {
      const input = readableStreamFromArray([emptyChunk]);
      const output = input.pipeThrough(new TextDecoderStream());
      const array = await Bun.readableStreamToArray(output);
      expect(array, "no chunks should be output").toEqual([]);
    });

    test("an initial empty chunk should be ignored - " + arrayBufferOrSharedArrayBuffer.name, async () => {
      const input = readableStreamFromArray([emptyChunk, inputChunk]);
      const output = input.pipeThrough(new TextDecoderStream());
      const array = await Bun.readableStreamToArray(output);
      expect(array, "the output should be in one chunk").toEqual([expectedOutputString]);
    });

    test("a trailing empty chunk should be ignored - " + arrayBufferOrSharedArrayBuffer.name, async () => {
      const input = readableStreamFromArray([inputChunk, emptyChunk]);
      const output = input.pipeThrough(new TextDecoderStream());
      const array = await Bun.readableStreamToArray(output);
      expect(array, "the output should be in one chunk").toEqual([expectedOutputString]);
    });

    test("UTF-8 EOF handling - " + arrayBufferOrSharedArrayBuffer.name, async () => {
      const chunk = new Uint8Array(new arrayBufferOrSharedArrayBuffer(3));
      chunk.set([0xf0, 0x9f, 0x92]);
      const input = readableStreamFromArray([chunk]);
      const output = input.pipeThrough(new TextDecoderStream());
      const array = await Bun.readableStreamToArray(output);
      expect(array).toEqual(["\uFFFD"]);
    });
  });

  test("decoding a transferred Uint8Array chunk should give no output", async () => {
    const buffer = new ArrayBuffer(3);
    const view = new Uint8Array(buffer, 1, 1);
    view[0] = 65;
    new MessageChannel().port1.postMessage(buffer, [buffer]);
    const input = readableStreamFromArray([view]);
    const output = input.pipeThrough(new TextDecoderStream());
    const array = await Bun.readableStreamToArray(output);
    expect(array, "no chunks should be output").toEqual([]);
  });

  test("decoding a transferred ArrayBuffer chunk should give no output", async () => {
    const buffer = new ArrayBuffer(1);
    new MessageChannel().port1.postMessage(buffer, [buffer]);
    const input = readableStreamFromArray([buffer]);
    const output = input.pipeThrough(new TextDecoderStream());
    const array = await Bun.readableStreamToArray(output);
    expect(array, "no chunks should be output").toEqual([]);
  });
}

{
  // https://github.com/nodejs/node/blob/926503b66910d9ec895c33c7fd94361fd78dea72/test/fixtures/wpt/encoding/streams/decode-attributes.any.js#L3

  // META: global=window,worker,shadowrealm

  // Verify that constructor arguments are correctly reflected in the attributes.

  // Mapping of the first argument to TextDecoderStream to the expected value of
  // the encoding attribute. We assume that if this subset works correctly, the
  // rest probably work too.
  const labelToName = {
    "unicode-1-1-utf-8": "utf-8",
    // "iso-8859-2": "iso-8859-2",
    "ascii": "windows-1252",
    "utf-16": "utf-16le",
  };

  for (const label of Object.keys(labelToName)) {
    test(`encoding attribute should have correct value for '${label}'`, () => {
      const stream = new TextDecoderStream(label);
      expect(stream.encoding, "encoding should match").toBe(labelToName[label]);
    });
  }

  for (const falseValue of [false, 0, "", undefined, null]) {
    test(`setting fatal to '${falseValue}' should set the attribute to false`, () => {
      const stream = new TextDecoderStream("utf-8", { fatal: falseValue });
      expect(stream.fatal, "fatal should be false").toBeFalse();
    });

    test(`setting ignoreBOM to '${falseValue}' should set the attribute to false`, () => {
      const stream = new TextDecoderStream("utf-8", { ignoreBOM: falseValue });
      expect(stream.ignoreBOM, "ignoreBOM should be false").toBeFalse();
    });
  }

  for (const trueValue of [true, 1, {}, [], "yes"]) {
    test(`setting fatal to '${trueValue}' should set the attribute to true`, () => {
      const stream = new TextDecoderStream("utf-8", { fatal: trueValue });
      expect(stream.fatal, "fatal should be true").toBeTrue();
    });

    test(`setting ignoreBOM to '${trueValue}' should set the attribute to true`, () => {
      const stream = new TextDecoderStream("utf-8", { ignoreBOM: trueValue });
      expect(stream.ignoreBOM, "ignoreBOM should be true").toBeTrue();
    });
  }

  test("constructing with an invalid encoding should throw", () => {
    expect(() => {
      new TextDecoderStream("");
    }).toThrow(RangeError);
  });

  test("constructing with a non-stringifiable encoding should throw", () => {
    expect(() => {
      new TextDecoderStream({
        toString() {
          return {};
        },
      });
    }).toThrow(TypeError);
  });

  test("a throwing fatal member should cause the constructor to throw", () => {
    expect(() => {
      new TextDecoderStream("utf-8", {
        get fatal() {
          throw new Error();
        },
      });
    }).toThrow(Error);
  });

  test("a throwing ignoreBOM member should cause the constructor to throw", () => {
    expect(() => {
      new TextDecoderStream("utf-8", {
        get ignoreBOM() {
          throw new Error();
        },
      });
    }).toThrow(Error);
  });
}
