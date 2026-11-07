import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("it will create a snapshot file if it doesn't exist", () => {
  expect({ a: { b: { c: false } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Boolean) } } });
  expect({ a: { b: { c: "string" } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(String) } } });
  expect({ a: { b: { c: 4 } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(Number) } } });
  expect({ a: { b: { c: 2n } }, c: 2, jkfje: 99238 }).toMatchSnapshot({ a: { b: { c: expect.any(BigInt) } } });
  expect({ a: new Date() }).toMatchSnapshot({ a: expect.any(Date) });
  expect({ j: 2, a: "any", b: "any2" }).toMatchSnapshot({ j: expect.any(Number), a: "any", b: expect.any(String) });
  expect({ j: /regex/, a: "any", b: "any2" }).toMatchSnapshot({
    j: expect.any(RegExp),
    a: "any",
    b: expect.any(String),
  });
});

test("ArrayBuffer values are serialized like typed arrays", () => {
  expect(new Uint8Array([1, 2, 3]).buffer).toMatchInlineSnapshot(`
    ArrayBuffer [
      1,
      2,
      3,
    ]
  `);
  expect({ a: 1, b: new Uint8Array([4, 5]).buffer }).toMatchInlineSnapshot(`
    {
      "a": 1,
      "b": ArrayBuffer [
        4,
        5,
      ],
    }
  `);
});

describe("toMatchSnapshot errors", () => {
  it("should throw if property matchers exist and received is not an object", () => {
    expect(() => {
      expect(1).toMatchSnapshot({ a: 1 });
    }).toThrow();
  });
  it("should throw if property matchers don't match", () => {
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: 1 });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(Date) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(String) });
    }).toThrow();
    expect(() => {
      expect({ a: 4n }).toMatchSnapshot({ a: expect.any(Number) });
    }).toThrow();
    expect(() => {
      expect({ a: 3 }).toMatchSnapshot({ a: expect.any(BigInt) });
    }).toThrow();
  });
  it("should throw if arguments are in the wrong order", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: "oops" }).toMatchSnapshot("wrong spot", { a: "oops" });
    }).toThrow();
    expect(() => {
      expect({ a: "oops" }).toMatchSnapshot({ a: "oops" }, "right spot");
    }).not.toThrow();
  });

  it("should throw if expect.any() doesn't received a constructor", () => {
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any() });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 5 }).toMatchSnapshot({ a: expect.any(5) });
    }).toThrow();
    expect(() => {
      // @ts-expect-error
      expect({ a: 4 }).toMatchSnapshot({ a: expect.any("not a constructor") });
    }).toThrow();
  });
});

