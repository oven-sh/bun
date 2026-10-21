import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, unprivilegedSpawnOptions } from "harness";
import { chmodSync, readFileSync } from "node:fs";
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
describe("read-only snapshot file", () => {
  const HEADER = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";
  const STORED = HEADER + '\nexports[`matches 1`] = `\n{\n  "a": 1,\n}\n`;\n';

  // The modes are restored before `dir` is disposed, so that `rmSync` can remove the tree.
  function readOnlyDir(testSource: string) {
    const dir = tempDir("readonly-snapshot", {
      "snap.test.js": testSource,
      "__snapshots__/snap.test.js.snap": STORED,
    });
    const snapshotsDir = join(String(dir), "__snapshots__");
    const snapPath = join(snapshotsDir, "snap.test.js.snap");
    chmodSync(snapPath, 0o444);
    // Windows has no directory write bit. The read-only attribute of the file is what blocks the open.
    if (!isWindows) chmodSync(snapshotsDir, 0o555);
    return {
      dir,
      snapPath,
      [Symbol.dispose]() {
        if (!isWindows) chmodSync(snapshotsDir, 0o755);
        chmodSync(snapPath, 0o644);
        dir[Symbol.dispose]();
      },
    };
  }

  async function runTest(dir: string, ...extraArgs: string[]) {
    using unprivileged = unprivilegedSpawnOptions(dir);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "snap.test.js", ...extraArgs],
      env: { ...bunEnv, CI: "false" },
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      ...unprivileged,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { output: stdout + stderr, exitCode };
  }

  // Serial: `unprivilegedSpawnOptions` may change and restore the modes of directories above the test's own.
  test.serial("passes when the stored snapshot matches", async () => {
    using fixture = readOnlyDir(`
      import { expect, test } from "bun:test";
      test("matches", () => expect({ a: 1 }).toMatchSnapshot());
    `);
    const { output, exitCode } = await runTest(String(fixture.dir));
    expect(output).not.toContain("Failed to open snapshot file");
    expect(output).toMatch(/1 pass/);
    expect(output).toMatch(/0 fail/);
    expect(exitCode).toBe(0);
    expect(readFileSync(fixture.snapPath, "utf8")).toBe(STORED);
  });

  test.serial("fails when the stored snapshot differs", async () => {
    using fixture = readOnlyDir(`
      import { expect, test } from "bun:test";
      test("matches", () => expect({ a: 2 }).toMatchSnapshot());
    `);
    const { output, exitCode } = await runTest(String(fixture.dir));
    expect(output).not.toContain("Failed to open snapshot file");
    expect(output).toMatch(/0 pass/);
    expect(output).toMatch(/1 fail/);
    expect(exitCode).not.toBe(0);
    expect(readFileSync(fixture.snapPath, "utf8")).toBe(STORED);
  });

  test.serial("only the test that adds a snapshot fails", async () => {
    using fixture = readOnlyDir(`
      import { expect, test } from "bun:test";
      test("matches", () => expect({ a: 1 }).toMatchSnapshot());
      test("adds", () => expect({ b: 2 }).toMatchSnapshot());
    `);
    const { output, exitCode } = await runTest(String(fixture.dir));
    expect(output).toContain("Failed to open snapshot file");
    expect(output).toMatch(/1 pass/);
    expect(output).toMatch(/1 fail/);
    expect(exitCode).not.toBe(0);
    expect(readFileSync(fixture.snapPath, "utf8")).toBe(STORED);
  });

  // Guard: this passes on bun 1.4.3 too. It checks that the write open is not skipped under -u.
  test.serial("--update-snapshots still needs write access", async () => {
    using fixture = readOnlyDir(`
      import { expect, test } from "bun:test";
      test("matches", () => expect({ a: 1 }).toMatchSnapshot());
    `);
    const { output, exitCode } = await runTest(String(fixture.dir), "--update-snapshots");
    expect(output).toContain("Failed to open snapshot file");
    expect(output).toMatch(/1 fail/);
    expect(exitCode).not.toBe(0);
    expect(readFileSync(fixture.snapPath, "utf8")).toBe(STORED);
  });
});

describe.concurrent("snapshot file writes", () => {
  const HEADER = "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n";

  test("a .snap that fails to parse does not fail the next test file's snapshots", async () => {
    const stored = HEADER + '\nexports[`b 1`] = `\n{\n  "b": 1,\n}\n`;\n';
    using dir = tempDir("malformed-sibling-snapshot", {
      "a.test.js": `
        import { expect, test } from "bun:test";
        test("a", () => expect({ a: 1 }).toMatchSnapshot());
      `,
      "b.test.js": `
        import { expect, test } from "bun:test";
        test("b", () => expect({ b: 1 }).toMatchSnapshot());
      `,
      "__snapshots__/a.test.js.snap": HEADER + "\nexports[`a 1`] = `hello`goodbye`;\n",
      "__snapshots__/b.test.js.snap": stored,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "a.test.js", "b.test.js"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdout + stderr;
    expect(output).toMatch(/1 pass/);
    expect(output).toMatch(/1 fail/);
    expect(exitCode).not.toBe(0);
    expect(readFileSync(join(String(dir), "__snapshots__", "b.test.js.snap"), "utf8")).toBe(stored);
  });

  test("an aborted --update-snapshots run leaves the .snap as it was", async () => {
    const stored = HEADER + '\nexports[`matches 1`] = `\n{\n  "a": 1,\n}\n`;\n';
    using dir = tempDir("aborted-update-snapshots", {
      "snap.test.js": `
        import { expect, test } from "bun:test";
        test("matches", () => {
          expect({ a: 1 }).toMatchSnapshot();
          process.exit(3);
        });
      `,
      "__snapshots__/snap.test.js.snap": stored,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "snap.test.js", "--update-snapshots"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(3);
    expect(readFileSync(join(String(dir), "__snapshots__", "snap.test.js.snap"), "utf8")).toBe(stored);
  });
});
