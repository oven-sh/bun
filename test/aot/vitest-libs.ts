// For ./vitest-libs-<part>.test.ts: a way a file.
// While `bun test` loads a test file or a preload that imports "vitest", what it loads for the first time gets no `jest`, `xit`, `xtest` or `xdescribe`.
// So who loads a library first decides what the library sees, and only the run knows who that is.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const seen = `JSON.stringify([typeof jest, typeof xit, typeof xtest, typeof xdescribe, typeof vi, typeof expect])`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p" }`,
  "node_modules/peek/package.json": `{ "name": "peek", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/peek/index.js": `module.exports = () => ${seen};`,
  "node_modules/peek-esm/package.json": `{ "name": "peek-esm", "version": "1.0.0", "type": "module", "main": "index.js" }`,
  "node_modules/peek-esm/index.js": `export default () => ${seen};`,
  "node_modules/uses/package.json": `{ "name": "uses", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/uses/index.js": `
    const message = fn => { try { return String(fn()); } catch (error) { return error.name + ": " + error.message; } };
    exports.read = () => [
      message(() => typeof jest.fn),
      message(() => typeof xit),
      message(() => ({ jest }).jest === jest),
      message(() => typeof jest !== "undefined" && jest !== null ? "has jest" : "has none"),
    ].join(" | ");
  `,
  "helper.ts": `export const inHelper = (): string => typeof jest + " " + typeof xdescribe;\n`,
  "vitest.test.js": `
    import { test } from "vitest";
    import peekEsm from "peek-esm";
    import { inHelper } from "./helper.ts";
    test("test", () => {
      console.log("SEEN vitest", require("peek")(), peekEsm(), inHelper());
      console.log("SEEN vitest", require("uses").read());
    });
  `,
  // A file of its own: where a test deletes \`jest\` nobody knows what the runner hands out, and the build of such a run costs eight times as much.
  "stores.test.js": `
    import { test } from "vitest";
    test("test", () => {
      console.log("SEEN vitest, before", require("uses").read());
      globalThis.jest = { fn() {} };
      try {
        console.log("SEEN vitest, a jest that script puts on globalThis", require("uses").read());
      } finally {
        delete globalThis.jest;
      }
    });
  `,
  "bun.test.js": `
    import { test } from "bun:test";
    import peekEsm from "peek-esm";
    import { inHelper } from "./helper.ts";
    test("test", () => {
      console.log("SEEN bun:test", require("peek")(), peekEsm(), inHelper());
      console.log("SEEN bun:test", require("uses").read());
    });
  `,
  "of-vitest.js": `import { vi } from "vitest"; import "peek"; import "peek-esm";`,
  "of-bun.js": `import { mock } from "bun:test"; import "peek"; import "peek-esm";`,
  "of-neither.js": `import "peek"; import "peek-esm";`,
  "of-vitest-peek.js": `import { vi } from "vitest"; import "peek";`,
  "of-bun-peek-esm.js": `import { mock } from "bun:test"; import "peek-esm";`,
};

const runs: string[][] = [
  ["./vitest.test.js"],
  ["./stores.test.js"],
  ["./bun.test.js"],
  ["./bun.test.js", "./vitest.test.js"],
  ["./vitest.test.js", "./bun.test.js"],
  ["--isolate", "./bun.test.js", "./vitest.test.js"],
  ["--isolate", "./vitest.test.js", "./bun.test.js"],
  ["--parallel=1", "./bun.test.js", "./vitest.test.js"],
  ["--preload=./of-vitest.js", "./bun.test.js"],
  ["--preload=./of-bun.js", "./vitest.test.js"],
  ["--preload=./of-neither.js", "./vitest.test.js"],
  ["--preload=./of-neither.js", "--globals=vitest", "./vitest.test.js"],
  ["--preload=./of-vitest-peek.js", "--preload=./of-bun-peek-esm.js", "./vitest.test.js"],
  ["--preload=./of-bun-peek-esm.js", "--preload=./of-vitest-peek.js", "./bun.test.js"],
  ["--isolate", "--preload=./of-vitest.js", "./bun.test.js", "./vitest.test.js"],
];

async function runTests(directory: string, words: string | undefined, flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

export const plainAnswersByWhoLoadsFirst = () =>
  test("plain `bun test` answers by who loads a library first", async () => {
    using dir = tempDir("aot-vitest-flavor-libs", files);
    const none = `["undefined","undefined","undefined","undefined","object","function"]`;
    const all = `["object","function","function","function","object","function"]`;
    expect((await runTests(String(dir), undefined, ["./vitest.test.js", "./bun.test.js"])).stdout).toEqual([
      `SEEN vitest ${none} ${none} undefined undefined`,
      "SEEN vitest ReferenceError: jest is not defined | undefined | ReferenceError: jest is not defined | has none",
      `SEEN bun:test ${none} ${none} undefined undefined`,
      "SEEN bun:test ReferenceError: jest is not defined | undefined | ReferenceError: jest is not defined | has none",
    ]);
    expect((await runTests(String(dir), undefined, ["./bun.test.js", "./vitest.test.js"])).stdout.slice(0, 3)).toEqual([
      `SEEN bun:test ${all} ${all} object function`,
      "SEEN bun:test function | function | true | has jest",
      `SEEN vitest ${all} ${all} object function`,
    ]);
  });

const ways = {
  "as one program": "TestRunLayers:0",
};

export function compiledAnswersAsPlain(way: keyof typeof ways) {
  const words = ways[way];
  for (const flags of runs) {
    test.concurrent(
      `${way}: bun test ${flags.join(" ")}`,
      async () => {
        using dir = tempDir("aot-vitest-flavor-libs", files);
        const plain = await runTests(String(dir), undefined, flags);
        expect(plain.exitCode).toBe(0);
        expect(plain.stdout.length).toBeGreaterThan(1);
        expect(await runTests(String(dir), words, ["--aot", ...flags])).toEqual(plain);
      },
      240_000,
    );
  }
}
