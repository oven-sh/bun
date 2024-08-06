// META: global=window,worker
// META: script=resources/readable-stream-from-array.js
// META: script=resources/readable-stream-to-array.js
// META: script=/common/sab.js

// https://github.com/WebKit/WebKit/blob/443e796d1538654c34f2690e39600c70c8052b63/LayoutTests/imported/w3c/web-platform-tests/encoding/streams/decode-utf8.any.js#L5

import { test, expect } from "bun:test";
import { readableStreamFromArray } from "harness";

[ArrayBuffer, SharedArrayBuffer].forEach(arrayBufferOrSharedArrayBuffer => {
  const inputChunkData = [73, 32, 240, 159, 146, 153, 32, 115, 116, 114, 101, 97, 109, 115];

  const emptyChunk = new Uint8Array(new arrayBufferOrSharedArrayBuffer(0));
  const inputChunk = new Uint8Array(new arrayBufferOrSharedArrayBuffer(inputChunkData.length));

  inputChunk.set(inputChunkData);

  const expectedOutputString = "I \u{1F499} streams";

  test("decoding one UTF-8 chunk should give one output string - " + arrayBufferOrSharedArrayBuffer.name, async () => {
    const input = readableStreamFromArray([inputChunk]);
    const output = input.pipeThrough(new TextDecoderStream());
    const array = await Bun.readableStreamToArray(output);
    expect(array, "the output should be in one chunk").toEqual([expectedOutputString]);
  });

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
