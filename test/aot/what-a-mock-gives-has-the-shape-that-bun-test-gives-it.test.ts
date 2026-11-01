import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "type": "module" }`,
  "node_modules/pkg-cjs/package.json": `{ "name": "pkg-cjs", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/pkg-cjs/index.js": `exports.v = "real v";`,
  "src/target.cjs": `exports.v = "real v";`,
  "src/target.ts": `export const v = "real v"; export default "real default";`,
  "src/other.ts": `export const v = "real v"; export default "real default";`,
  "src/user.js": `
    import * as T from "./target.cjs";
    export const read = () => String(T.v) + " " + String(T.missing) + " " + ("missing" in T) + " " + Object.keys(T).sort();`,
  // The mock lacks a member that a file reads off the namespace object.
  "lacks.test.js": `
    import { test, mock } from "bun:test";
    mock.module("./src/target.cjs", () => ({ v: "mocked v" }));
    test("lacks", async () => console.log("lacks", (await import("./src/user.js")).read()));`,
  // The package was loaded when it was mocked, so it has its names.
  "more.test.js": `
    import { test, mock } from "bun:test";
    import * as T from "pkg-cjs";
    import * as P from "node:path";
    mock.module("pkg-cjs", () => ({ v: "mocked v", extra: "extra" }));
    mock.module("node:path", () => ({ sep: "mocked sep", extra: "extra" }));
    test("more", () => {
      console.log("more", String(T.v), String(T.extra), "extra" in T, Object.keys(T).sort().join());
      console.log("more", String(P.sep), String(P.extra), "extra" in P, require("pkg-cjs").extra);
    });`,
  // Nothing had loaded the ES module: require() takes the default export of an object with the mark for the module.
  "marked.test.js": `
    import { test, mock } from "bun:test";
    mock.module("./src/target.ts", () => ({ __esModule: true, v: "mocked v", default: "mocked default" }));
    mock.module("./src/other.ts", () => ({ __esModule: true, v: "mocked v", default: undefined }));
    test("marked", () => {
      const T = require("./src/target.ts");
      console.log("marked", typeof T, String(T.v), String(T.default), T === require("./src/target.ts"));
      const O = require("./src/other.ts");
      console.log("marked", typeof O, String(O.v), String(O.default));
    });`,
};

async function runTests(folder: string, flags: string[], words = "") {
  const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, env);
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each([
  [["--isolate"], ""],
  [["--isolate"], "TestRunLayers:0"],
  [["--isolate"], "TestRunLayers:2,TestRunPartFiles:1"],
] as [string[], string][])(
  "the run prints what bun test prints: %j %s",
  async (flags, words) => {
    using dir = tempDir("what-a-mock-gives", files);
    const folder = String(dir);
    const plain = await runTests(folder, flags);
    expect(plain).toMatchObject({ counts: [" 3 pass", " 0 fail"], exitCode: 0 });
    expect(await runTests(folder, ["--aot", ...flags], words)).toEqual(plain);
  },
  240_000,
);
