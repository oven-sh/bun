import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The close record of an Http2Stream is its Closed bit and its reset code. recordClose() writes both and returns
// false for a stream that is closed already, so the first closer decides the code and close(), _destroy, the native
// handlers and the session teardown cannot disagree about it. A second writer brings back the bug this guards
// against: close(code) emitted 'aborted', a listener destroyed the stream there (stream.pipeline() does), and
// _destroy put a code of its own on the wire.
test("node:http2 writes the close record of a stream in recordClose() only", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  // Line comments go, newlines stay.
  const code = readFileSync(path.join(repoRoot, "src/js/node/http2.ts"), "utf8").replace(/\/\/.*$/gm, "");

  const recordClose = code.match(/^function recordClose\(.*\n(?:.*\n)*?\}\n/m);
  if (!recordClose) throw new Error("recordClose() is not in src/js/node/http2.ts: this lint checks nothing");
  const from = recordClose.index!;
  const to = from + recordClose[0].length;
  const writers = (pattern: RegExp) =>
    [...code.matchAll(pattern)].map(match =>
      match.index >= from && match.index < to ? "recordClose" : `line ${code.slice(0, match.index).split("\n").length}`,
    );

  expect({
    // An assignment to the status field whose value has the Closed bit.
    closedBit: writers(/\[bunHTTP2StreamStatus\]\s*\|?=(?!=)[^;]*\bStreamState\.Closed\b/g),
    // An assignment to the code slot. The class field declaration (`[kRstCode]: number = 0`) is not one.
    code: writers(/\[kRstCode\]\s*(?:[-+*/%&|^]|<<|>>>?|\*\*|\?\?|&&|\|\|)?=(?!=)/g),
  }).toEqual({ closedBit: ["recordClose"], code: ["recordClose"] });
});
