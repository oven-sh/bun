import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// How often a failure is reported is on stderr alone, which the stored test runs are not held by.
const reportsOf = async (dir: string, ...flags: string[]) => {
  const { stderr } = await run([bunExe(), "test", ...flags, "./a_test.mjs"], dir, { ...bunEnv, NO_COLOR: "1" });
  return stderr.split("\n").filter(line => line === "error: the second factory").length;
};

const files = {
  "package.json": `{ "name": "the-load-goes-on-for-a-later-mock", "type": "module" }`,
  "thread.mjs": `export const width = "real";`,
  "dye.mjs": `export const shade = "real";`,
  "spool.mjs": `import { width } from "./thread.mjs";\nexport const seen = "spool " + width;`,
  "loom.mjs": `import { seen as below } from "./spool.mjs";\nexport const seen = "loom " + below;`,
  "cloth.mjs": `import { width } from "./thread.mjs";\nimport { shade } from "./dye.mjs";\nexport const seen = "cloth " + width + " " + shade;`,
};
const head = `
      import { test, vi } from "bun:test";
      const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
      const asked = load => { try { load(); } catch {} };
      let open, openDye;
      const never = new Promise(() => {});
      const gate = new Promise(opens => { open = opens; });
      const gateOfDye = new Promise(opens => { openDye = opens; });
      const second = () => vi.doMock("./thread.mjs", async () => { await gate; throw new Error("the second factory"); });`;

// Under `bun test` a report is a synchronous fetch that came to a fetch in flight and was dropped: one for each require() that comes there under the factory that fails.
for (const [name, reports, body] of [
  [
    "the load that a require left goes on for the mock that takes the place of its own: two later requires, two reports",
    2,
    `vi.doMock("./thread.mjs", () => never);
        asked(() => require("./loom.mjs"));
        second();
        asked(() => require("./spool.mjs"));
        asked(() => require("./loom.mjs"));`,
  ],
  [
    "the require that calls the later factory is counted once",
    1,
    `vi.doMock("./thread.mjs", () => never);
        asked(() => require("./spool.mjs"));
        second();
        asked(() => require("./spool.mjs"));`,
  ],
  [
    "a call of the later factory that no require makes is not counted: the require behind it is",
    1,
    `vi.doMock("./thread.mjs", () => never);
        vi.doMock("./dye.mjs", async () => { await gateOfDye; return { shade: "mock" }; });
        asked(() => require("./cloth.mjs"));
        second();
        openDye();
        await turns(5);
        asked(() => require("./cloth.mjs"));`,
  ],
  [
    "a require that came under a factory that was replaced since stays counted: the later factory is called by a require",
    2,
    `vi.doMock("./thread.mjs", () => never);
        asked(() => require("./loom.mjs"));
        vi.doMock("./thread.mjs", () => never);
        asked(() => require("./cloth.mjs"));
        second();
        asked(() => require("./spool.mjs"));`,
  ],
  [
    "and where an import that is caught calls it",
    1,
    `vi.doMock("./thread.mjs", () => never);
        asked(() => require("./loom.mjs"));
        vi.doMock("./thread.mjs", () => never);
        asked(() => require("./cloth.mjs"));
        second();
        import("./spool.mjs").catch(() => {});
        await turns(2);`,
  ],
] as const) {
  test(name, async () => {
    using dir = tempDir("aot-reports-behind-requires", {
      ...files,
      "a_test.mjs": `${head}
      test("t", async () => {
        ${body}
        open();
        await turns(5);
      });`,
    });
    expect(await reportsOf(String(dir))).toBe(reports);
    expect(await reportsOf(String(dir), "--aot")).toBe(reports);
  });
}
