import { describe, expect, test } from "bun:test";
import fs from "node:fs";

// ERR_INVALID_ARG_VALUE renders a string value the way util.inspect does (Node's strEscape in
// lib/internal/util/inspect.js). Every builder of that message shares one renderer in
// src/jsc/bindings/ErrorCode.cpp; the entry points below reach it from C++, from the JS builtins'
// $ERR_INVALID_ARG_VALUE, and from Rust's inspect_for_error_message. The expected strings are
// what node v26.3.0 prints for the same calls.
const cases: [input: string, rendered: string][] = [
  ["plain", "'plain'"],
  ["it's", `"it's"`],
  ["a'\"b", "`a'\"b`"],
  ["a'\"`b", "'a\\'\"`b'"],
  ["a'\"${b}", "'a\\'\"${b}'"],
  ["a\x1b\0b", "'a\\x1B\\x00b'"],
  ["\x0b\x0e\x0f\x1a\x1f\x7f", "'\\x0B\\x0E\\x0F\\x1A\\x1F\\x7F'"],
  ["\x8a\x9f\x80", "'\\x8A\\x9F\\x80'"],
  ["tab\there\nnl\\bs", "'tab\\there\\nnl\\\\bs'"],
  // Non-latin1 content makes JSC store the string as UTF-16, which is a separate code path.
  ["a\x1b\u4e2d", "'a\\x1B\u4e2d'"],
  ["it's \u4e2d", `"it's \u4e2d"`],
  ["a'\"\u4e2d", "`a'\"\u4e2d`"],
  ["a'\"${\u4e2d}", "'a\\'\"${\u4e2d}'"],
  ["\ud800x", "'\\ud800x'"],
  ["x\udc00", "'x\\udc00'"],
  ["\udc00\ud800", "'\\udc00\\ud800'"],
  ["\ud83d\ude00", "'\ud83d\ude00'"],
  ["\ud800\ud83d\ude00", "'\\ud800\ud83d\ude00'"],
  ["it's \ud800", `"it's \\ud800"`],
];

function receivedValue(fn: () => unknown): string {
  let error: any;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error?.code).toBe("ERR_INVALID_ARG_VALUE");
  const marker = ". Received ";
  const message: string = error.message;
  expect(message).toContain(marker);
  return message.slice(message.indexOf(marker) + marker.length);
}

describe("ERR_INVALID_ARG_VALUE quotes and escapes a string value like util.inspect", () => {
  test("Bun::ERR::INVALID_ARG_VALUE (Buffer#fill)", () => {
    const rendered = cases.map(([input]) => receivedValue(() => Buffer.alloc(4).fill(input, "hex")));
    expect(rendered).toEqual(cases.map(([, expected]) => expected));
  });

  test("inspect_for_error_message (fs.openSync flags)", () => {
    const rendered = cases.map(([input]) => receivedValue(() => fs.openSync(import.meta.path, input)));
    expect(rendered).toEqual(cases.map(([, expected]) => expected));
  });

  test("$ERR_INVALID_ARG_VALUE (fs.cpSync path with a null byte)", () => {
    const prefix = "The argument 'src' must be a string, Uint8Array, or URL without null bytes. Received ";
    const messages = ["a'\"\0b", "a\x1b\0b", "a'\"`\0"].map(src => {
      let error: any;
      try {
        fs.cpSync(src, "never-created");
      } catch (e) {
        error = e;
      }
      return `${error?.code}: ${error?.message}`;
    });
    expect(messages).toEqual([
      "ERR_INVALID_ARG_VALUE: " + prefix + "`a'\"\\x00b`",
      "ERR_INVALID_ARG_VALUE: " + prefix + "'a\\x1B\\x00b'",
      "ERR_INVALID_ARG_VALUE: " + prefix + "'a\\'\"`\\x00'",
    ]);
  });
});
