import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// What a factory imports of its own module is the module that the build compiled. On these roads it used to go under "?actual", which the host reads from disk and the interpreter runs.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tax.js": `console.log("SAID tax runs");\nexport const rate = "real rate";\nexport const fee = "real fee";`,
  "reader.js": `import { rate, fee } from "./tax.js";\nexport const read = () => rate + ", " + fee;`,
};
const head = `import { mock, test } from "bun:test";\nconst name = text => process.env.NOBODY_SETS_THIS || text;\n`;
const roads = {
  // The loader fetches the mocked module for the reader, and the factory runs inside that fetch.
  "the reader goes by a name that the build cannot tell": `${head}mock.module("./tax.js", async () => ({ ...(await import("./tax.js")), rate: "mock rate" }));
test("a", async () => console.log("SAID", (await import(name("./reader.js"))).read()));`,
  // The host resolves the name to the key of the original.
  "the factory asks by a name that the build cannot tell": `${head}mock.module("./tax.js", async () => ({ ...(await import(name("./tax.js"))), rate: "mock rate" }));
test("a", async () => console.log("SAID", (await import("./reader.js")).read()));`,
};

test.each(Object.entries(roads))("no file of the run runs from its text: %s", async (_, testFile) => {
  using directory = tempDir("original-runs-compiled", { ...files, "a.test.js": testFile });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  const all = stdout + "\n" + stderr;
  expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID tax runs",
    "SAID mock rate, real fee",
  ]);
  expect(all).toContain(" 1 pass");
  expect(all).not.toContain("ran from source");
});

const behindGraphThatFailed = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "oven.js": `throw new Error("the oven trips");`,
  "shelf.js": `console.log("SAID shelf runs");\nexport const shelf = () => "real shelf";`,
  "bakery.js": `import "./oven.js";\nimport { shelf } from "./shelf.js";\nexport const bakery = shelf;`,
  "a.test.js": `import { test } from "bun:test";\ntest("a", async () => console.log("SAID", await import("./bakery.js").catch(error => error.message)));`,
};
const mocksThatTakeTheOriginal = {
  "a factory over the original": `vi.doMock("./shelf.js", async original => ({ ...(await original()) }));`,
  "no factory": `vi.doMock("./shelf.js");`,
  "a spy": `vi.doMock("./shelf.js", { spy: true });`,
};

test.each(Object.entries(mocksThatTakeTheOriginal))(
  "nor over a file that a failed graph of an earlier test file had linked: %s",
  async (_, lay) => {
    using directory = tempDir("original-runs-compiled", {
      ...behindGraphThatFailed,
      "b.test.js": `import { test, vi } from "bun:test";\ntest("b", async () => {\n  ${lay}\n  console.log("SAID", typeof (await import("./shelf.js")).shelf);\n});`,
    });
    const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
    const all = stdout + "\n" + stderr;
    expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([
      "SAID the oven trips",
      "SAID shelf runs",
      "SAID function",
    ]);
    expect(all).toContain(" 2 pass");
    expect(all).not.toContain("ran from source");
  },
);

test("nor where vi.importActual() asks by name over such a file, before anybody has asked for the mock", async () => {
  using directory = tempDir("original-runs-compiled", {
    ...behindGraphThatFailed,
    "a.test.js": `import { test, vi } from "bun:test";
test("a", async () => {
  console.log("SAID", await import("./bakery.js").catch(error => error.message));
  vi.doMock("./shelf.js", () => ({ shelf: () => "mock shelf" }));
  console.log("SAID", (await vi.importActual("./shelf.js")).shelf());
  console.log("SAID", (await import("./shelf.js")).shelf());
  vi.doUnmock("./shelf.js");
  console.log("SAID", (await import("./shelf.js")).shelf());
});`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  const all = stdout + "\n" + stderr;
  expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID the oven trips",
    "SAID shelf runs",
    "SAID real shelf",
    "SAID mock shelf",
    "SAID real shelf",
  ]);
  expect(all).toContain(" 1 pass");
  expect(all).not.toContain("ran from source");
});

const fileOfFunctions = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "oven.js": `throw new Error("the oven trips");`,
  "unit.js": `export function unit() {\n  return "gram";\n}`,
  "scale.js": `import { unit } from "./unit.js";\nexport function weigh() {\n  return "two " + unit();\n}`,
  "bakery.js": `import "./oven.js";\nimport { weigh } from "./scale.js";\nexport const bakery = weigh;`,
};
const askUnderMockAndBehindItsEnd = `const mocked = await import("./scale.js");
  console.log("SAID", mocked.weigh(), vi.isMockFunction(mocked.weigh));
  vi.doUnmock("./scale.js");
  const real = await import("./scale.js");
  console.log("SAID", real.weigh(), vi.isMockFunction(real.weigh));`;
const mocksWithoutFactory = {
  "a spy": [`vi.doMock("./scale.js", { spy: true });`, "SAID two gram true"],
  "no factory": [`vi.doMock("./scale.js");`, "SAID undefined true"],
  "a spy behind a graph that failed and had linked the file": [
    `await import("./bakery.js").catch(() => {});\n  vi.doMock("./scale.js", { spy: true });`,
    "SAID two gram true",
  ],
};

test.each(Object.entries(mocksWithoutFactory))(
  "nor the original of a mock without a factory, where the file only declares functions: %s",
  async (_, [lay, said]) => {
    using directory = tempDir("original-runs-compiled", {
      ...fileOfFunctions,
      "a.test.js": `import { test, vi } from "bun:test";\ntest("a", async () => {\n  ${lay}\n  ${askUnderMockAndBehindItsEnd}\n});`,
    });
    const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
    const all = stdout + "\n" + stderr;
    expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([said, "SAID two gram false"]);
    expect(all).toContain(" 1 pass");
    expect(all).not.toContain("ran from source");
  },
);
