import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// The public send() of a native socket takes the frame type from the JS type of its argument: a string is a text
// frame, bytes and a Blob are a binary frame. npm ws takes it from `options.binary`, so that
// `send(buffer, { binary: false })` is a text frame. The two socket classes of src/js/thirdparty/ws.js choose the
// frame type as npm ws does and hand it, with the payload, to the frame entry of their native socket. A send(),
// sendText() or sendBinary() call on a native socket there frames by type again.
test("the socket classes of the ws module send data frames through the frame entries only", () => {
  const file = "src/js/thirdparty/ws.js";
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  // Line comments go, line numbers stay.
  const lines = readFileSync(path.join(repoRoot, file), "utf8")
    .split("\n")
    .map(line => line.replace(/\/\/.*$/, ""));

  const framedByType: string[] = [];
  let frameEntryCalls = 0;
  for (const name of ["BunWebSocket", "BunWebSocketMocked"]) {
    const start = lines.indexOf(`class ${name} extends EventEmitter {`);
    if (start === -1) {
      framedByType.push(`${file}: class ${name} not found`);
      continue;
    }
    // A top-level class ends at the first line that is a lone closing brace.
    for (let i = start + 1; i < lines.length && lines[i].trimEnd() !== "}"; i++) {
      // `this.send()` is the send() of the class, which goes through the frame entry. Any other receiver in
      // these classes is a native socket.
      if (/(?<!\bthis)\.(?:send|sendText|sendBinary)\s*\(/.test(lines[i])) {
        framedByType.push(`${file}:${i + 1}: ${lines[i].trim()}`);
      }
      frameEntryCalls += lines[i].match(/\bsend(?:Server|Client)Frame\s*\(/g)?.length ?? 0;
    }
  }

  expect(framedByType).toEqual([]);
  // The classes call their frame entries in three places. None at all means that the sends moved and this lint
  // checks nothing.
  expect(frameEntryCalls).toBeGreaterThanOrEqual(3);
});
