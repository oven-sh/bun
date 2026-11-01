// The five members of the test runner that load a module by name are asked for a data file under a constant name: one that the program imports too, and one that nothing else names.
// Plain `bun test` says what is right. ./runner-loads-by-name.test.ts has files with code.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const shared = {
  "package.json": `{ "type": "module" }`,
  "data.json": `{ "v": "real", "n": 1, "list": [1, 2], "in": { "deep": "real deep" } }`,
  "only.json": `{ "only": "here", "more": [3] }`,
  "settings.toml": `title = "real"\n[owner]\nname = "somebody"\n`,
  "lib.mjs": `import it, { v } from "./data.json";
export const now = () => JSON.stringify(it) + " " + v;`,
};

const loaders: Record<string, (path: string) => string> = {
  "vi.importActual": path => `await vi.importActual("${path}")`,
  "vi.importMock": path => `await vi.importMock("${path}")`,
  "jest.requireActual": path => `jest.requireActual("${path}")`,
  "jest.requireMock": path => `jest.requireMock("${path}")`,
  "jest.createMockFromModule": path => `jest.createMockFromModule("${path}")`,
};
const paths = ["./data.json", "./only.json", "./settings.toml"];

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

// All five failed as one program on the build in front of the cure, none in layers: that way has a guard and no witness.
const witness = "vi.importMock";

describe.each(ways)("%s", (way, env) => {
  const runsIn = (name: string) => waysFor(ways, name === witness).some(([each]) => each === way);
  test.each(Object.keys(loaders).filter(runsIn))("%s", async name => {
    using dir = tempDir("runner-loads-json", {
      ...shared,
      "a.test.js": `import { jest, test, vi } from "bun:test";
import { now } from "./lib.mjs";
const say = names => JSON.stringify(names) + " " + Object.keys(names ?? {});
test("t", async () => {
${paths.map(path => `  console.log("| ${path}:", say(${loaders[name](path)}));`).join("\n")}
  console.log("| the importer:", now());
});`,
    });
    const plain = await runTests(String(dir), {});
    expect(plain.exitCode).toBe(0);
    expect(plain.printed).toHaveLength(paths.length + 1);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
});
