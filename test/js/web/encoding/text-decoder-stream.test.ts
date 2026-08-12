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

  test("encoding attribute is stable after close/abort/cancel", async () => {
    for (const terminate of [
      (s: TextDecoderStream) => s.writable.getWriter().close(),
      (s: TextDecoderStream) => s.writable.getWriter().abort(),
      (s: TextDecoderStream) => s.readable.getReader().cancel(),
    ]) {
      const s = new TextDecoderStream("utf-16le");
      expect(s.encoding).toBe("utf-16le");
      await terminate(s);
      expect(s.encoding).toBe("utf-16le");
      expect(s.fatal).toBe(false);
    }
  });

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

  // https://encoding.spec.whatwg.org/#dom-textdecoderstream: same label rules
  // as TextDecoder, including the `replacement` rejection.
  test("constructing with a replacement-encoding label should throw", () => {
    expect(() => {
      new TextDecoderStream("replacement");
    }).toThrow(RangeError);
  });

  test("legacy single-byte encodings decode through the stream", async () => {
    // "Привет" in ISO-8859-5, split mid-word.
    const input = readableStreamFromArray([new Uint8Array([0xbf, 0xe0, 0xd8]), new Uint8Array([0xd2, 0xd5, 0xe2])]);
    const output = input.pipeThrough(new TextDecoderStream("iso-8859-5"));
    expect((await Bun.readableStreamToArray(output)).join("")).toBe("Привет");
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

// Web IDL: `new TextDecoderStream(label, options)` treats undefined/null options as {}.
test("TextDecoderStream accepts undefined and null options", () => {
  for (const options of [undefined, null]) {
    const stream = new TextDecoderStream("utf-8", options);
    expect(stream.fatal).toBe(false);
    expect(stream.ignoreBOM).toBe(false);
  }
  expect(new TextDecoderStream("utf-8", { fatal: true }).fatal).toBe(true);
});

// utf-8 non-fatal fast path (shared with Body.textStream()): a leading BOM is
// stripped by default, preserved with ignoreBOM, and maximal-subpart
// replacement matches TextDecoder.
test("utf-8 fast path: BOM stripping matches ignoreBOM", async () => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
  for (const [ignoreBOM, expected] of [
    [false, "A"],
    [true, "\uFEFFA"],
  ] as const) {
    const out = await Bun.readableStreamToArray(
      readableStreamFromArray([bom]).pipeThrough(new TextDecoderStream("utf-8", { ignoreBOM })),
    );
    expect(out.join("")).toBe(expected);
  }
});

test("utf-8 fast path: malformed-sequence replacement matches TextDecoder", async () => {
  // Overlong / surrogate-range sequences: each byte is its own maximal subpart.
  const cases: Array<[number[], string]> = [
    [[0xf0, 0x8f, 0x92], "\uFFFD\uFFFD\uFFFD"],
    [[0xe0, 0x80], "\uFFFD\uFFFD"],
    [[0xf0, 0x9f, 0x41], "\uFFFDA"],
  ];
  for (const [bytes, expected] of cases) {
    const td = new TextDecoder("utf-8");
    expect(td.decode(new Uint8Array(bytes))).toBe(expected);
    const out = await Bun.readableStreamToArray(
      readableStreamFromArray([new Uint8Array(bytes)]).pipeThrough(new TextDecoderStream()),
    );
    expect(out.join("")).toBe(expected);
  }
});

test("utf-8 fast path: a split BOM across chunks is stripped", async () => {
  const out = await Bun.readableStreamToArray(
    readableStreamFromArray([new Uint8Array([0xef]), new Uint8Array([0xbb, 0xbf, 0x42])]).pipeThrough(
      new TextDecoderStream(),
    ),
  );
  expect(out.join("")).toBe("B");
});

// fatal:true takes the Rust TextDecoder path (not the fast path).
test("utf-8 fatal: split valid sequence across chunks decodes", async () => {
  const out = await Bun.readableStreamToArray(
    readableStreamFromArray([new Uint8Array([0xf0, 0x9f]), new Uint8Array([0x92, 0x99])]).pipeThrough(
      new TextDecoderStream("utf-8", { fatal: true }),
    ),
  );
  expect(out.join("")).toBe("\u{1F499}");
});

test("utf-8 fatal: truncated sequence rejects at flush", async () => {
  const out = readableStreamFromArray([new Uint8Array([0xf0, 0x9f, 0x92])]).pipeThrough(
    new TextDecoderStream("utf-8", { fatal: true }),
  );
  await expect(Bun.readableStreamToArray(out)).rejects.toBeInstanceOf(TypeError);
});

// The transform/flush arm runs the native decoder directly, so monkeypatching
// TextDecoder.prototype.decode no longer reaches it.
test("TextDecoderStream does not call a patched TextDecoder.prototype.decode", async () => {
  const original = TextDecoder.prototype.decode;
  let called = false;
  try {
    TextDecoder.prototype.decode = function (...args) {
      called = true;
      return original.apply(this, args);
    };
    const stream = new TextDecoderStream();
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    reader.read();
    await writer.write(new Uint8Array([120]));
    await writer.close();
    expect(called).toBe(false);
  } finally {
    TextDecoder.prototype.decode = original;
  }
});
