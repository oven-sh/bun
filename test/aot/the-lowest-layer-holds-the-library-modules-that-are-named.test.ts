import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const how = `const how = (f) => (typeof f !== "function" ? typeof f : /\\[native code\\]/.test(Function.prototype.toString.call(f)) ? "compiled" : "TEXT");`;

test.concurrent("a library module that a test file, a helper, a package or a preload names is compiled", async () => {
  using dir = tempDir("aot-lowest-layer-holds-what-is-named", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": `{}`,
    "bunfig.toml": `[test]\npreload = ["./preload.js"]\n`,
    "preload.js": `import { connect } from "node:tls";\nglobalThis.connect = connect;\n`,
    "node_modules/fake/package.json": `{ "name": "fake", "main": "index.js" }`,
    "node_modules/fake/index.js": `exports.gzipSync = require("zlib").gzipSync;\n`,
    "helpers/hash.js": `import { createHash } from "node:crypto";\nexport { createHash };\n`,
    "named.test.js": `import { test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync } from "fake";
import { createHash } from "./helpers/hash.js";
${how}
test("named", async () => {
  const { parse } = await import("node:querystring");
  console.log("SEEN named | " + [createServer, gzipSync, createHash, parse, require("readline").createInterface, connect].map(how));
  console.log("SEEN unnamed | " + [Bun.sql, process.stdin.on, process.stdout.write].map(how));
});
`,
    "second.test.js": `import { expect, test } from "bun:test";\ntest("second", () => { expect(1).toBe(1); });\n`,
  });
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", "--aot"], String(dir), env);
  expect(stdout.split("\n").filter(line => line.startsWith("SEEN"))).toEqual([
    "SEEN named | compiled,compiled,compiled,compiled,compiled,compiled",
    "SEEN unnamed | compiled,compiled,compiled",
  ]);
  expect(stderr).toContain(" 2 pass");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "a built-in that loads a library module is compiled under a name that is put together too",
  async () => {
    using dir = tempDir("aot-lowest-layer-holds-built-ins", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "tsconfig.json": `{}`,
      "computed.test.js": `import { test } from "bun:test";
${how}
test("computed", () => {
  console.log("SEEN " + how(Bun[["s", "q", "l"].join("")]));
});
`,
      "second.test.js": `import { expect, test } from "bun:test";\ntest("second", () => { expect(1).toBe(1); });\n`,
    });
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", "--aot"], String(dir), env);
    expect(stdout.split("\n").filter(line => line.startsWith("SEEN"))).toEqual(["SEEN compiled"]);
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  },
);
