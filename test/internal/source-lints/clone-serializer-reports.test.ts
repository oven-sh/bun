import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// CloneSerializer reports a value that cannot be cloned with a SerializationReturnCode. It does not throw the
// DataCloneError itself: SerializedScriptValue::create() maps the code to the DOMException for structuredClone and
// postMessage, and node:v8's serialize() asks for SerializationErrorMode::NonThrowing and throws node's Error. A throw
// inside the walker reaches every caller as a DOMException, whatever the caller asked for.
const serializer = "src/jsc/bindings/webcore/SerializedScriptValue.cpp";
const throwsCloneError = /throwDataCloneError\s*\(|Exception\s*\{\s*DataCloneError\b|ExceptionCode::DataCloneError\b/g;

test("CloneSerializer reports a clone failure and does not throw it", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  // Line comments go, newlines stay.
  const code = readFileSync(path.join(repoRoot, serializer), "utf8").replace(/\/\/.*$/gm, "");
  const start = code.indexOf("\nclass CloneSerializer : ");
  const end = code.indexOf("\nclass CloneDeserializer : ");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const walker = code.slice(start, end);
  // The walker sets the code at more than a dozen places. None at all means it moved and this lint checks nothing.
  expect(walker.match(/SerializationReturnCode::DataCloneError\b/g)?.length ?? 0).toBeGreaterThan(5);
  const firstLine = code.slice(0, start).split("\n").length;
  const violations = Array.from(
    walker.matchAll(throwsCloneError),
    match => `${serializer}:${firstLine + walker.slice(0, match.index).split("\n").length - 1}`,
  );
  expect(violations).toEqual([]);
});
