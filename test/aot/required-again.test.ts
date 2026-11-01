// A mock stood in place of a module whose body never ran, and a user of the module was loaded against it. The mock ends, with a call or with its test file, and
// the user is required again: the module runs then, and the user reads the module. Plain `bun test` says what is right.
// ./mock-ends-in-test.test.ts has what holds the mock on; `bun test` also runs the user a second time.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const shared = {
  "package.json": `{ "type": "module" }`,
  "dep.ts": `console.log("| dep runs");
export const a = "real a";
export function fn() { return "real fn"; }`,
  "user.mjs": `import { a, fn } from "./dep";\nexport const seen = () => a + ", " + fn();`,
};
const first = `jest.doMock("./dep", () => ({ a: "first a", fn: () => "first fn" }));`;

const projects: Record<string, Record<string, string>> = {
  "by the test that ended the mock": {
    "a.test.ts": `import { jest, test, vi } from "bun:test";
test("t", () => {
  ${first}
  console.log("| mocked:", require("./user.mjs").seen());
  vi.doUnmock("./dep");
  console.log("| again:", require("./user.mjs").seen());
});`,
  },
  "by another module, and in the next test": {
    "asker.ts": `export const ask = () => require("./user.mjs").seen();`,
    "a.test.ts": `import { jest, test, vi } from "bun:test";
import { ask } from "./asker";
test("t", () => {
  ${first}
  console.log("| mocked:", ask());
  vi.doUnmock("./dep");
  console.log("| again:", ask());
});
test("the next test", () => console.log("| the next test:", ask()));`,
  },
  "through a module that passes the names on": {
    "middle.mjs": `export { seen } from "./user.mjs";`,
    "a.test.ts": `import { jest, test, vi } from "bun:test";
test("t", () => {
  ${first}
  console.log("| mocked:", require("./middle.mjs").seen());
  vi.doUnmock("./dep");
  console.log("| again:", require("./middle.mjs").seen());
  console.log("| the user itself:", require("./user.mjs").seen());
});`,
  },
  "behind a second mock": {
    "a.test.ts": `import { jest, test, vi } from "bun:test";
test("t", () => {
  ${first}
  console.log("| mocked:", require("./user.mjs").seen());
  vi.doUnmock("./dep");
  jest.doMock("./dep", () => ({ a: "second a", fn: () => "second fn" }));
  console.log("| mocked again:", require("./user.mjs").seen());
  vi.doUnmock("./dep");
  console.log("| again:", require("./user.mjs").seen());
});`,
  },
  "by the next test file": {
    "a.test.ts": `import { jest, test } from "bun:test";
test("t", () => {
  ${first}
  console.log("| mocked:", require("./user.mjs").seen());
});`,
    "b.test.ts": `import { test } from "bun:test";
test("u", () => {
  console.log("| again:", require("./user.mjs").seen());
  console.log("| once more:", require("./user.mjs").seen());
});`,
  },
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), results, exitCode };
}

// It failed in both ways on the build in front of the cure, as four more did: none in layers alone.
const witness = "by the next test file";

describe.each(ways)("%s", (way, env) => {
  const runsIn = (name: string) => waysFor(ways, name === witness).some(([each]) => each === way);
  test.each(Object.keys(projects).filter(runsIn))("%s", async name => {
    using dir = tempDir("required-again", { ...shared, ...projects[name] });
    const plain = await runTests(String(dir), {});
    expect(plain.exitCode).toBe(0);
    expect(plain.printed).toContain("| mocked: first a, first fn");
    expect(plain.printed.slice(plain.printed.indexOf("| dep runs"))).toContain("| again: real a, real fn");
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
});
