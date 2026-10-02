import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The public send() of a native socket takes the frame type from the JS type of its argument: a string is a text
// frame, bytes and a Blob are a binary frame. npm ws takes it from `options.binary`, so that
// `send(buffer, { binary: false })` is a text frame. src/js/thirdparty/ws.js chooses the frame type as npm ws does
// and hands it, with the payload, to the frame entry of its native socket. A send(), sendText() or sendBinary()
// call on a native socket there frames by type again.
test("the ws module sends data frames through the frame entries only", () => {
  const file = "src/js/thirdparty/ws.js";
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  // Line comments go, newlines stay.
  const code = readFileSync(path.join(repoRoot, file), "utf8").replace(/\/\/.*$/gm, "");
  const framedByType = [...code.matchAll(/\.(?:send|sendText|sendBinary)\s*\(/g)].map(
    match => `${file}:${code.slice(0, match.index).split("\n").length}`,
  );
  // The module binds two frame entries and calls them in three places. None at all means that the sends moved
  // and this lint checks nothing.
  expect(code.match(/\bsend(?:Server|Client)Frame\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(framedByType).toEqual([]);
});
