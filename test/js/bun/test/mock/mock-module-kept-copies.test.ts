import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The assertions are inside the fixtures. `pass` makes sure every test in them actually ran.
async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("mock-module-kept-copies", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
  expect(exitCode).toBe(0);
}

// The end of a test file takes the importers of a mocked module out of the registry. A module that got one of them by a call is no importer:
// it stays loaded and keeps the copy it got. A later mock of that module patches the copy too, as it did while nothing left the registry.
describe.concurrent("a mock reaches the copy of a module that left the registry and that a loaded module kept", () => {
  const modules = {
    "low.js": `export const v = () => "low";`,
    "cmd.js": `
      import { v } from "./low.js";
      globalThis.evaluationsOfCmd = (globalThis.evaluationsOfCmd ?? 0) + 1;
      export default () => "cmd " + v();
    `,
  };
  const keepsPromise = {
    "svc.js": `let kept; export const run = async () => (await (kept ??= import("./cmd.js"))).default();`,
  };
  // It mocks what cmd.js imports, so its end takes cmd.js out of the registry.
  const mocksLow = (imports = "") => `
    import { afterAll, expect, mock, test } from "bun:test";
    import * as low from "./low.js";
    import { run } from "./svc.js";
    ${imports}
    const real = { ...low };
    mock.module("./low.js", () => ({ v: () => "fake low" }));
    afterAll(() => void mock.module("./low.js", () => real));
    test("the holder loads cmd.js", async () => expect(await run()).toBe("cmd fake low"));
  `;
  const mocksCmd = `
    import { beforeAll, expect, mock, test } from "bun:test";
    import * as cmd from "./cmd.js";
    import { run } from "./svc.js";
    beforeAll(() => void mock.module("./cmd.js", () => ({ default: () => "fake cmd" })));
    test("the mock reaches what the holder kept", async () => {
      expect([await run(), cmd.default()]).toEqual(["fake cmd", "fake cmd"]);
    });
  `;
  const mocksNothing = `
    import { expect, test } from "bun:test";
    import { run } from "./svc.js";
    test("the holder has the module itself", async () => expect(await run()).toBe("cmd low"));
  `;
  const inOrder = ["./1.test.js", "./2.test.js", "./3.test.js"];

  test.each([
    ["keeps the promise of import()", mocksLow(), keepsPromise],
    [
      "keeps the namespace that a top-level await gave it",
      mocksLow(),
      { "svc.js": `const cmd = await import("./cmd.js"); export const run = async () => cmd.default();` },
    ],
    [
      "is a CommonJS module that keeps the promise of import()",
      mocksLow(),
      {
        "svc.js": `export { run } from "./svc.cjs";`,
        "svc.cjs": `let kept; exports.run = async () => (await (kept ??= import("./cmd.js"))).default();`,
      },
    ],
    [
      "is an ES module whose require() found the module in the cache",
      mocksLow(`import "./first.cjs";`),
      {
        "first.cjs": `exports.cmd = require("./cmd.js");`,
        "svc.js": `let kept; export const run = async () => (kept ??= require("./cmd.js")).default();`,
      },
    ],
    [
      "is in a package",
      mocksLow(),
      {
        "node_modules/holder/package.json": JSON.stringify({ name: "holder", type: "module", main: "./index.js" }),
        "node_modules/holder/index.js": `let kept; export const load = () => (kept ??= import("../../cmd.js"));`,
        "svc.js": `import { load } from "holder"; export const run = async () => (await load()).default();`,
      },
    ],
    [
      "was handed the namespace by an importer",
      mocksLow(),
      {
        "memo.js": `let kept; export const keep = cmd => (kept ??= cmd);`,
        "svc.js": `import * as cmd from "./cmd.js"; import { keep } from "./memo.js"; export const run = async () => keep(cmd).default();`,
      },
    ],
  ])("which %s", async (_, first, holder) => {
    await expectFixturesToPass(
      { ...modules, ...holder, "1.test.js": first, "2.test.js": mocksCmd, "3.test.js": mocksNothing },
      3,
      inOrder,
    );
  });

  test("and no module is evaluated more often for it", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        "svc.js": `globalThis.evaluationsOfSvc = (globalThis.evaluationsOfSvc ?? 0) + 1; ${keepsPromise["svc.js"]}`,
        "1.test.js": mocksLow(),
        "2.test.js": `
          import { beforeAll, expect, mock, test } from "bun:test";
          import * as cmd from "./cmd.js";
          import { run } from "./svc.js";
          beforeAll(() => void mock.module("./cmd.js", () => ({ default: () => "fake cmd" })));
          test("cmd.js once more for this file, and the holder not again", async () => {
            expect([await run(), globalThis.evaluationsOfCmd, globalThis.evaluationsOfSvc]).toEqual(["fake cmd", 2, 1]);
          });
        `,
      },
      2,
      inOrder.slice(0, 2),
    );
  });

  test.each([
    ["a preload loaded", ["--preload", "./preload.js"]],
    ["a --parallel worker that keeps its modules loaded", ["--parallel=1", "--no-isolate"]],
  ])("which %s", async (_, args) => {
    await expectFixturesToPass(
      {
        ...modules,
        ...keepsPromise,
        "preload.js": `import "./svc.js";`,
        "1.test.js": mocksLow(),
        "2.test.js": mocksCmd,
        "3.test.js": mocksNothing,
      },
      3,
      [...args, ...inOrder],
    );
  });

  test.each(["jest", "vi"])(
    "from a hoisted %s.mock() whose factory reads an import of the file behind an await",
    async api => {
      await expectFixturesToPass(
        {
          ...modules,
          ...keepsPromise,
          "label.js": `export const label = "fake cmd";`,
          "1.test.js": mocksLow(),
          "2.test.js": `
            import { expect, jest, test, vi } from "bun:test";
            import { label } from "./label.js";
            import * as cmd from "./cmd.js";
            import { run } from "./svc.js";
            ${api}.mock("./cmd.js", async () => {
              await null;
              const text = label;
              return { default: () => text };
            });
            test("the import of cmd.js called the factory", async () => {
              expect([await run(), cmd.default()]).toEqual(["fake cmd", "fake cmd"]);
            });
          `,
          "3.test.js": mocksNothing,
        },
        3,
        inOrder,
      );
    },
  );

  test("vi.doMock() leaves it alone, like a module that is loaded", async () => {
    await expectFixturesToPass(
      {
        ...modules,
        ...keepsPromise,
        "1.test.js": mocksLow(),
        "2.test.js": `
          import { expect, test, vi } from "bun:test";
          import { run } from "./svc.js";
          test("the next import() gets the mock", async () => {
            vi.doMock("./cmd.js", () => ({ default: () => "fake cmd" }));
            expect([await run(), (await import("./cmd.js")).default()]).toEqual(["cmd low", "fake cmd"]);
          });
        `,
      },
      2,
      inOrder.slice(0, 2),
    );
  });

  // The mock of barrel.js patches the variable of impl.js while both are loaded, and again after both have left the registry. In between, the mock
  // of impl.js patches it as a module that left. Each saved what it found there.
  test("two mocks that patch one variable of what the holder kept are undone in the order of their patches", async () => {
    await expectFixturesToPass(
      {
        "low.js": modules["low.js"],
        "impl.js": `import { v } from "./low.js"; export const name = () => "impl " + v();`,
        "barrel.js": `export * from "./impl.js";`,
        "svc.js": `let kept; export const run = async () => (await (kept ??= import("./barrel.js"))).name();`,
        "1.test.js": `
          import { expect, test } from "bun:test";
          import { run } from "./svc.js";
          test("the holder loads barrel.js", async () => expect(await run()).toBe("impl low"));
        `,
        "2.test.js": `
          import { expect, mock, test } from "bun:test";
          import { run } from "./svc.js";
          test("each mock reaches what the holder kept", async () => {
            const seen = [];
            for (const [path, exports] of [
              ["./barrel.js", { name: () => "first of barrel" }],
              ["./low.js", { v: () => "fake low" }],
              ["./impl.js", { name: () => "of impl" }],
              ["./barrel.js", { name: () => "second of barrel" }],
            ]) {
              mock.module(path, () => exports);
              await import(path);
              seen.push(await run());
            }
            expect(seen).toEqual(["first of barrel", "first of barrel", "of impl", "second of barrel"]);
          });
        `,
        "3.test.js": `
          import { expect, test } from "bun:test";
          import { run } from "./svc.js";
          test("the holder has the module itself again", async () => expect(await run()).toBe("impl low"));
        `,
      },
      3,
      inOrder,
    );
  });

  test("no copy is kept alive by the mock that patched it", async () => {
    const files: Record<string, string> = {
      "dep.js": `export const x = "real";`,
      "holder.js": `let kept; export const seen = async () => (await (kept ??= import("./m19.js"))).seen();`,
    };
    for (let i = 0; i < 20; i++)
      files[`m${i}.js`] =
        `import { x } from "./dep.js"; ${i ? `import "./m${i - 1}.js";` : ""} export const seen = () => x;`;
    // The end of each takes its own copy of m0.js to m19.js out of the registry. The holder keeps those of the first.
    for (let i = 0; i < 6; i++)
      files[`a${i}.test.js`] = `
        import { expect, mock, test } from "bun:test";
        import "./m19.js";
        import { seen } from "./holder.js";
        mock.module("./dep.js", () => ({ x: "mock ${i}" }));
        test("mocks what they import", async () => expect(await seen()).toBe("mock ${i}"));
      `;
    files["z.test.js"] = `
      import { heapStats } from "bun:jsc";
      import { expect, mock, test } from "bun:test";
      import "./m19.js";
      import { seen } from "./holder.js";
      mock.module("./m19.js", () => ({ seen: () => "mock" }));
      test("only the copy that the holder kept is left while the mock stands", async () => {
        expect(await seen()).toBe("mock");
        Bun.gc(true);
        expect(heapStats().objectTypeCounts.ModuleRecord).toBeLessThan(100);
      });
    `;
    await expectFixturesToPass(files, 7);
  });
});
