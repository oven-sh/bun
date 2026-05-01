// META: global=window,worker
// META: script=resources/readable-stream-from-array.js
// META: script=resources/readable-stream-to-array.js

// https://github.com/WebKit/WebKit/blob/443e796d1538654c34f2690e39600c70c8052b63/LayoutTests/imported/w3c/web-platform-tests/encoding/streams/encode-bad-chunks.any.js#L5

import { expect, test } from "bun:test";
import { readableStreamFromArray } from "harness";

const error1 = new Error("error1");
error1.name = "error1";

test("a chunk that cannot be converted to a string should error the streams", () => {
  const ts = new TextEncoderStream();
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  const writePromise = writer.write({
    toString() {
      throw error1;
    },
  });
  const readPromise = reader.read();
  expect(async () => {
    await readPromise;
  }).toThrow(error1);
  expect(async () => {
    await writePromise;
  }).toThrow(error1);
  expect(async () => {
    await reader.closed;
  }).toThrow(error1);
  expect(async () => {
    await writer.closed;
  }).toThrow(error1);
});

const oddInputs = [
  {
    name: "undefined",
    value: undefined,
    expected: "undefined",
  },
  {
    name: "null",
    value: null,
    expected: "null",
  },
  {
    name: "numeric",
    value: 3.14,
    expected: "3.14",
  },
  {
    name: "object",
    value: {},
    expected: "[object Object]",
  },
  {
    name: "array",
    value: ["hi"],
    expected: "hi",
  },
];

for (const input of oddInputs) {
  test(`input of type ${input.name} should be converted correctly to string`, async () => {
    const outputReadable = readableStreamFromArray([input.value])
      .pipeThrough(new TextEncoderStream())
      .pipeThrough(new TextDecoderStream());
    const output = await Bun.readableStreamToArray(outputReadable);
    expect(output.length, "output should contain one chunk").toBe(1);
    expect(output[0], "output should be correct").toBe(input.expected);
  });
}
