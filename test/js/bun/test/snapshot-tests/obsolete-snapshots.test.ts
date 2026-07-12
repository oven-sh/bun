import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

const snapFixture = (body: string) => ({
  "snap.test.ts": `import { describe, test, expect, afterAll } from "bun:test";\n${body}\n`,
  "__snapshots__/snap.test.ts.snap":
    "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n" +
    'exports[`keeps 1`] = `\n{\n  "a": 1,\n}\n`;\n\n' +
    'exports[`skipped 1`] = `\n{\n  "b": 2,\n}\n`;\n\n' +
    'exports[`obsolete-gone 1`] = `"stale value"`;\n',
});

async function run(dir: string, extra: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extra, "./snap.test.ts"],
    env: { ...bunEnv, CI: "false" },
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("obsolete snapshot detection", () => {
  test("passing test with fewer toMatchSnapshot calls than keys on disk reports obsolete", async () => {
    const dir = tempDirWithFiles("snapobs-reduced", {
      "snap.test.ts":
        `import { test, expect } from "bun:test";\n` + `test("foo", () => expect(1).toMatchSnapshot());\n`,
      "__snapshots__/snap.test.ts.snap":
        "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n" +
        "exports[`foo 1`] = `1`;\n\n" +
        "exports[`foo 2`] = `2`;\n",
    });
    const { stderr, exitCode } = await run(dir);
    expect(stderr).toContain("1 obsolete");
    expect(exitCode).toBe(0);
  });

  test("reports obsolete snapshots without -u", async () => {
    const dir = tempDirWithFiles(
      "snapobs-detect",
      snapFixture(`test("keeps", () => expect({ a: 1 }).toMatchSnapshot());`),
    );
    const { stderr, exitCode } = await run(dir);
    expect(stderr).toContain("2 obsolete");
    expect(stderr).toContain("bun test -u");
    expect(stderr).not.toContain("added");
    expect(readFileSync(dir + "/__snapshots__/snap.test.ts.snap", "utf8")).toContain("obsolete-gone");
    expect(exitCode).toBe(0);
  });

  test("-u labels dropped entries as removed, not added", async () => {
    const dir = tempDirWithFiles(
      "snapobs-update",
      snapFixture(`test("keeps", () => expect({ a: 1 }).toMatchSnapshot());`),
    );
    const { stderr, exitCode } = await run(dir, ["-u"]);
    expect(stderr).toContain("2 removed");
    expect(stderr).not.toContain("added");
    expect(stderr).not.toContain("obsolete");
    const after = readFileSync(dir + "/__snapshots__/snap.test.ts.snap", "utf8");
    expect(after).not.toContain("obsolete-gone");
    expect(after).not.toContain("skipped 1");
    expect(after).toContain("keeps 1");
    expect(exitCode).toBe(0);
  });

  for (const skipFirst of [false, true]) {
    test(`skipped test's snapshot is not counted obsolete (skip ${skipFirst ? "before" : "after"} first match)`, async () => {
      const body = skipFirst
        ? `test.skip("skipped", () => expect({ b: 2 }).toMatchSnapshot());\n` +
          `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());`
        : `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
          `test.skip("skipped", () => expect({ b: 2 }).toMatchSnapshot());`;
      const dir = tempDirWithFiles("snapobs-skip", snapFixture(body));
      const { stderr, exitCode } = await run(dir);
      expect(stderr).toContain("1 obsolete");
      expect(stderr).not.toContain("2 obsolete");
      expect(exitCode).toBe(0);
    });
  }

  test("-u counts a skipped test's dropped entry in removed", async () => {
    const dir = tempDirWithFiles(
      "snapobs-skip-u",
      snapFixture(
        `test.skip("skipped", () => expect({ b: 2 }).toMatchSnapshot());\n` +
          `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());`,
      ),
    );
    const { stderr, exitCode } = await run(dir, ["-u"]);
    expect(stderr).toContain("2 removed");
    const after = readFileSync(dir + "/__snapshots__/snap.test.ts.snap", "utf8");
    expect(after).not.toContain("skipped 1");
    expect(after).not.toContain("obsolete-gone");
    expect(after).toContain("keeps 1");
    expect(exitCode).toBe(0);
  });

  test("in-source test.only() suppresses obsolete", async () => {
    const dir = tempDirWithFiles(
      "snapobs-only",
      snapFixture(
        `test.only("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
          `test("skipped", () => expect({ b: 2 }).toMatchSnapshot());`,
      ),
    );
    const { stderr, exitCode } = await run(dir);
    expect(stderr).not.toContain("obsolete");
    expect(exitCode).toBe(0);
  });

  test("test that fails before its toMatchSnapshot is not counted obsolete", async () => {
    const dir = tempDirWithFiles("snap-fail", {
      "snap.test.ts":
        `import { test, expect } from "bun:test";\n` +
        `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
        `test("failing", () => { expect(1).toBe(2); expect({ x: 1 }).toMatchSnapshot(); });\n`,
      "__snapshots__/snap.test.ts.snap":
        "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n" +
        'exports[`keeps 1`] = `\n{\n  "a": 1,\n}\n`;\n\n' +
        'exports[`failing 1`] = `\n{\n  "x": 1,\n}\n`;\n',
    });
    const { stderr, exitCode } = await run(dir);
    expect(stderr).not.toContain("obsolete");
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  });

  test("beforeAll failure suppresses obsolete for jumped-over tests", async () => {
    const dir = tempDirWithFiles("snap-hook-fail", {
      "snap.test.ts":
        `import { describe, test, expect, beforeAll } from "bun:test";\n` +
        `test("outer", () => expect(1).toMatchSnapshot());\n` +
        `describe("inner", () => {\n` +
        `  beforeAll(() => { throw new Error("db down"); });\n` +
        `  test("a", () => expect(2).toMatchSnapshot());\n` +
        `});\n`,
      "__snapshots__/snap.test.ts.snap":
        "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n" +
        "exports[`outer 1`] = `1`;\n\n" +
        "exports[`inner a 1`] = `2`;\n",
    });
    const { stderr, exitCode } = await run(dir);
    expect(stderr).not.toContain("obsolete");
    expect(exitCode).toBe(1);
  });

  test("skipped test with a hinted snapshot is not counted obsolete", async () => {
    const dir = tempDirWithFiles("snap-hint", {
      "snap.test.ts":
        `import { test, expect } from "bun:test";\n` +
        `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
        `test.skip("skipped", () => expect({ b: 2 }).toMatchSnapshot("my hint"));\n`,
      "__snapshots__/snap.test.ts.snap":
        "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n\n" +
        'exports[`keeps 1`] = `\n{\n  "a": 1,\n}\n`;\n\n' +
        'exports[`skipped: my hint 1`] = `\n{\n  "b": 2,\n}\n`;\n',
    });
    const { stderr, exitCode } = await run(dir);
    expect(stderr).not.toContain("obsolete");
    expect(exitCode).toBe(0);
  });

  test("-t filtered test's snapshot is not counted obsolete", async () => {
    const dir = tempDirWithFiles(
      "snapobs-filter",
      snapFixture(
        `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
          `test("skipped", () => expect({ b: 2 }).toMatchSnapshot());`,
      ),
    );
    const { stderr, exitCode } = await run(dir, ["-t", "keeps"]);
    expect(stderr).toContain("1 obsolete");
    expect(stderr).not.toContain("2 obsolete");
    expect(exitCode).toBe(0);
  });

  test("-u with a truly new snapshot still reports added", async () => {
    const dir = tempDirWithFiles(
      "snapobs-added",
      snapFixture(
        `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
          `test("brand-new", () => expect({ c: 3 }).toMatchSnapshot());`,
      ),
    );
    const { stderr, exitCode } = await run(dir, ["-u"]);
    expect(stderr).toContain("1 added");
    expect(stderr).toContain("2 removed");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/12114
  test("-u does not truncate the .snap file before afterAll runs", async () => {
    const dir = tempDirWithFiles(
      "snapobs-afterall",
      snapFixture(
        `const fs = require("node:fs");\n` +
          `test("keeps", () => expect({ a: 1 }).toMatchSnapshot());\n` +
          `afterAll(() => {\n` +
          `  console.log("SNAP_SIZE:" + fs.statSync("./__snapshots__/snap.test.ts.snap").size);\n` +
          `});`,
      ),
    );
    const { stdout, exitCode } = await run(dir, ["-u"]);
    const m = stdout.match(/SNAP_SIZE:(\d+)/);
    expect(m?.[1]).toBeDefined();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(exitCode).toBe(0);
  });
});
