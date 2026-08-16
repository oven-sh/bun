import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test("BuildError is modifiable", async () => {
  try {
    await import("../util/inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    var error: BuildMessage = e as BuildMessage;
    if (error.name !== "BuildMessage") {
      throw new Error("Expected BuildMessage, got " + error.name);
    }
  }

  const message = error!.message;
  // @ts-ignore
  expect(() => (error!.message = "new message")).not.toThrow();
  expect(error!.message).toBe("new message");
  expect(error!.message).not.toBe(message);
});

test("import with many build errors keeps AggregateError entries alive across GC", async () => {
  // process_fetch_log accumulated the BuildMessage wrappers in a heap Vec
  // while creating the next ones; the conservative GC stack scan never saw
  // them, so a collection triggered mid-loop swept the earlier cells and
  // freed their native BuildMessage (use-after-free found by fuzzing).
  // 257 duplicate declarations produce 256 log messages, maximizing the
  // number of allocations between the first wrapper and the AggregateError.
  const dupes = Array.from({ length: 257 }, (_, i) => `const dup = ${i};`).join("\n");
  using dir = tempDir("build-error-gc", {
    "bad.js": dupes,
    "main.js": `
      const jobs = [];
      for (let i = 0; i < 16; i++) {
        jobs.push(
          import("./bad.js?v=" + i).then(
            () => {
              throw new Error("expected rejection");
            },
            e => {
              let n = 0;
              for (const err of e.errors ?? []) {
                if (typeof err.message === "string") n++;
              }
              return n;
            },
          ),
        );
      }
      const counts = await Promise.all(jobs);
      console.log(JSON.stringify(counts));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: "100" },
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr carries the crash report when the child dies; surface it in the
  // failure diff but don't assert on it (debug builds emit benign noise).
  if (exitCode !== 0) console.error(stderr);
  expect(stdout.trim()).toBe(JSON.stringify(Array.from({ length: 16 }, () => 256)));
  expect(exitCode).toBe(0);
});

test("BuildMessage finalize frees with the same allocator it was created with", async () => {
  // BuildMessage.create() clones the message with the passed allocator
  // but finalize() was freeing it with bun.default_allocator and never
  // destroying the struct itself.
  using dir = tempDir("build-message-finalize", { "bad.js": "function bad( {" });
  const entry = join(String(dir), "bad.js");
  for (let i = 0; i < 20; i++) {
    const r = await Bun.build({ entrypoints: [entry], throw: false });
    expect(r.success).toBe(false);
    expect(r.logs.length).toBeGreaterThan(0);
    for (const e of r.logs) {
      void e.message;
      void e.level;
      void e.position;
      void e.notes;
      void String(e);
    }
    Bun.gc(true);
  }
});

// The module loader settles every later load of a module that failed to load
// with the error object the first load produced, so the same BuildMessage or
// ResolveMessage is reported once per failure it causes. The error printer
// used to print such an object only the first time it saw it, so every report
// after the first (another test file importing the module, another test in
// the same file, the error being reported again by the program) was empty.
describe.concurrent("an error from a module that failed to load is printed every time it is reported", () => {
  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("replayed-load-error", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: normalizeBunSnapshot(stdout, String(dir)),
      stderr: normalizeBunSnapshot(stderr, String(dir)),
      exitCode,
    };
  }

  test("a build error, by each test file that imports the module", async () => {
    const { stderr, exitCode } = await run(
      {
        "bad.js": "function bad( {",
        "a.test.js": `import "./bad.js";`,
        "b.test.js": `import "./bad.js";`,
      },
      "test",
      "./a.test.js",
      "./b.test.js",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "a.test.js:

      # Unhandled error between tests
      -------------------------------
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      -------------------------------


      b.test.js:

      # Unhandled error between tests
      -------------------------------
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      -------------------------------


       0 pass
       2 fail
       2 errors
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("a resolve error, by each test file that imports the module", async () => {
    const { stderr, exitCode } = await run(
      {
        "lib.js": `import "./missing.js";`,
        "a.test.js": `import "./lib.js";`,
        "b.test.js": `import "./lib.js";`,
      },
      "test",
      "./a.test.js",
      "./b.test.js",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "a.test.js:

      # Unhandled error between tests
      -------------------------------
      error: Cannot find module './missing.js' from '<dir>/lib.js'
      -------------------------------


      b.test.js:

      # Unhandled error between tests
      -------------------------------
      error: Cannot find module './missing.js' from '<dir>/lib.js'
      -------------------------------


       0 pass
       2 fail
       2 errors
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("a build error, by each test that imports the module", async () => {
    const { stderr, exitCode } = await run(
      {
        "bad.js": "function bad( {",
        "c.test.js": /* js */ `
          import { test } from "bun:test";
          test("first", () => import("./bad.js"));
          test("second", () => import("./bad.js"));
        `,
      },
      "test",
      "./c.test.js",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "c.test.js:
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      (fail) first
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      (fail) second

       0 pass
       2 fail
      Ran 2 tests across 1 file."
    `);
    expect(exitCode).toBe(1);
  });

  test("a build error reported twice by the program", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "bad.js": "function bad( {",
        "entry.js": /* js */ `
          for (let i = 1; i <= 2; i++) {
            const error = await import("./bad.js").then(() => null, e => e);
            console.log("report " + i + ": " + error.constructor.name);
            reportError(error);
          }
        `,
      },
      "entry.js",
    );
    expect(stdout).toMatchInlineSnapshot(`
      "report 1: BuildMessage
      report 2: BuildMessage"
    `);
    expect(stderr).toMatchInlineSnapshot(`
      "1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15

      Bun v<bun-version>"
    `);
    expect(exitCode).toBe(1);
  });

  // Two or more build errors reject the load with one AggregateError holding a
  // BuildMessage per error, and printing it prints those members.
  test("the build errors of an AggregateError printed twice", async () => {
    const { stdout, exitCode } = await run(
      {
        "bad.js": "const dup = 1; const dup = 2; const dup = 3;",
        "entry.js": /* js */ `
          const error = await import("./bad.js").then(() => null, e => e);
          console.log(error.constructor.name);
          console.log(error);
          console.log(error.constructor.name);
          console.log(error);
        `,
      },
      "entry.js",
    );
    const errorLocations = (report: string) =>
      Array.from(report.matchAll(/^error: "dup" has already been declared\n\s+at (\S+)$/gm), match => match[1]);
    const [, firstReport, secondReport] = stdout.split(/^AggregateError$/m);
    expect([firstReport, secondReport].map(errorLocations)).toEqual([
      ["<dir>/bad.js:1:22", "<dir>/bad.js:1:37"],
      ["<dir>/bad.js:1:22", "<dir>/bad.js:1:37"],
    ]);
    expect(exitCode).toBe(0);
  });
});
