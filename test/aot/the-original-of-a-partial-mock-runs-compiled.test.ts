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
