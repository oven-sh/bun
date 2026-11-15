import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// How often the late failure of a factory is reported where requires gave up on it. The stored runs (parallel-test-runs/) hold the two runs to what
// the tests print, how each test ends and the exit code, and a test that fails by one report fails by two as well: so the reports are counted here.
const project = (asks: string) => ({
  "package.json": `{ "name": "cell", "private": true, "type": "module" }`,
  "wick.mjs": `export const width = "real";`,
  "oil.mjs": `export const drop = "real oil";`,
  "lamp.mjs": `import { width } from "./wick.mjs";\nexport const seen = "lamp " + width;`,
  "pair.mjs": `import { width } from "./wick.mjs";\nimport { drop } from "./oil.mjs";\nexport const seen = "pair " + width + " " + drop;`,
  "a.test.js": `
    import { test, vi } from "bun:test";
    const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
    const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
    let open;
    const never = new Promise(() => {});
    const gate = new Promise(opens => { open = opens; });
    test("a", async () => {
      vi.doMock("./wick.mjs", async () => { await never; });
      asked("./lamp.mjs");
      vi.doMock("./wick.mjs", async () => { await gate; throw new RangeError("wick fails"); });
      asked("./lamp.mjs");
      ${asks}
      open();
      await turns(5);
    });`,
});

async function reportsOf(folder: string, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags], folder, { ...bunEnv, NO_COLOR: "1" });
  return { reports: stderr.split("\n").filter(line => line === "RangeError: wick fails").length, exitCode };
}

for (const [name, asks, reports] of [
  ["the second require has made the call, and nobody else asks", ``, 1],
  [
    "the second require has made the call, and the load of another file comes to hear it",
    `vi.doMock("./oil.mjs", async () => { await never; }); asked("./pair.mjs");`,
    1,
  ],
  ["a third require of the same file comes to the call of the second", `asked("./lamp.mjs");`, 2],
] as const) {
  test(
    name,
    async () => {
      using plainDir = tempDir("aot-reports-of-a-late-failure", project(asks));
      using compiledDir = tempDir("aot-reports-of-a-late-failure", project(asks));
      const [plain, compiled] = await Promise.all([
        reportsOf(String(plainDir)),
        reportsOf(String(compiledDir), "--aot"),
      ]);
      expect(plain).toEqual({ reports, exitCode: 1 });
      expect(compiled).toEqual(plain);
    },
    60_000,
  );
}
