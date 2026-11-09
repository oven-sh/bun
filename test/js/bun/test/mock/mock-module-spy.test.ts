// `vi.mock(path, { spy: true })` replaces the methods of the objects that a module exports in place, so it spies on an instance of the module that it
// evaluates for itself. These tests are about that instance: when an earlier test file has loaded the module, what the mock leaves when it ends, and
// where the running file has the module already. They have a file of their own because mock-module.test.ts runs for over a minute on a debug build.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function expectFixturesToPass(files: Record<string, string>, pass: number, order: string[]) {
  using dir = tempDir("mock-module-spy", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...order],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
  expect(exitCode).toBe(0);
}

describe.concurrent("vi.mock(path, { spy: true })", () => {
  const db = `
    globalThis.loads = (globalThis.loads ?? 0) + 1;
    export class Database {
      static shared = new Database();
      #rows = "rows of ";
      query(sql) { return this.#rows + sql; }
    }
    export const db = new Database();
    export const services = { db: new Database() };
    export const list = [new Database()];
    export function ping() { return db.query("select 1"); }
  `;
  const earlier = `
    import { expect, test } from "bun:test";
    import { db, ping } from "./db";
    test("an earlier file loads the module", () => {
      expect(ping()).toBe("rows of select 1");
      globalThis.first = db;
    });
  `;

  test("spies on the instances of a module that an earlier test file loaded, in an instance that the file evaluates", async () => {
    await expectFixturesToPass(
      {
        "db.ts": db,
        "a.test.ts": earlier,
        "b.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { Database, db, list, ping, services } from "./db";
          vi.mock("./db", { spy: true });
          const loadsAfterCall = vi.hoisted(() => globalThis.loads);

          test("the module's own calls are recorded", () => {
            expect(ping()).toBe("rows of select 1");
            expect(ping).toHaveBeenCalledTimes(1);
            expect(db.query).toHaveBeenCalledWith("select 1");
          });

          test("wherever the instance is", () => {
            for (const instance of [services.db, list[0], Database.shared]) {
              expect(instance.query("x")).toBe("rows of x");
              expect(instance.query).toHaveBeenCalledWith("x");
            }
          });

          test("the module of the earlier file is the original", async () => {
            const actual = await vi.importActual("./db");
            expect([actual.db === first, db === first, vi.isMockFunction(first.query), Object.keys(first)]).toEqual([true, false, false, []]);
            // The call evaluated nothing, the import evaluated the module once, and vi.importActual() evaluated nothing.
            expect([loadsAfterCall, globalThis.loads]).toEqual([1, 2]);
          });
        `,
        "c.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { db, ping } from "./db";
          test("the next file gets the module of the earlier file, without spies", () => {
            expect([db === first, vi.isMockFunction(ping), vi.isMockFunction(db.query), Object.keys(db), globalThis.loads]).toEqual([true, false, false, [], 2]);
          });
        `,
      },
      5,
      ["./a.test.ts", "./b.test.ts", "./c.test.ts"],
    );
  });

  test("does so whichever way the file makes the call, and for every file in an instance of its own", async () => {
    // What a file configures is gone for the next one.
    const spiesOnDb = `
      test("the instance is spied on", () => {
        expect(db.query.mock.calls).toEqual([]);
        expect(ping()).toBe("rows of select 1");
        expect(db.query).toHaveBeenCalledWith("select 1");
        expect(db === first).toBe(false);
        db.query.mockReturnValue("left by this file");
      });
    `;
    await expectFixturesToPass(
      {
        "db.ts": db,
        "service.ts": `import { db } from "./db"; export const run = () => db.query("from service");`,
        "instance.cjs": `
          class Service {
            #secret = "secret";
            reveal() { return this.#secret; }
          }
          module.exports = new Service();
        `,
        "mocks.ts": `import { vi } from "vitest"; vi.mock("./db", { spy: true });`,
        "a.test.ts": `
          ${earlier}
          import { run } from "./service";
          import instance from "./instance.cjs";
          test("and the modules that import it", () => {
            expect([run(), instance.reveal()]).toEqual(["rows of from service", "secret"]);
            globalThis.firstInstance = instance;
          });
        `,
        "b-import-spelling.test.ts": `
          import { expect, test, vi } from "vitest";
          import { db, ping } from "./db";
          vi.mock(import("./db"), { spy: true });
          ${spiesOnDb}
        `,
        "c-below-an-await.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { db, ping } from "./db";
          const ready = await vi.hoisted(async () => (await null, true));
          vi.mock("./db", { spy: true });
          ${spiesOnDb}
        `,
        "d-in-a-module-imported-first.test.ts": `
          import { expect, test, vi } from "vitest";
          import "./mocks";
          import { db, ping } from "./db";
          ${spiesOnDb}
        `,
        "e-commonjs.test.cjs": `
          const { db, ping } = require("./db");
          vi.mock("./db", { spy: true });
          ${spiesOnDb}
        `,
        "f-through-another-module.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { db } from "./db";
          import { run } from "./service";
          vi.mock("./db", { spy: true });
          test("the instance is spied on for the module that imports it too", () => {
            expect(run()).toBe("rows of from service");
            expect(db.query.mock.calls).toEqual([["from service"]]);
          });
        `,
        "g-commonjs-exports.test.ts": `
          import { expect, test, vi } from "bun:test";
          import instance from "./instance.cjs";
          vi.mock("./instance.cjs", { spy: true });
          test("an instance that is the exports of a CommonJS module is spied on", () => {
            expect(instance.reveal()).toBe("secret");
            expect(instance.reveal).toHaveBeenCalledTimes(1);
            expect([instance === firstInstance, require("./instance.cjs") === instance]).toEqual([false, true]);
          });
        `,
        "h-below-a-mock-of-what-it-imports.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { run } from "./service";
          vi.mock("./service", { spy: true });
          vi.mock("./db", () => ({ db: { query: sql => "mocked rows of " + sql } }));
          test("the instance of the spied module imports the mock", () => {
            expect(run()).toBe("mocked rows of from service");
            expect(run).toHaveBeenCalledTimes(1);
          });
        `,
        "i-two-spied-modules.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { db } from "./db";
          import { run } from "./service";
          vi.mock("./service", { spy: true });
          vi.mock("./db", { spy: true });
          test("the instance of a spied module imports the spies of the other", () => {
            expect(run()).toBe("rows of from service");
            expect(run).toHaveBeenCalledTimes(1);
            expect(db.query.mock.calls).toEqual([["from service"]]);
          });
        `,
      },
      10,
      [
        "./a.test.ts",
        "./b-import-spelling.test.ts",
        "./c-below-an-await.test.ts",
        "./d-in-a-module-imported-first.test.ts",
        "./e-commonjs.test.cjs",
        "./f-through-another-module.test.ts",
        "./g-commonjs-exports.test.ts",
        "./h-below-a-mock-of-what-it-imports.test.ts",
        "./i-two-spied-modules.test.ts",
      ],
    );
  });

  test("evaluates the module at the first import, and vi.doUnmock() brings the earlier file's module back", async () => {
    await expectFixturesToPass(
      {
        "db.ts": db,
        "a.test.ts": earlier,
        "b.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./db", { spy: true });
          test("a mock that is removed before an import evaluates nothing", async () => {
            vi.doUnmock("./db");
            expect([(await import("./db")).db === first, globalThis.loads]).toEqual([true, 1]);
          });
        `,
        "c.test.ts": `
          import { expect, test, vi } from "bun:test";
          vi.mock("./db", { spy: true });
          test("a mock that nothing imports evaluates nothing", () => expect(globalThis.loads).toBe(1));
        `,
        "d.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { db, ping } from "./db";
          vi.mock("./db", { spy: true });
          test("what the file imported before vi.doUnmock() keeps its spies", async () => {
            vi.doUnmock("./db");
            const unmocked = await import("./db");
            expect([unmocked.db === first, vi.isMockFunction(unmocked.ping), vi.isMockFunction(ping), vi.isMockFunction(db.query)]).toEqual([true, false, true, true]);
            expect(globalThis.loads).toBe(2);
          });
        `,
        "e.test.ts": `
          import { expect, test, vi } from "bun:test";
          import { db } from "./db";
          vi.mock("./db", { spy: true });
          test("every import gets the same spies, also after vi.resetModules()", async () => {
            const mocked = await import("./db");
            expect([mocked.db === db, (await import("./db")) === mocked]).toEqual([true, true]);
            vi.resetModules();
            expect([(await import("./db")).db === db, globalThis.loads]).toEqual([true, 3]);
          });
        `,
      },
      5,
      ["./a.test.ts", "./b.test.ts", "./c.test.ts", "./d.test.ts", "./e.test.ts"],
    );
  });

  test("the instance that a file spied on is gone for the next file that spies, also with nothing loaded before", async () => {
    const spies = `
      import { expect, test, vi } from "bun:test";
      import { db, ping } from "./db";
      vi.mock("./db", { spy: true });
      test("the spies have no calls and call through", () => {
        expect([ping.mock.calls, db.query.mock.calls]).toEqual([[], []]);
        expect(ping()).toBe("rows of select 1");
        ping.mockReturnValue("left by this file");
        db.query.mockReturnValue("left by this file");
      });
    `;
    await expectFixturesToPass({ "db.ts": db, "b.test.ts": spies, "c.test.ts": spies }, 2, [
      "./b.test.ts",
      "./c.test.ts",
    ]);
  });

  // Where the file has the module already, the call updates the loaded module in place, as it does when no earlier file loaded it.
  test("a call made after the file has the module does the same alone and after an earlier file", async () => {
    const shapes: [string, string, (db: string, mocks: string, log: string) => string][] = [
      [
        "a call in a block",
        "ts",
        (db, _, log) =>
          `import { test, vi } from "bun:test";\nimport { db, ping } from "${db}";\n{ vi.mock("${db}", { spy: true }); }\ntest("logs", () => { ${log} });`,
      ],
      [
        "a call in a function that the file calls",
        "ts",
        (db, _, log) =>
          `import { test, vi } from "bun:test";\nimport { db, ping } from "${db}";\nfunction spy() { vi.mock("${db}", { spy: true }); }\nspy();\n${log}\ntest("logs", () => {});`,
      ],
      [
        "a call in a test",
        "ts",
        (db, _, log) =>
          `import { test, vi } from "bun:test";\nimport { db, ping } from "${db}";\ntest("logs", () => { vi.mock("${db}", { spy: true }); ${log} });`,
      ],
      [
        "a call in a test of a file whose imports run in turn",
        "ts",
        (db, _, log) =>
          `import { test, vi } from "vitest";\nimport { db, ping } from "${db}";\ntest("logs", () => { vi.mock("${db}", { spy: true }); ${log} });`,
      ],
      [
        "a call in a module that the file imports behind the module",
        "ts",
        (db, mocks, log) =>
          `import { test, vi } from "vitest";\nimport { db, ping } from "${db}";\nimport "${mocks}";\ntest("logs", () => { ${log} });`,
      ],
      [
        "a call in a test of a CommonJS file that required the module",
        "cjs",
        (db, _, log) =>
          `const held = require("${db}");\ntest("logs", () => { vi.mock("${db}", { spy: true }); const { db, ping } = held; ${log} });`,
      ],
      [
        "a call in a test of an ES module that required the module",
        "ts",
        (db, _, log) =>
          `import { test, vi } from "bun:test";\nconst held = require("${db}");\ntest("logs", () => { vi.mock("${db}", { spy: true }); const { db, ping } = held; ${log} });`,
      ],
    ];
    // Each shape has a module of its own, so that no shape loads the module of the next one.
    const files: Record<string, string> = {
      "a.test.ts": `import { test } from "bun:test";\n${shapes.map((_, i) => `import "./db${i}";`).join("\n")}\ntest("an earlier file loads the modules", () => {});`,
    };
    const order = shapes.map(([shape, extension, source], i) => {
      const log = `console.log(JSON.stringify({ shape: ${JSON.stringify(shape)}, ping: vi.isMockFunction(ping), instance: vi.isMockFunction(db.query) }));`;
      files[`db${i}.ts`] = db;
      files[`mocks${i}.ts`] = `import { vi } from "vitest"; vi.mock("./db${i}", { spy: true });`;
      files[`shape${i}.test.${extension}`] = source(`./db${i}`, `./mocks${i}`, log);
      return `./shape${i}.test.${extension}`;
    });
    const logged = async (order: string[]) => {
      using dir = tempDir("mock-module-spy", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...order],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { logged: stdout.split("\n").filter(line => line.startsWith("{")), stderr, exitCode };
    };
    const [alone, after] = await Promise.all([logged(order), logged(["./a.test.ts", ...order])]);
    expect(alone.stderr).toContain(` ${shapes.length} pass\n 0 fail\n`);
    expect(after.stderr).toContain(` ${shapes.length + 1} pass\n 0 fail\n`);
    expect(alone.logged.map(line => JSON.parse(line))).toEqual(
      shapes.map(([shape]) => expect.objectContaining({ shape, ping: true })),
    );
    expect(after.logged).toEqual(alone.logged);
    expect([alone.exitCode, after.exitCode]).toEqual([0, 0]);
  });
});
