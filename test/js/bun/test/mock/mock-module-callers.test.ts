import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";

// The assertions are inside the fixtures. `pass` makes sure every test in them actually ran.
async function expectFixturesToPass(files: Record<string, string>, pass: number, args: string[] = []) {
  using dir = tempDir("mock-module-callers", files);
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

// A module that got a mock through import() or require() may hold it, like one that imports it by a statement.
// An ASAN build starts too slowly to run all of these at the same time within the default timeout.
describe.concurrentIf(!isASAN)(
  "module mocks are undone when the file ends, for the callers of import() and require()",
  () => {
    const counted = (name: string, body: string) =>
      `globalThis.runs ??= {}; globalThis.runs["${name}"] = (globalThis.runs["${name}"] ?? 0) + 1;\n${body}`;
    // byRequire is the first to require the module, and the others find it in require.cache.
    const names = [
      "byImport",
      "byLazyImport",
      "byImportOfImporter",
      "byImportInCommonJS.cjs",
      "byRequire",
      "byRequireAgain",
      "byRequireAfterChildrenAreRead",
      "byLaterRequire",
      "byImportMock",
      "byRequireMock",
    ];
    const readers = {
      "flags.ts": counted("flags", `export const enabled = "real";`),
      "byStatement.ts": `import { enabled } from "./flags"; export const read = () => enabled;`,
      "byImport.ts": `const flags = await import("./flags"); export const read = () => flags.enabled;`,
      "byLazyImport.ts": `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
      "byImportOfImporter.ts": `let reader; export const read = async () => (reader ??= await import("./byStatement")).read();`,
      "byRequire.ts": `const flags = require("./flags"); export const read = () => flags.enabled;`,
      "byRequireAgain.ts": `const flags = require("./flags"); export const read = () => flags.enabled;`,
      // From here on the children of the module are in an array that the program can reach.
      "byRequireAfterChildrenAreRead.ts": `
      require("./readsChildrenOfParent.cjs");
      const flags = require("./flags");
      export const read = () => flags.enabled;
    `,
      "readsChildrenOfParent.cjs": `module.parent.children;`,
      "byImportInCommonJS.cjs": `let flags; exports.read = async () => (flags ??= await import("./flags")).enabled;`,
      // A file that imports this one before it makes a mock has the module call require() first without one.
      "byLaterRequire.ts": `
      require("./plain.cjs");
      let flags;
      export const read = () => (flags ??= require("./flags")).enabled;
    `,
      "plain.cjs": `module.exports = {};`,
      "byImportMock.ts": `import { vi } from "bun:test"; const flags = await vi.importMock("./flags"); export const read = () => flags.enabled;`,
      "byRequireMock.ts": `import { jest } from "bun:test"; const flags = jest.requireMock("./flags"); export const read = () => flags.enabled;`,
      // Nothing here keeps what it gets.
      "all.ts": `
      export const readAll = async () => {
        const read = {};
        for (const reader of ${JSON.stringify(names)})
          read[reader] = await (await import("./" + reader)).read();
        return read;
      };
    `,
    };
    const all = (value: string) => JSON.stringify(Object.fromEntries(names.map(reader => [reader, value])));
    const plain = `
    import { expect, test } from "bun:test";
    import { readAll } from "./all";
    test("each reader gets the real module, which has run once", async () => {
      expect([await readAll(), globalThis.runs.flags]).toEqual([${all("real")}, 1]);
    });
  `;

    test.each([
      ["vi.mock()", `vi.mock("./flags", () => ({ enabled: "mock" }));`],
      ["jest.mock()", `jest.mock("./flags", () => ({ enabled: "mock" }));`],
      ["mock.module()", `mock.module("./flags", () => ({ enabled: "mock" }));`],
    ])("the next file gets the real module through each of them after %s", async (_, mock) => {
      await expectFixturesToPass(
        {
          ...readers,
          "1.test.ts": `
          import { expect, jest, mock, test, vi } from "bun:test";
          import { readAll } from "./all";
          ${mock}
          test("each reader gets the mock", async () => expect(await readAll()).toEqual(${all("mock")}));
        `,
          "2.test.ts": plain,
        },
        2,
      );
    });

    test.each([
      ["vi.doUnmock()", `vi.doMock("./flags", factory); await expectTheMock(); vi.doUnmock("./flags");`],
      ["jest.dontMock()", `jest.doMock("./flags", factory); await expectTheMock(); jest.dontMock("./flags");`],
      ["the end of a using block", `{ using _ = vi.doMock("./flags", factory); await expectTheMock(); }`],
      [
        "another mock of the module",
        `vi.doMock("./flags", factory); await expectTheMock(); vi.doMock("./flags", () => ({ enabled: "other mock" }));`,
      ],
    ])("and after a mock that %s removed before the file ended", async (_, body) => {
      await expectFixturesToPass(
        {
          ...readers,
          "1.test.ts": `
          import { expect, jest, test, vi } from "bun:test";
          import { readAll } from "./all";
          import "./byLaterRequire";
          const factory = () => ({ enabled: "mock" });
          const expectTheMock = async () => expect(await readAll()).toEqual(${all("mock")});
          test("each reader gets the mock", async () => {
            ${body}
          });
        `,
          "2.test.ts": plain,
        },
        2,
      );
    });

    // Each run of the file makes its own mock, and the readers of one run would hand the mock of that run to the next.
    test.each([[["--rerun-each=2"]], [["--isolate", "--rerun-each=2"]]])(
      "the next run of the file gets its own mock through each of them %j",
      async args => {
        await expectFixturesToPass(
          {
            ...readers,
            "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { readAll } from "./all";
          vi.mock("./flags", () => ({ enabled: "mock " + (globalThis.mocks = (globalThis.mocks ?? 0) + 1) }));
          test("each reader gets the mock of this run", async () => {
            const read = await readAll();
            expect(read).toEqual(${all("mock")}.byImport && Object.fromEntries(Object.keys(read).map(reader => [reader, "mock " + globalThis.mocks])));
          });
        `,
          },
          2,
          args,
        );
      },
    );

    test("in a worker that runs one file after another", async () => {
      await expectFixturesToPass(
        {
          ...readers,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { readAll } from "./all";
          vi.mock("./flags", () => ({ enabled: "mock" }));
          test("each reader gets the mock", async () => expect(await readAll()).toEqual(${all("mock")}));
        `,
          "2.test.ts": plain,
        },
        2,
        ["--parallel=2", "--parallel-delay=1000000", "--no-isolate"],
      );
    });

    test("a module with a query in its key, and a module that a plugin made", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "lazy.ts": counted(
            "lazy",
            `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
          ),
          "plugin.ts": `
          Bun.plugin({
            name: "a module of a plugin",
            setup(build) {
              build.module("made:lazy", () => ({
                contents: ${JSON.stringify(counted("made:lazy", `let flags; export const read = async () => (flags ??= await import(FLAGS)).enabled;`))}.replace("FLAGS", JSON.stringify(import.meta.dir + "/flags.ts")),
                loader: "ts",
              }));
            },
          });
        `,
          // The code of a CommonJS module has the URL of its file, without the query of its key.
          "lazy.cjs": counted(
            "lazy.cjs",
            `let flags; exports.read = async () => (flags ??= await import("./flags.ts")).enabled;`,
          ),
          "all.ts": `
          export const readAll = async () => [
            await (await import("./lazy.ts?query")).read(),
            await (await import("made:lazy")).read(),
            await (await import("./lazy.cjs?imported")).read(),
            await require("./lazy.cjs?required").read(),
          ];
        `,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { readAll } from "./all";
          vi.mock("./flags", () => ({ enabled: "mock" }));
          test("each reader gets the mock", async () => expect(await readAll()).toEqual(["mock", "mock", "mock", "mock"]));
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { readAll } from "./all";
          test("each reader gets the real module, and has run again", async () => {
            expect(await readAll()).toEqual(["real", "real", "real", "real"]);
            expect(globalThis.runs).toEqual({ lazy: 2, "made:lazy": 2, "lazy.cjs": 4 });
          });
        `,
        },
        2,
        ["--preload", "./plugin.ts"],
      );
    });

    const shell = {
      "prefs.ts": `export const theme = "light";`,
      "page.ts": `import { theme } from "./prefs"; export const render = () => theme;`,
      "routes.ts": counted("routes", `export const page = () => import("./page");`),
      "shell.ts": counted(
        "shell",
        `import { page } from "./routes"; export const show = async () => (await page()).render();`,
      ),
      "1.test.ts": `
      import { expect, test } from "bun:test";
      import { show } from "./shell";
      test("the shell shows the page", async () => expect(await show()).toBe("light"));
    `,
    };
    const shellAgain = (runs: number) => `
    import { expect, test } from "bun:test";
    import { show } from "./shell";
    test("the shell shows the page", async () => {
      expect([await show(), globalThis.runs]).toEqual(["light", { routes: ${runs}, shell: ${runs} }]);
    });
  `;

    // The page that routes.ts got is not the one that the mock reached.
    test("a module that called import() for a module before a mock reached it is not evaluated again", async () => {
      await expectFixturesToPass(
        {
          ...shell,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("the page gets the mock", async () => {
            mock.module("./prefs", () => ({ theme: "dark" }));
            expect((await import("./page")).render()).toBe("dark");
          });
        `,
          "3.test.ts": shellAgain(1),
        },
        3,
      );
    });

    // routes.ts keeps nothing, and nothing says so. It goes like a module that imports the page by a statement, with what imports it.
    test("a module that called import() for a module that imports the mock is evaluated again, with its importers", async () => {
      await expectFixturesToPass(
        {
          ...shell,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { show } from "./shell";
          test("the shell shows the page with the mock", async () => {
            mock.module("./prefs", () => ({ theme: "dark" }));
            expect(await show()).toBe("dark");
          });
        `,
          "3.test.ts": shellAgain(2),
        },
        3,
      );
    });

    test("what holds a module that called for the mock goes with it, though it got that module before the mock", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "lazy.ts": counted(
            "lazy",
            `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
          ),
          "outer.ts": counted("outer", `const lazy = await import("./lazy"); export const read = () => lazy.read();`),
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./outer";
          test("outer.ts gets lazy.ts, which has called nothing", () => expect(read).toBeFunction());
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { read } from "./outer";
          mock.module("./flags", () => ({ enabled: "mock" }));
          test("lazy.ts gets the mock", async () => expect(await read()).toBe("mock"));
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./outer";
          test("both have run again", async () => {
            expect([await read(), globalThis.runs]).toEqual(["real", { lazy: 2, outer: 2 }]);
          });
        `,
        },
        3,
      );
    });

    // lazy.cjs and lazyPage.ts go as on main: require.cache lists what each requires. What got them through import() before the mocks
    // is listed nowhere.
    test("what holds a module that required the mock goes with it, though it got that module before the mock", async () => {
      await expectFixturesToPass(
        {
          "flags.cjs": `exports.enabled = "real";`,
          "lazy.cjs": `let flags; exports.read = () => (flags ??= require("./flags.cjs")).enabled;`,
          "byImport.ts": `const lazy = await import("./lazy.cjs"); export const read = () => lazy.read();`,
          "prefs.ts": `export const theme = "real";`,
          "page.ts": `import { theme } from "./prefs"; export const render = () => theme;`,
          // The first require() for an ES module.
          "lazyPage.ts": `let page; export const read = () => (page ??= require("./page")).render();`,
          "byImportOfRequirer.ts": `const lazyPage = await import("./lazyPage"); export const read = () => lazyPage.read();`,
          "1.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { read as byImport } from "./byImport";
          import { read as byImportOfRequirer } from "./byImportOfRequirer";
          mock.module("./flags.cjs", () => ({ enabled: "mock" }));
          mock.module("./prefs", () => ({ theme: "mock" }));
          test("each requires a mock", () => {
            // The file requires flags.cjs first, so lazy.cjs finds it in require.cache.
            expect(require("./flags.cjs").enabled).toBe("mock");
            expect([byImport(), byImportOfRequirer()]).toEqual(["mock", "mock"]);
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { read as byImport } from "./byImport";
          import { read as byImportOfRequirer } from "./byImportOfRequirer";
          test("each requires the real module", () => expect([byImport(), byImportOfRequirer()]).toEqual(["real", "real"]));
        `,
        },
        2,
      );
    });

    // lazy.ts leaves the registry when 1.test.ts ends, and outer.ts keeps it. It is that lazy.ts which calls in 2.test.ts.
    test("a module that has left the registry still calls, and what holds it goes", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "other.ts": `export const other = "real";`,
          "lazy.ts": `
          import "./other";
          let flags;
          export const read = async () => (flags ??= await import("./flags")).enabled;
        `,
          "outer.ts": counted("outer", `const lazy = await import("./lazy"); export const read = () => lazy.read();`),
          "1.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { read } from "./outer";
          mock.module("./other", () => ({ other: "mock" }));
          test("a mock of a module that lazy.ts imports", () => expect(read).toBeFunction());
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { read } from "./outer";
          test("the lazy.ts that outer.ts keeps gets a mock", async () => {
            mock.module("./flags", () => ({ enabled: "mock" }));
            expect([await read(), globalThis.runs.outer]).toEqual(["mock", 1]);
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./outer";
          test("outer.ts has run again", async () => expect([await read(), globalThis.runs.outer]).toEqual(["real", 2]));
        `,
        },
        3,
      );
    });

    // view.ts got counter.ts in 1.test.ts, after that file had loaded both again. With counter.ts alone gone, 3.test.ts would have two.
    test("what holds a caller goes with it after jest.resetModules() loaded both again", async () => {
      await expectFixturesToPass(
        {
          "settings.ts": `export const step = 1;`,
          "counter.ts": `
          let n = 0;
          export const bump = async () => (n += (await import("./settings")).step);
          export const count = () => n;
        `,
          "view.ts": `let counter; export const shown = async () => (counter ??= await import("./counter")).count();`,
          "1.test.ts": `
          import { beforeEach, expect, jest, test } from "bun:test";
          beforeEach(() => { jest.resetModules(); });
          test.each([1, 2])("a fresh view shows 0 (%d)", async () => expect(await (await import("./view")).shown()).toBe(0));
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { bump } from "./counter";
          import { shown } from "./view";
          test("the counter takes the step of the mock", async () => {
            mock.module("./settings", () => ({ step: 10 }));
            expect([await bump(), await shown()]).toEqual([10, 10]);
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { bump, count } from "./counter";
          import { shown } from "./view";
          test("the view shows the counter of this file", async () => expect([await bump(), await shown(), count()]).toEqual([1, 1, 1]));
        `,
        },
        4,
      );
    });

    // vi.doMock() registers the loaded bus.ts and reader.ts under another key while their mocks stand.
    test("a module that vi.doMock() has set aside goes like one that is not mocked", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "reader.ts": counted(
            "reader",
            `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
          ),
          // Got the reader before vi.doMock() set it aside, so under the key that the reader has again when the mock ends.
          "outer.ts": `const reader = await import("./reader"); export const read = () => reader.read();`,
          "config.ts": `export const verbose = false;`,
          "bus.ts": `
          const listeners = [];
          export const on = listener => { listeners.push(listener); };
          export const emit = async event => {
            await import("./config");
            for (const listener of listeners) listener(event);
          };
        `,
          "db.ts": `import { emit } from "./bus"; export const save = row => emit("saved " + row);`,
          "outerDb.ts": `const db = await import("./db"); export const save = row => db.save(row);`,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./reader";
          import { read as readThroughOuter } from "./outer";
          import { save } from "./db";
          import "./outerDb";
          test("the reader calls for a mock, and is mocked itself", async () => {
            vi.doMock("./flags", () => ({ enabled: "mock" }));
            expect([await read(), await readThroughOuter()]).toEqual(["mock", "mock"]);
            vi.doMock("./reader", () => ({ read: async () => "a mock of the reader" }));
            expect(await (await import("./reader")).read()).toBe("a mock of the reader");
          });
          test("the bus calls for a mock, and what imports it is mocked", async () => {
            vi.doMock("./config", () => ({ verbose: true }));
            vi.doMock("./db", () => ({ save: async () => "a mock of the db" }));
            await save("a");
            expect(await (await import("./db")).save("b")).toBe("a mock of the db");
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./reader";
          import { read as readThroughOuter } from "./outer";
          import { on } from "./bus";
          import { save } from "./db";
          import { save as saveThroughOuter } from "./outerDb";
          test("the reader has run again, and the db saves to the bus of this file", async () => {
            const heard = [];
            on(event => heard.push(event));
            await save("c");
            await saveThroughOuter("d");
            expect([await read(), await readThroughOuter(), globalThis.runs.reader]).toEqual(["real", "real", 2]);
            expect(heard).toEqual(["saved c", "saved d"]);
          });
        `,
        },
        3,
      );
    });

    // The reader of 2.test.ts is loaded after the one of 1.test.ts went, gets a mock, is set aside and comes back under its key.
    test("a module that vi.doMock() set aside is as old under its key as it was before", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "reader.ts": `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./reader";
          test("the reader gets a mock, and goes when the file ends", async () => {
            vi.doMock("./flags", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
          });
        `,
          "2.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./reader";
          test("the next reader gets a mock, is mocked itself, and is not any more", async () => {
            vi.doMock("./flags", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
            vi.doMock("./reader", () => ({ read: async () => "a mock of the reader" }));
            expect(await (await import("./reader")).read()).toBe("a mock of the reader");
            vi.doUnmock("./reader");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./reader";
          test("the reader gets the real module", async () => expect(await read()).toBe("real"));
        `,
        },
        3,
      );
    });

    // While vi.mock() mocks dep for the test file, the kit gets the real dep, under the key that vi.mock() sets a loaded package aside under.
    test("what got a package while vi.mock() mocked it holds the package", async () => {
      const packageOf = (name: string) =>
        `{ "name": "${name}", "version": "1.0.0", "type": "module", "main": "index.js" }`;
      await expectFixturesToPass(
        {
          "node_modules/kit/package.json": packageOf("kit"),
          "node_modules/kit/index.js": `let dep; export const shown = async () => (dep ??= await import("dep")).count();`,
          "node_modules/dep/package.json": packageOf("dep"),
          "node_modules/dep/index.js": `
          let n = 0;
          export const bump = async () => (n += (await import("opt")).step);
          export const count = () => n;
        `,
          "node_modules/opt/package.json": packageOf("opt"),
          "node_modules/opt/index.js": `export const step = 1;`,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { count } from "dep";
          import { shown } from "kit";
          vi.mock("dep", () => ({ count: () => "a mock" }));
          test("the file gets the mock of dep, and the kit the real dep", async () => {
            expect([count(), await shown()]).toEqual(["a mock", 0]);
          });
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { bump } from "dep";
          import { shown } from "kit";
          test("dep takes the step of a mock", async () => {
            mock.module("opt", () => ({ step: 10 }));
            expect([await bump(), await shown()]).toEqual([10, 10]);
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { bump, count } from "dep";
          import { shown } from "kit";
          test("the kit shows the dep of this file", async () => expect([await bump(), await shown(), count()]).toEqual([1, 1, 1]));
        `,
        },
        3,
      );
    });

    // What each gets is the file in __mocks__, which imports the mock of dep.ts.
    test("a module that got a manual mock through vi.importMock() or jest.requireMock() is evaluated again", async () => {
      const imports = `
      import { read as byImportMock } from "./byImportMock";
      import { read as byRequireMock } from "./byRequireMock";
    `;
      await expectFixturesToPass(
        {
          "dep.ts": `export const dep = "real";`,
          "flags.ts": `export const enabled = () => "the real flags";`,
          "__mocks__/flags.ts": `import { dep } from "../dep"; export const enabled = () => "manual " + dep;`,
          "byImportMock.ts": `
          import { vi } from "bun:test";
          let mocked;
          export const read = async () => (mocked ??= await vi.importMock("./flags")).enabled();
        `,
          "byRequireMock.ts": `
          import { jest } from "bun:test";
          let mocked;
          export const read = () => (mocked ??= jest.requireMock("./flags")).enabled();
        `,
          "1.test.ts": `
          import { expect, jest, test, vi } from "bun:test";
          ${imports}
          vi.mock("./dep", () => ({ dep: "mock" }));
          test("each gets the mock of dep.ts", async () => {
            // The file requires it first, so byRequireMock.ts finds it in require.cache.
            expect(jest.requireMock("./flags").enabled()).toBe("manual mock");
            expect([await byImportMock(), byRequireMock()]).toEqual(["manual mock", "manual mock"]);
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          ${imports}
          test("each gets the real dep.ts", async () => {
            expect([await byImportMock(), byRequireMock()]).toEqual(["manual real", "manual real"]);
          });
        `,
        },
        2,
      );
    });

    test("a module that called require() for a mocked builtin is evaluated again", async () => {
      const imports = `
      import { platform as byRequire } from "./byRequire";
      import { platform as byRequireInCommonJS } from "./byRequireInCommonJS.cjs";
    `;
      await expectFixturesToPass(
        {
          "byRequire.ts": `let os; export const platform = () => (os ??= require("node:os")).platform();`,
          "byRequireInCommonJS.cjs": `let os; exports.platform = () => (os ??= require("node:os")).platform();`,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          ${imports}
          vi.mock("node:os", () => ({ platform: () => "mock" }));
          test("each gets the mock", () => expect([byRequire(), byRequireInCommonJS()]).toEqual(["mock", "mock"]));
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          ${imports}
          test("each gets the builtin", () => {
            expect([byRequire(), byRequireInCommonJS()]).toEqual([process.platform, process.platform]);
          });
        `,
        },
        2,
      );
    });

    // What each gets is the real flags.ts, which imports the mock of dep.ts.
    test("a module that called vi.importActual() or jest.requireActual() for a mocked module is evaluated again", async () => {
      const imports = `
      import { read as byImportActual } from "./byImportActual";
      import { read as byRequireActual } from "./byRequireActual";
    `;
      await expectFixturesToPass(
        {
          "dep.ts": `export const dep = "real";`,
          "flags.ts": `import { dep } from "./dep"; export const enabled = () => dep;`,
          "byImportActual.ts": `
          import { vi } from "bun:test";
          let actual;
          export const read = async () => (actual ??= await vi.importActual("./flags")).enabled();
        `,
          "byRequireActual.ts": `
          import { jest } from "bun:test";
          let actual;
          export const read = () => (actual ??= jest.requireActual("./flags")).enabled();
        `,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          ${imports}
          vi.mock("./flags", () => ({ enabled: () => "a mock of the flags" }));
          vi.mock("./dep", () => ({ dep: "mock" }));
          test("each gets the mock of dep.ts", async () => expect([await byImportActual(), byRequireActual()]).toEqual(["mock", "mock"]));
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          ${imports}
          test("each gets the real modules", async () => expect([await byImportActual(), byRequireActual()]).toEqual(["real", "real"]));
        `,
        },
        2,
      );
    });

    test.each([
      ["when the file ends", `mock.module("./flags", factory);`, ""],
      ["while the file runs", `vi.doMock("./flags", factory);`, `vi.doUnmock("./flags");`],
    ])("the callers of a mock go though nothing is loaded under its key %s", async (_, mockIt, unmockIt) => {
      await expectFixturesToPass(
        {
          "flags.ts": readers["flags.ts"],
          "byLaterRequire.ts": readers["byLaterRequire.ts"],
          "plain.cjs": readers["plain.cjs"],
          "1.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          const factory = () => ({ enabled: "mock" });
          test("the reader requires the mock, and the test takes it out of require.cache", async () => {
            ${mockIt}
            expect(require("./flags").enabled).toBe("mock");
            expect((await import("./byLaterRequire")).read()).toBe("mock");
            delete require.cache[require.resolve("./flags")];
            ${unmockIt}
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          test("the reader requires the real module", async () => expect((await import("./byLaterRequire")).read()).toBe("real"));
        `,
        },
        2,
      );
    });

    // lazy.ts gets the mock of flags.ts and keeps it. The mock of other.ts takes lazy.ts out of the registry, and outer.ts keeps it.
    test("what holds a caller goes when the file ends, though the caller left the registry before", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "other.ts": `export const other = "real";`,
          "lazy.ts": `
          import "./other";
          let flags;
          export const read = async () => (flags ??= await import("./flags")).enabled;
        `,
          "outer.ts": `const lazy = await import("./lazy"); export const read = () => lazy.read();`,
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./outer";
          test("outer.ts gets lazy.ts, which has called nothing", () => expect(read).toBeFunction());
        `,
          "2.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./outer";
          test("lazy.ts gets a mock that ends, and leaves with another", async () => {
            vi.doMock("./flags", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
            vi.doUnmock("./flags");
            vi.doMock("./other", () => ({ other: "mock" }));
            expect(await read()).toBe("mock");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./outer";
          test("outer.ts gets the real module", async () => expect(await read()).toBe("real"));
        `,
        },
        3,
      );
    });

    // The first caller.ts goes with vi.resetModules(). The second is loaded after the call of the first, and before its own.
    test("a caller of two mocks that ended goes if it is as old as the later call", async () => {
      await expectFixturesToPass(
        {
          "one.ts": `export const one = "real";`,
          "two.ts": `export const two = "real";`,
          "caller.ts": `
          let one, two;
          export const readOne = async () => (one ??= await import("./one")).one;
          export const readTwo = async () => (two ??= await import("./two")).two;
        `,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("one caller.ts gets a mock that ends, and the next another", async () => {
            vi.doMock("./one", () => ({ one: "mock" }));
            expect(await (await import("./caller")).readOne()).toBe("mock");
            vi.doUnmock("./one");
            vi.resetModules();
            vi.doMock("./two", () => ({ two: "mock" }));
            expect(await (await import("./caller")).readTwo()).toBe("mock");
            vi.doUnmock("./two");
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { readOne, readTwo } from "./caller";
          test("caller.ts gets the real modules", async () => expect([await readOne(), await readTwo()]).toEqual(["real", "real"]));
        `,
        },
        2,
      );
    });

    // page.ts imports the mock of flags.ts by a statement. The mock of other.ts takes it out, and shell.ts keeps it.
    test("a caller of a module that a later mock of the file takes out goes when the file ends", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "other.ts": `export const other = "real";`,
          "shared.ts": `import { other } from "./other"; export const name = () => other;`,
          "page.ts": `import { enabled } from "./flags"; import "./shared"; export const read = () => enabled;`,
          "shell.ts": `let page; export const read = async () => (page ??= await import("./page")).read();`,
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { name } from "./shared";
          test("an earlier file loads shared.ts", () => expect(name()).toBe("real"));
        `,
          "2.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./shell";
          test("the shell gets the page with a mock, and the file mocks what shared.ts imports", async () => {
            vi.doMock("./flags", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
            vi.doMock("./other", () => ({ other: "mock" }));
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./shell";
          test("the shell gets the real page", async () => expect(await read()).toBe("real"));
        `,
        },
        3,
      );
    });

    // The end of a test file takes a module that a mock set aside like one that the file loaded. The next file that sets it aside keeps
    // it while it runs, as the first did.
    test("a module that a later file sets aside stays while that file runs", async () => {
      const file = `
      import { beforeEach, expect, test, vi } from "bun:test";
      beforeEach(() => { vi.resetModules(); });
      test("the module that vi.doMock() set aside is what vi.importActual() gives", async () => {
        vi.doMock("./inner", () => ({ inner: "mock" }));
        const outer = await import("./outer");
        vi.doMock("./outer", () => ({ outer: "a mock of outer.ts" }));
        vi.doUnmock("./inner");
        expect((await vi.importActual("./outer")) === outer).toBe(true);
      });
    `;
      await expectFixturesToPass(
        {
          "inner.ts": `export const inner = "real";`,
          "outer.ts": `import { inner } from "./inner"; export const outer = inner;`,
          "1.test.ts": file,
          "2.test.ts": file,
        },
        2,
      );
    });

    test.each([
      [
        "the file reset the modules",
        "reader.ts",
        `let flags; export const read = async () => (flags ??= await import("./flags.ts")).enabled;`,
        `vi.resetModules();`,
      ],
      [
        "the mock that it required ended while the file ran",
        "reader.cjs",
        `let flags; exports.read = () => (flags ??= require("./flags.ts")).enabled;`,
        `vi.doUnmock("./flags.ts");`,
      ],
    ])("a module that vi.doMock() set aside goes when the file ends, though %s", async (_, reader, text, then) => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          [reader]: text,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./${reader}";
          test("the reader is set aside, and gets a mock", async () => {
            vi.doMock("./${reader}", () => ({ read: () => "a mock of the reader" }));
            vi.doMock("./flags.ts", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
            ${then}
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./${reader}";
          test("the reader gets the real module", async () => expect(await read()).toBe("real"));
        `,
        },
        2,
      );
    });

    // n.ts goes when 1.test.ts ends, for its call under the mock. The widgets get the n.ts of 2.test.ts, which called nothing.
    test("what got only the module that was loaded again holds nothing of the one that went", async () => {
      await expectFixturesToPass(
        {
          "x.ts": `export const x = "real";`,
          "y.ts": `export const y = "real";`,
          "k.ts": `export const readY = async () => (await import("./y")).y;`,
          "n.ts": `
          export const readX = async () => (await import("./x")).x;
          export const getK = () => import("./k");
        `,
          "node_modules/widgets/package.json": `{ "name": "widgets", "version": "1.0.0", "type": "module", "main": "index.js" }`,
          "node_modules/widgets/index.js": `
          if (globalThis.widgetsAreDefined) throw new Error("the widgets are already defined");
          globalThis.widgetsAreDefined = true;
          export const render = async file => typeof (await import(file)).readX;
        `,
          "1.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { getK, readX } from "./n";
          test("n.ts calls under a mock, and for k.ts", async () => {
            mock.module("./x", () => ({ x: "mock" }));
            expect([await readX(), await (await getK()).readY()]).toEqual(["mock", "real"]);
          });
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { render } from "widgets";
          import { readY } from "./k";
          test("the widgets get the next n.ts, and k.ts calls under a mock", async () => {
            expect(await render(import.meta.dir + "/n.ts")).toBe("function");
            mock.module("./y", () => ({ y: "mock" }));
            expect(await readY()).toBe("mock");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { render } from "widgets";
          test("the widgets are still loaded", async () => expect(await render(import.meta.dir + "/n.ts")).toBe("function"));
        `,
        },
        3,
      );
    });

    // db.ts got the real bus.ts before either was mocked. While the file runs nothing takes it out, and when the file ends only a call
    // would: it comes back as it was.
    test("a module that vi.doMock() set aside stays where only import statements lead to it", async () => {
      await expectFixturesToPass(
        {
          "bus.ts": `export const emit = event => event;`,
          "db.ts": counted("db", `import { emit } from "./bus"; export const save = row => emit("saved " + row);`),
          "plain.ts": `export const plain = true;`,
          // So that the run keeps a call.
          "helper.ts": `export const load = () => import("./plain");`,
          "1.test.ts": `
          import { expect, mock, test, vi } from "bun:test";
          import { save } from "./db";
          import { load } from "./helper";
          test("the db and the bus are mocked", async () => {
            expect(save("a")).toBe("saved a");
            vi.doMock("./db", () => ({ save: () => "a mock of the db" }));
            mock.module("./bus", () => ({ emit: () => "a mock of the bus" }));
            expect([(await import("./db")).save("b"), (await load()).plain]).toEqual(["a mock of the db", true]);
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { save } from "./db";
          test("the db has run once", () => expect([save("c"), globalThis.runs.db]).toEqual(["saved c", 1]));
        `,
        },
        2,
      );
    });

    // The package is one of those that vi.mock() does not leave to Node: an ES module in a package without "type". It imports dep by a
    // statement, and got the real dep before either was mocked.
    test("a package that vi.mock() set aside stays where only import statements lead to it", async () => {
      const file = `
      import { expect, test, vi } from "bun:test";
      import { greet, name } from "pkg";
      import { load } from "./helper";
      vi.mock("pkg", async () => ({ ...(await vi.importActual("pkg")), greet: () => "a mock" }));
      vi.mock("dep", () => ({ version: "mock" }));
      test("the package is mocked in part, and has run once", async () => {
        expect([greet(), name, (await load()).plain]).toEqual(["a mock", "pkg 1.0", true]);
      });
    `;
      await expectFixturesToPass(
        {
          "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js" }`,
          "node_modules/pkg/index.js": `
          import { version } from "dep";
          if (globalThis.pkgIsRegistered) throw new Error("pkg is already registered");
          globalThis.pkgIsRegistered = true;
          export const name = "pkg " + version;
          export const greet = () => "hello";
        `,
          "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
          "node_modules/dep/index.js": `export const version = "1.0";`,
          "plain.ts": `export const plain = true;`,
          // So that the run keeps a call.
          "helper.ts": `export const load = () => import("./plain");`,
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { greet } from "pkg";
          test("the real package", () => expect(greet()).toBe("hello"));
        `,
          "2.test.ts": file,
          "3.test.ts": file,
        },
        3,
      );
    });

    // While vi.doMock() mocks dep for the test file, the kit gets the real dep, and keeps no mock when the mock is made again.
    test("a package that got the real package stays when the mock of that package ends while the file runs", async () => {
      const packageOf = (name: string) =>
        `{ "name": "${name}", "version": "1.0.0", "type": "module", "main": "index.js" }`;
      await expectFixturesToPass(
        {
          "node_modules/kit/package.json": packageOf("kit"),
          "node_modules/kit/index.js": `
          if (globalThis.kitIsRegistered) throw new Error("kit is already registered");
          globalThis.kitIsRegistered = true;
          export const shown = async () => (await import("dep")).count();
        `,
          "node_modules/dep/package.json": packageOf("dep"),
          "node_modules/dep/index.js": `export const count = () => 0;`,
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { shown } from "kit";
          test.each(["one", "two"])("dep is mocked (%s), and the kit gets the real dep", async count => {
            vi.doMock("dep", () => ({ count: () => count }));
            expect([(await import("dep")).count(), await shown()]).toEqual([count, 0]);
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { shown } from "kit";
          test("the kit has run once", async () => expect(await shown()).toBe(0));
        `,
        },
        3,
      );
    });

    // A program that reads module.children gets an array, and a module that is required again is not added to it a second time.
    test("a module whose list of children the program has read is not taken for a caller at each end of a file", async () => {
      await expectFixturesToPass(
        {
          "registry.cjs": `exports.registry = { name: "real" };`,
          "readsChildrenOfParent.cjs": `module.parent.children;`,
          "service.ts": counted(
            "service",
            `
          require("./readsChildrenOfParent.cjs");
          let registry;
          export const start = () => (registry ??= require("./registry.cjs").registry);
          export const current = () => registry;
        `,
          ),
          // The file requires the module first, so service.ts finds it in require.cache.
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { start } from "./service";
          test("the service starts", () => {
            require("./registry.cjs");
            expect(start().name).toBe("real");
          });
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("another file mocks the module for itself", () => {
            mock.module("./registry.cjs", () => ({ registry: { name: "mock" } }));
            expect(require("./registry.cjs").registry.name).toBe("mock");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { current } from "./service";
          test("the service is as it was", () => expect([current().name, globalThis.runs.service]).toEqual(["real", 1]));
        `,
        },
        3,
      );
    });

    // r.cjs goes with the mock that it requires, and the test file with r.cjs: require.cache lists both links. A record of the calls of
    // other modules changes nothing of that.
    test("the test file goes where require.cache leads to it, as it does without a record of calls", async () => {
      await expectFixturesToPass(
        {
          "flags.cjs": `exports.enabled = "real";`,
          "requirer.cjs": `const flags = require("./flags.cjs"); exports.read = () => flags.enabled;`,
          "plain.cjs": `module.exports = {};`,
          "other.ts": `export const plain = require("./plain.cjs");`,
          "1.test.ts": `
          import { expect, mock, test } from "bun:test";
          import "./other";
          const first = (globalThis.runsOfFirstFile = (globalThis.runsOfFirstFile ?? 0) + 1) === 1;
          if (first) mock.module("./flags.cjs", () => ({ enabled: "mock" }));
          const requirer = require("./requirer.cjs");
          export const read = () => requirer.read();
          if (first) test("requirer.cjs requires the mock", () => expect(read()).toBe("mock"));
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          test("a file that imports the first file evaluates it again", async () => {
            const first = await import("./1.test.ts");
            expect([first.read(), globalThis.runsOfFirstFile]).toEqual(["real", 2]);
          });
        `,
        },
        2,
      );
    });

    // JSMock__replaceModuleOfTestFile() leaves the exports of the file in its place. Were the file taken out with lazy.ts, 2.test.ts would run it again.
    test("the test file that holds a caller stays for a file that imports it", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": readers["flags.ts"],
          "byLazyImport.ts": readers["byLazyImport.ts"],
          "1.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { read } from "./byLazyImport";
          globalThis.runsOfFirstFile = (globalThis.runsOfFirstFile ?? 0) + 1;
          export const shared = "of the first file";
          test("the reader gets the mock", async () => {
            mock.module("./flags", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { shared } from "./1.test.ts";
          import { read } from "./byLazyImport";
          test("the first file has run once, and the reader gets the real module", async () => {
            expect([shared, globalThis.runsOfFirstFile, await read()]).toEqual(["of the first file", 1, "real"]);
          });
        `,
        },
        2,
      );
    });

    // The mock changes the exports of the loaded module and its end changes them back, so what service.ts got is as it was.
    test.each([
      [
        "import()",
        "registry.ts",
        `export const registry = { name: "real" };`,
        `(await import("./registry.ts")).registry`,
      ],
      ["require()", "registry.cjs", `exports.registry = { name: "real" };`, `require("./registry.cjs").registry`],
    ])("a module that called %s before the file made a mock keeps what it got", async (_, file, registry, load) => {
      await expectFixturesToPass(
        {
          [file]: registry,
          "service.ts": counted(
            "service",
            `let registry; export const start = async () => (registry ??= ${load}); export const current = () => registry;`,
          ),
          // The file requires the module first, so service.ts finds it in require.cache.
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { start } from "./service";
          test("the service starts", async () => {
            require("./${file}");
            expect((await start()).name).toBe("real");
          });
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("another file mocks the module for itself", async () => {
            mock.module("./${file}", () => ({ registry: { name: "mock" } }));
            expect((${load}).name).toBe("mock");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { current } from "./service";
          test("the service is as it was", () => expect([current().name, globalThis.runs.service]).toEqual(["real", 1]));
        `,
        },
        3,
      );
    });

    // The record of the calls is kept only where another file follows, so it may change nothing for the file that runs.
    test.each([[["./1.test.ts"]], [[]]])(
      "what got a mock that ended keeps it until the file ends, as where the file runs alone %j",
      async args => {
        await expectFixturesToPass(
          {
            "flags.ts": `export const enabled = "real";`,
            "lazy.ts": counted(
              "lazy",
              `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
            ),
            "1.test.ts": `
            import { expect, test, vi } from "bun:test";
            test("lazy.ts is the same module after the mock ends", async () => {
              vi.doMock("./flags", () => ({ enabled: "mock" }));
              const lazy = await import("./lazy");
              expect(await lazy.read()).toBe("mock");
              vi.doUnmock("./flags");
              expect([(await import("./lazy")) === lazy, await lazy.read(), globalThis.runs.lazy]).toEqual([true, "mock", 1]);
            });
          `,
            "2.test.ts": `
            import { expect, test } from "bun:test";
            import { read } from "./lazy";
            test("the next file loads it again", async () => expect([await read(), globalThis.runs.lazy]).toEqual(["real", 2]));
          `,
          },
          args.length ? 1 : 2,
          args,
        );
      },
    );

    test("a call that a module made under the mocks of one file says nothing of the mocks of the next", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "other.ts": `export const other = "real";`,
          "lazy.ts": counted(
            "lazy",
            `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
          ),
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./lazy";
          vi.mock("./other", () => ({ other: "mock" }));
          test("lazy.ts gets a module that no mock has changed", async () => expect(await read()).toBe("real"));
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          test("another file mocks that module for itself", async () => {
            mock.module("./flags", () => ({ enabled: "mock" }));
            expect((await import("./flags")).enabled).toBe("mock");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./lazy";
          test("lazy.ts is as it was", async () => expect([await read(), globalThis.runs.lazy]).toEqual(["real", 1]));
        `,
        },
        3,
      );
    });

    test("a module whose import() failed is not evaluated again", async () => {
      const optional = (runs: number) => `
      import { expect, test, vi } from "bun:test";
      import { found } from "./optional";
      vi.mock("./flags", () => ({ enabled: "mock" }));
      test("the module that tried has run once", async () => {
        expect([found, (await import("./flags")).enabled, globalThis.runs.optional]).toEqual([false, "mock", ${runs}]);
      });
    `;
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "throws.ts": `throw new Error("not today");`,
          "optional.ts": counted(
            "optional",
            `export const found = await import("./throws").then(() => true, () => false);`,
          ),
          "1.test.ts": optional(1),
          "2.test.ts": optional(1),
        },
        2,
      );
    });

    // The first both.ts is still in use in the test file, so nothing has collected it when the file ends.
    test.each([
      ["while the mock that it required stays", ""],
      ["after the mock that it required", `vi.doUnmock("./two");`],
    ])("a module that is loaded again has made none of the calls of the one that went %s", async (_, unmockTwo) => {
      await expectFixturesToPass(
        {
          "one.ts": `export const one = "real";`,
          "two.ts": `export const two = "real";`,
          "both.ts": counted(
            "both",
            `import { one } from "./one"; export const readOne = () => one; export const requireTwo = () => require("./two").two;`,
          ),
          "1.test.ts": `
          import { expect, test, vi } from "bun:test";
          let first;
          test("both.ts requires one mock, leaves with the other, and is loaded again", async () => {
            vi.doMock("./one", () => ({ one: "mock" }));
            vi.doMock("./two", () => ({ two: "mock" }));
            expect(require("./two").two).toBe("mock");
            first = await import("./both");
            expect([first.readOne(), first.requireTwo()]).toEqual(["mock", "mock"]);
            ${unmockTwo}
            vi.doUnmock("./one");
            const second = await import("./both");
            expect([second === first, second.readOne(), globalThis.runs.both]).toEqual([false, "real", 2]);
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { readOne, requireTwo } from "./both";
          test("the one that is loaded has required no mock, and stays", () => {
            expect([readOne(), requireTwo(), globalThis.runs.both]).toEqual(["real", "real", 2]);
          });
        `,
        },
        2,
      );
    });

    // The usual way to give each test its own modules. The client.ts of the second test got the real module, and the keeper.ts of the
    // second test got that client.ts.
    test.each([
      ["imports it", `import { where } from "./client"; const client = () => ({ where });`],
      ["calls import() for it", `let got; const client = async () => (got ??= await import("./client"));`],
    ])(
      "a module that is loaded again after jest.resetModules() has made none of the calls of the one that went, nor has what %s",
      async (_, client) => {
        await expectFixturesToPass(
          {
            "env.ts": `export const region = "real";`,
            "client.ts": counted("client", `export const where = async () => (await import("./env")).region;`),
            "keeper.ts": `
            ${client}
            let asked = 0;
            export const ask = async () => (asked++, (await client()).where());
            export const total = () => asked;
          `,
            "1.test.ts": `
            import { beforeEach, expect, jest, test } from "bun:test";
            beforeEach(() => { jest.resetModules(); });
            test("the client calls under a mock", async () => {
              jest.doMock("./env", () => ({ region: "mock" }));
              expect(await (await import("./keeper")).ask()).toBe("mock");
              jest.dontMock("./env");
            });
            test("and the next client without one", async () => {
              const { ask, total } = await import("./keeper");
              expect([await ask(), total(), globalThis.runs.client]).toEqual(["real", 1, 2]);
            });
          `,
            "2.test.ts": `
            import { expect, test } from "bun:test";
            import { ask, total } from "./keeper";
            test("the modules of the last test are still loaded", async () => {
              expect([await ask(), total(), globalThis.runs.client]).toEqual(["real", 2, 2]);
            });
          `,
          },
          3,
        );
      },
    );

    // Each caller and each holder is loaded again after its call. The pass lists them one after another while it finds more.
    test("many modules that were loaded again after their calls stay", async () => {
      const pairs = Array.from({ length: 40 }, (_, i) => i);
      await expectFixturesToPass(
        {
          "env.ts": `export const region = "real";`,
          ...Object.fromEntries(
            pairs.flatMap(i => [
              [`caller${i}.ts`, `export const where = async () => (await import("./env")).region;`],
              [
                `holder${i}.ts`,
                counted(`holder${i}`, `export const where = async () => (await import("./caller${i}")).where();`),
              ],
            ]),
          ),
          "1.test.ts": `
          import { beforeEach, expect, jest, test } from "bun:test";
          beforeEach(() => { jest.resetModules(); });
          const holders = ${JSON.stringify(pairs.map(i => `./holder${i}`))};
          test("each holder gets a caller of the mock", async () => {
            jest.doMock("./env", () => ({ region: "mock" }));
            for (const holder of holders) expect(await (await import(holder)).where()).toBe("mock");
            jest.dontMock("./env");
          });
          test("and each holder is loaded again", async () => {
            for (const holder of holders) expect((await import(holder)).where).toBeFunction();
          });
        `,
          "2.test.ts": `
          import { expect, test } from "bun:test";
          import { where } from "./holder0";
          test("the holders of the last test are still loaded", async () => {
            expect([await where(), globalThis.runs.holder0, globalThis.runs.holder39]).toEqual(["real", 2, 2]);
          });
        `,
        },
        3,
      );
    });

    test("a module that calls again under a mock goes, though it called before the file made one too", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "reads.ts": counted(
            "reads",
            `let last; export const read = async () => (last = (await import("./flags")).enabled); export const lastRead = () => last;`,
          ),
          "1.test.ts": `
          import { expect, test } from "bun:test";
          import { read } from "./reads";
          test("reads.ts calls import() for the module", async () => expect(await read()).toBe("real"));
        `,
          "2.test.ts": `
          import { expect, mock, test } from "bun:test";
          import { read } from "./reads";
          test("and calls again under the mock", async () => {
            mock.module("./flags", () => ({ enabled: "mock" }));
            expect(await read()).toBe("mock");
          });
        `,
          "3.test.ts": `
          import { expect, test } from "bun:test";
          import { lastRead } from "./reads";
          test("it has run again", () => expect([lastRead(), globalThis.runs.reads]).toEqual([undefined, 2]));
        `,
        },
        3,
      );
    });

    // With --isolate=modules each file has a module graph of its own, and the runs of one file share it. a.test.ts has ended with its graph.
    test("a call that a module made in the module graph of another file says nothing in this one", async () => {
      await expectFixturesToPass(
        {
          "flags.ts": `export const enabled = "real";`,
          "lazy.ts": `let flags; export const read = async () => (flags ??= await import("./flags")).enabled;`,
          "loads.ts": counted("loads", `export const load = () => import("./lazy");`),
          "a.test.ts": `
          import { expect, test } from "bun:test";
          import { load } from "./loads";
          test("loads.ts calls import() for lazy.ts", async () => expect(await (await load()).read()).toBe("real"));
        `,
          "b.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { read } from "./lazy";
          import "./loads";
          vi.mock("./flags", () => ({ enabled: "mock " + (globalThis.mocks = (globalThis.mocks ?? 0) + 1) }));
          test("lazy.ts goes with the mock of each run, and loads.ts has called nothing here", async () => {
            expect([await read(), globalThis.runs.loads]).toEqual(["mock " + globalThis.mocks, 1]);
          });
        `,
        },
        4,
        ["--isolate=modules", "--rerun-each=2"],
      );
    });

    describe("the record of the calls", () => {
      const kept = `import { moduleCallsKeptForModuleMocks as kept } from "bun:internal-for-testing";`;
      const modules = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`m${i}.ts`, `export const n = ${i};`]));
      const imports = Object.keys(modules)
        .map(module => `import "./${module}";`)
        .join("\n");

      test("keeps one call for each pair of modules, and none of a test file", async () => {
        await expectFixturesToPass(
          {
            ...modules,
            "helper.ts": `export const load = i => import("./m" + i);`,
            "1.test.ts": `
            ${kept}
            import { expect, test } from "bun:test";
            import { load } from "./helper";
            test("what the file gets is its own to hold, and the helper calls twice for each of two modules", async () => {
              for (let i = 0; i < ${Object.keys(modules).length}; i++) await import("./m" + i);
              for (const i of [0, 1, 0, 1]) await load(i);
              expect(kept()).toBe(2);
            });
          `,
            // The hoisted mock makes an import() of each import of the file.
            "2.test.ts": `
            ${kept}
            import { expect, test, vi } from "bun:test";
            ${imports}
            import { load } from "./helper";
            vi.mock("./m0", () => ({ n: "mock" }));
            test("the calls stay while a module that may hold what it got is loaded", async () => {
              expect([(await load(0)).n, (await load(2)).n, kept()]).toEqual(["mock", 2, 3]);
            });
          `,
          },
          2,
        );
      });

      test.each([[["./1.test.ts"]], [["--isolate"]]])(
        "keeps none where no other load finds the modules of this one %j",
        async args => {
          const file = `
          ${kept}
          import { expect, test, vi } from "bun:test";
          import { load } from "./helper";
          vi.mock("./not-imported", () => ({}));
          test("none", async () => {
            expect([(await load(0)).n, (await load(1)).n, kept()]).toEqual([0, 1, 0]);
          });
        `;
          await expectFixturesToPass(
            {
              ...modules,
              "helper.ts": `export const load = i => import("./m" + i);`,
              "1.test.ts": file,
              "2.test.ts": file,
            },
            args[0].endsWith(".ts") ? 1 : 2,
            args,
          );
        },
      );
    });
  },
);
