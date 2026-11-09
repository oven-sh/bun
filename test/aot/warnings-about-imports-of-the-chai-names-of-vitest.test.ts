import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Under `bun test`, `assert` and `should` of "vitest" come from the project's chai. The statement that names them imports them from there, where it
// is written, and a statement of its own imports its other names from "vitest". What the build warns about either half names the line and the column
// of the statement that the user wrote, and a `@ts-expect-error` above it still holds.
// With `noUnusedLocals` each half is judged by itself, so a statement whose names of chai alone are unused is told that all of its imports are.
// Bun's own declaration of "vitest" has neither name. A statement that the build leaves as written, as the one inside a `declare` block, is told so.
const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      noUnusedLocals: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
    },
  }),
  "node_modules/chai/package.json": `{ "name": "chai", "type": "module", "main": "index.js" }`,
  "node_modules/chai/index.js": `
    export const assert = () => "the project's assert";
    export const should = () => "the project's should";
  `,
  "helper.ts": `export const helper = "helper";`,
  "a-name-that-vitest-lacks.test.ts": `import { helper } from "./helper";
import { assert, Nope, test } from "vitest";
test("test", () => console.log(helper, typeof assert));`,
  "nothing-used.test.ts": `import { helper } from "./helper";
// The import stands on the third line.
import { assert, should } from "vitest";
test("test", () => console.log(helper));`,
  "assert-alone-used.test.ts": `import { helper } from "./helper";
// The import stands on the third line.
import { assert, describe, it } from "vitest";
test("test", () => console.log(helper, typeof assert));`,
  "others-alone-used.test.ts": `import { helper } from "./helper";
// The import stands on the third line.
import { assert, should, describe, it } from "vitest";
describe("describe", () => it("test", () => console.log(helper)));`,
  "an-error-is-expected.test.ts": `import { helper } from "./helper";
import { test } from "vitest";
// @ts-expect-error
import { assert, vi, beforeEach } from "vitest";
test("test", () => console.log(helper, typeof assert));`,
  "in-a-declare-block.test.ts": `import { test } from "vitest";
const vi = { fn: "the file's own vi" };
declare module "ambient" { import { assert, vi } from "vitest"; export const a: typeof assert; export const v: typeof vi; }
test("test", () => console.log(vi.fn));`,
};

const warnings = (stderr: string) =>
  [...stderr.matchAll(/^warn: (TS\d+): .*\n(?:.*\n)*?\s+at .*?([^/\\]+:\d+:\d+)$/gm)]
    .map(match => `${match[2]} ${match[1]}`)
    .sort();

test("the warnings about an import that names assert or should of vitest stand where it is written", async () => {
  using dir = tempDir("aot-chai-warnings", project);
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir));
  expect(warnings(stderr)).toEqual([
    "a-name-that-vitest-lacks.test.ts:2:18 TS2305",
    "a-name-that-vitest-lacks.test.ts:2:18 TS6133",
    "assert-alone-used.test.ts:3:1 TS6192",
    "in-a-declare-block.test.ts:3:16 TS2664",
    "in-a-declare-block.test.ts:3:37 TS2305",
    "nothing-used.test.ts:3:1 TS6192",
    "others-alone-used.test.ts:3:1 TS6192",
  ]);
  expect(stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line))).toEqual([" 6 pass", " 0 fail"]);
  expect(exitCode).toBe(0);
});
