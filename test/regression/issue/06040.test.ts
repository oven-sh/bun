// https://github.com/oven-sh/bun/issues/6040
// spyOn()/mockImplementation() installed at the top level of one test file
// must be restored before the next test file runs.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTests(
  dir: string,
  tests: string[],
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Bare names are treated as filter patterns and run in discovery order;
  // explicit paths run in the order given, which these tests depend on.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs, ...tests.map(t => "./" + t)],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("spyOn is scoped to the test file that installed it", () => {
  const moduleSource = `
    export class MyClass {
      myMethod() { return "Hello"; }
    }
    export function greet() { return "Hello"; }
  `;

  test("a sibling file does not see another file's top-level spy", async () => {
    using dir = tempDir("spyon-per-file", {
      "MyModule.ts": moduleSource,
      "a.test.ts": `
        import { test, expect, spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "Hola");
        test("a sees mock", () => {
          expect(new MyClass().myMethod()).toBe("Hola");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("b sees real", () => {
          expect(new MyClass().myMethod()).toBe("Hello");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts", "b.test.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("spies on an ESM namespace binding are restored between files", async () => {
    using dir = tempDir("spyon-per-file-ns", {
      "MyModule.ts": moduleSource,
      "a.test.ts": `
        import { test, expect, spyOn } from "bun:test";
        import * as M from "./MyModule";
        spyOn(M, "greet").mockImplementation(() => "Hola");
        test("a sees mock", () => {
          expect(M.greet()).toBe("Hola");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import * as M from "./MyModule";
        test("b sees real", () => {
          expect(M.greet()).toBe("Hello");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts", "b.test.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("spies installed inside a test body are restored before the next file", async () => {
    using dir = tempDir("spyon-per-file-body", {
      "MyModule.ts": moduleSource,
      "a.test.ts": `
        import { test, expect, spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        test("a installs spy", () => {
          spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "Hola");
          expect(new MyClass().myMethod()).toBe("Hola");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("b sees real", () => {
          expect(new MyClass().myMethod()).toBe("Hello");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts", "b.test.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("a spy is still visible to later tests within the same file", async () => {
    using dir = tempDir("spyon-same-file", {
      "MyModule.ts": moduleSource,
      "a.test.ts": `
        import { test, expect, spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "Hola");
        test("first", () => {
          expect(new MyClass().myMethod()).toBe("Hola");
        });
        test("second", () => {
          expect(new MyClass().myMethod()).toBe("Hola");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("a spy installed in --preload persists across files", async () => {
    using dir = tempDir("spyon-preload", {
      "MyModule.ts": moduleSource,
      "preload.ts": `
        import { spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "FromPreload");
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("a sees preload mock", () => {
          expect(new MyClass().myMethod()).toBe("FromPreload");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("b sees preload mock", () => {
          expect(new MyClass().myMethod()).toBe("FromPreload");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts", "b.test.ts"], ["--preload", "./preload.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("a spy installed inside a preload beforeAll persists across files", async () => {
    // The spyOn() is after a macrotask await so the install runs from the
    // event loop after run_test_callback has returned, not in its sync prefix.
    using dir = tempDir("spyon-preload-beforeall", {
      "MyModule.ts": moduleSource,
      "preload.ts": `
        import { beforeAll, spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        beforeAll(async () => {
          await new Promise(r => setImmediate(r));
          spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "FromPreload");
        });
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("a sees preload mock", () => {
          expect(new MyClass().myMethod()).toBe("FromPreload");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("b sees preload mock", () => {
          expect(new MyClass().myMethod()).toBe("FromPreload");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts", "b.test.ts"], ["--preload", "./preload.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("a preload beforeAll on a file with no runnable tests does not mark the next file's spies persistent", async () => {
    using dir = tempDir("spyon-preload-stale-flag", {
      "MyModule.ts": moduleSource,
      "preload.ts": `
        import { beforeAll } from "bun:test";
        beforeAll(() => {});
      `,
      "a.test.ts": `
        import { test } from "bun:test";
        test.skip("a", () => {});
      `,
      "b.test.ts": `
        import { test, expect, spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "Hola");
        test("b", () => expect(new MyClass().myMethod()).toBe("Hola"));
      `,
      "c.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("c sees real", () => expect(new MyClass().myMethod()).toBe("Hello"));
      `,
    });

    const { stderr, exitCode } = await runTests(
      String(dir),
      ["a.test.ts", "b.test.ts", "c.test.ts"],
      ["--preload", "./preload.ts"],
    );
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("a top-level throw after installing a spy still restores it before the next file", async () => {
    using dir = tempDir("spyon-per-file-throw", {
      "MyModule.ts": moduleSource,
      "a.test.ts": `
        import { spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "Hola");
        throw new Error("boom");
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("b sees real", () => {
          expect(new MyClass().myMethod()).toBe("Hello");
        });
      `,
    });

    const { stderr } = await runTests(String(dir), ["a.test.ts", "b.test.ts"]);
    // a.test.ts fails because of the top-level throw; b.test.ts must still pass.
    expect(stderr).toContain("(pass) b sees real");
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain('Received: "Hola"');
  });

  test("a spy explicitly mockRestore()'d in its file is not double-restored", async () => {
    using dir = tempDir("spyon-explicit-restore", {
      "MyModule.ts": moduleSource,
      "a.test.ts": `
        import { test, afterAll, expect, spyOn } from "bun:test";
        import { MyClass } from "./MyModule";
        const spy = spyOn(MyClass.prototype, "myMethod").mockImplementation(() => "Hola");
        afterAll(() => { spy.mockRestore(); });
        test("a sees mock", () => {
          expect(new MyClass().myMethod()).toBe("Hola");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { MyClass } from "./MyModule";
        test("b sees real", () => {
          expect(new MyClass().myMethod()).toBe("Hello");
        });
      `,
    });

    const { stderr, exitCode } = await runTests(String(dir), ["a.test.ts", "b.test.ts"]);
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