// https://github.com/oven-sh/bun/issues/46051
describe("a snapshot file that bun test can't write", () => {
  const header = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const stored = header + '\nexports[`matches 1`] = `"a"`;\n';
  const unused = header + '\nexports[`no test has this name 1`] = `"b"`;\n';
  const withUnused = stored + '\nexports[`no test has this name 1`] = `"b"`;\n';
  const matches = `test("matches", () => { expect("a").toMatchSnapshot(); });`;
  const inline = `test("inline", () => { expect("a").toMatchInlineSnapshot(\`"a"\`); });`;
  const quoted = (name: string) => `"${join("__snapshots__", name + ".snap")}"`;

  // The modes are restored before `dir` is disposed, so that `rmSync` can remove the tree.
  function readOnly(files: Record<string, string>, directory: "read-only" | "writable" = "read-only") {
    const dir = tempDir("snapshot-read-only", files);
    const snapshots = join(String(dir), "__snapshots__");
    const names = Object.keys(files).filter(name => name.endsWith(".snap"));
    for (const name of names) chmodSync(join(String(dir), name), 0o444);
    // Windows has no write bit for a directory. There the read-only attribute of the file is what blocks the open.
    if (directory === "read-only" && !isWindows) chmodSync(snapshots, 0o555);
    return {
      dir: String(dir),
      has: (name = "a.test.js") => existsSync(join(snapshots, name + ".snap")),
      read: (name = "a.test.js") => readFileSync(join(snapshots, name + ".snap"), "utf8"),
      [Symbol.dispose]() {
        if (!isWindows) chmodSync(snapshots, 0o755);
        for (const name of names) if (existsSync(join(String(dir), name))) chmodSync(join(String(dir), name), 0o644);
        dir[Symbol.dispose]();
      },
    };
  }

  async function run(dir: string, ...args: string[]) {
    using unprivileged = unprivilegedSpawnOptions(dir);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, CI: "false" },
      cwd: dir,
      stdout: "ignore",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode };
  }

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial.each([[[]], [["--update-snapshots"]]])("a test whose snapshot matches passes (%j)", async args => {
    using fixture = readOnly({ "a.test.js": matches, "__snapshots__/a.test.js.snap": stored });
    const { stderr, exitCode } = await run(fixture.dir, ...args);
    expect(stderr).toContain(" 1 pass\n 0 fail\n");
    expect(fixture.read()).toBe(stored);
    expect(exitCode).toBe(0);
  });

  test.serial("a test whose snapshot differs fails on the difference", async () => {
    using fixture = readOnly({
      "a.test.js": matches.replace(`expect("a")`, `expect("another value")`),
      "__snapshots__/a.test.js.snap": stored,
    });
    const { stderr, exitCode } = await run(fixture.dir);
    expect(stderr).toContain("error: expect(received).toMatchSnapshot(expected)");
    expect(stderr).toContain(" 0 pass\n 1 fail\n");
    expect(fixture.read()).toBe(stored);
    expect(exitCode).toBe(1);
  });

  test.serial.each([
    ["adds a snapshot", `test("adds", () => { expect("b").toMatchSnapshot(); });`, []],
    ["changes a value with --update-snapshots", `test("matches", () => { expect("b").toMatchSnapshot(); });`, ["-u"]],
  ])("only the test that %s fails", async (_, test, args) => {
    using fixture = readOnly({
      "a.test.js": `test("ok", () => {});\n${test}`,
      "__snapshots__/a.test.js.snap": stored,
    });
    const { stderr, exitCode } = await run(fixture.dir, ...args);
    expect(stderr).toContain("error: Failed to open snapshot file for test file: ");
    expect(stderr).toContain(" 1 pass\n 1 fail\n");
    expect(fixture.read()).toBe(stored);
    expect(exitCode).toBe(1);
  });

  // No test changes the file here. The run removes entries from it after the tests of the file.
  const twoWithUnused = {
    "a.test.js": matches,
    "b.test.js": matches,
    "__snapshots__/a.test.js.snap": withUnused,
    "__snapshots__/b.test.js.snap": withUnused,
  };
  test.serial.each([[[]], [["--parallel=2"]]])(
    "--update-snapshots reports each file whose unused entries it can't remove (%j)",
    async args => {
      using fixture = readOnly(twoWithUnused);
      const { stderr, exitCode } = await run(fixture.dir, "--update-snapshots", ...args);
      expect(stderr).toMatch(/^E(ACCES|PERM): /m);
      for (const name of ["a.test.js", "b.test.js"]) {
        expect(stderr).toContain(`: Failed to remove the entries that no test uses from ${quoted(name)} (open)\n`);
      }
      expect(stderr).toContain(" 2 pass\n 0 fail\n 2 errors\n");
      // The summary counts no entry that the run could not remove.
      expect(stderr).not.toContain(" removed");
      expect([fixture.read("a.test.js"), fixture.read("b.test.js")]).toEqual([withUnused, withUnused]);
      expect(exitCode).toBe(1);
    },
  );

  // No test has this error, so the report has it as a failed test case of the test file.
  test.serial.each([[[]], [["--parallel=2"]]])(
    "--reporter=junit has each file whose unused entries --update-snapshots can't remove (%j)",
    async args => {
      using fixture = readOnly(twoWithUnused);
      const reporter = ["--reporter=junit", "--reporter-outfile=junit.xml"];
      const { exitCode } = await run(fixture.dir, "--update-snapshots", ...reporter, ...args);
      const report = readFileSync(join(fixture.dir, "junit.xml"), "utf8");
      const failure =
        /<testcase name="\(unhandled error\)"[^>]* file="([^"]*)"[^>]*>\s*<failure type="([^"]*)" message="([^"]*)"/g;
      expect(Array.from(report.matchAll(failure), match => match.slice(1)).sort()).toEqual(
        ["a.test.js", "b.test.js"].map(name => [
          name,
          expect.stringMatching(/^E(ACCES|PERM)$/),
          `Failed to remove the entries that no test uses from ${quoted(name).replaceAll('"', "&quot;")}`,
        ]),
      );
      expect(exitCode).toBe(1);
    },
  );

  // The second run of the file has the same entries to remove: the first one took none out of what it loaded.
  test.serial("--update-snapshots --rerun-each reports such a file in each run", async () => {
    using fixture = readOnly({ "a.test.js": matches, "__snapshots__/a.test.js.snap": withUnused });
    const { stderr, exitCode } = await run(fixture.dir, "--update-snapshots", "--rerun-each=2");
    const report = `: Failed to remove the entries that no test uses from ${quoted("a.test.js")} (open)\n`;
    expect(stderr.split(report).length - 1).toBe(2);
    expect(stderr).toContain(" 2 pass\n 0 fail\n 2 errors\n");
    expect(fixture.read()).toBe(withUnused);
    expect(exitCode).toBe(1);
  });

  // On Windows the file can be removed: libuv clears its read-only attribute.
  test.serial.skipIf(isWindows)(
    "--update-snapshots reports a file with no entry left that it can't remove",
    async () => {
      using fixture = readOnly({ "a.test.js": inline, "__snapshots__/a.test.js.snap": unused });
      const { stderr, exitCode } = await run(fixture.dir, "--update-snapshots");
      expect(stderr).toContain(
        `EACCES: Permission denied: Failed to remove the entries that no test uses from ${quoted("a.test.js")} (unlink)\n`,
      );
      expect(stderr).toContain(" 1 pass\n 0 fail\n 1 error\n 1 snapshots, 1 expect() calls\n");
      expect(fixture.read()).toBe(unused);
      expect(exitCode).toBe(1);
    },
  );

  // Jest and Vitest remove such a file too. To remove a file takes write access to its directory, not to the file.
  test.serial("--update-snapshots removes a read-only file with no entry left from a writable directory", async () => {
    using fixture = readOnly({ "a.test.js": inline, "__snapshots__/a.test.js.snap": unused }, "writable");
    const { stderr, exitCode } = await run(fixture.dir, "--update-snapshots");
    expect(stderr).toContain(" 1 pass\n 0 fail\nsnapshots: 1 passed, 1 removed\n");
    expect(fixture.has()).toBe(false);
    expect(exitCode).toBe(0);
  });

  test.serial("--update-snapshots keeps a read-only file after a test could not open it", async () => {
    using fixture = readOnly(
      {
        "a.test.js": `test("adds", () => { expect("b").toMatchSnapshot(); });`,
        "__snapshots__/a.test.js.snap": unused,
      },
      "writable",
    );
    const { stderr, exitCode } = await run(fixture.dir, "--update-snapshots");
    expect(stderr).toContain("error: Failed to open snapshot file for test file: ");
    expect(stderr).toContain(" 0 pass\n 1 fail\n");
    expect(fixture.read()).toBe(unused);
    expect(exitCode).toBe(1);
  });
});
