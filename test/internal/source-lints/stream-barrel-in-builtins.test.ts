import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// `require("node:stream")` evaluates internal/stream.ts, the barrel: operators, compose, pipeline, Duplex, Transform,
// PassThrough, and everything those load. A built-in module that needs one stream class requires that class from
// internal/streams/* (the barrel re-exports the same objects, so `instanceof` holds), or requires the barrel inside
// the function that needs it. process.stdout, process.stderr, node:zlib and node:http once paid the whole barrel at
// load (oven-sh/bun#48005).
//
// Known: the modules that are node:stream (stream.ts, _stream_wrap.ts, stream.promises.ts), and the requires that sit
// inside a function and run on first use.
test("built-in modules do not require the node:stream barrel at load", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const barrel = /\brequire\("(?:node:stream|internal\/stream)"\)/;

  const known = new Map([
    ["src/js/node/_stream_wrap.ts", 1],
    ["src/js/node/stream.promises.ts", 1],
    ["src/js/node/stream.ts", 1],
    // Inside a function, on first use.
    ["src/js/node/test.ts", 1],
    ["src/js/node/v8.ts", 1],
    ["src/js/thirdparty/node-fetch.ts", 3],
    ["src/js/thirdparty/ws.ts", 1],
  ]);

  const found = new Map<string, number>();
  let scanned = 0;
  for await (const rel of new Glob("**/*.{ts,js}").scan({ cwd: path.join(repoRoot, "src/js") })) {
    const file = path.join("src/js", rel).replaceAll("\\", "/");
    if (file.endsWith(".d.ts")) continue;
    scanned++;
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
    const count = lines.filter(line => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && barrel.test(line)).length;
    if (count > 0) found.set(file, count);
  }
  expect(scanned).toBeGreaterThan(100);
  expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...known].sort()));
});
