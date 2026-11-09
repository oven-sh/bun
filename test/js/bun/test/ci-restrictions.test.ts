import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";

const onlyDisabledInCI =
  "error: .only is disabled in CI environments to prevent accidentally skipping tests. To override, pass --only or set the environment variable CI=false.";

async function runInCI(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("ci-restrictions", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, CI: "true" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    // A --parallel coordinator prints its workers' console.log lines to stderr.
    ran: [...stdout.split("\n"), ...stderr.split("\n")].filter(line => line.startsWith("RAN ")),
    errors: stderr.split("\n").filter(line => line.startsWith("error: ")),
    exitCode,
  };
}

describe.skipIf(Bun.semver.satisfies(Bun.version.split("-")[0], "< 1.3"))("CI restrictions", () => {
  describe("test.only restrictions", () => {
    test("test.only should work when CI=false", async () => {
      const dir = tempDirWithFiles("ci-test-only-false", {
        "test.test.js": `
import { test, expect } from "bun:test";

test.only("should run in non-CI", () => {
  expect(1 + 1).toBe(2);
});

test("should be skipped", () => {
  expect(false).toBe(true);
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, CI: "false" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
    });

    test("test.only should fail when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-test-only-true", {
        "test.test.js": `
import { test, expect } from "bun:test";

test.only("should fail in CI", () => {
  expect(1 + 1).toBe(2);
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(onlyDisabledInCI);
    });

    test("describe.only should fail when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-describe-only", {
        "test.test.js": `
import { test, expect, describe } from "bun:test";

describe.only("CI test", () => {
  test("should fail", () => {
    expect(1 + 1).toBe(2);
  });
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(onlyDisabledInCI);
    });

    // Every way to mark a test or a describe block as only reaches the same guard, and --only lifts it for all of them.
    describe.each([
      ["test.only", "bun:test", `test.only("focused", () => console.log("RAN focused"));`],
      [
        "describe.only",
        "bun:test",
        `describe.only("block", () => { test("focused", () => console.log("RAN focused")); });`,
      ],
      ["test.only.each", "bun:test", `test.only.each([1])("focused %i", () => console.log("RAN focused"));`],
      ["test.only", "vitest", `test.only("focused", () => console.log("RAN focused"));`],
      [
        "test(name, { only: true }, fn)",
        "vitest",
        `test("focused", { only: true }, () => console.log("RAN focused"));`,
      ],
      [
        "describe(name, { only: true }, fn)",
        "vitest",
        `describe("block", { only: true }, () => { test("focused", () => console.log("RAN focused")); });`,
      ],
    ])("%s from %s in CI", (_form, source, focused) => {
      const files = {
        "focused.test.js": `
import { test, describe } from "${source}";
${focused}
test("not focused", () => console.log("RAN not focused"));
`,
        "other.test.js": `
import { test } from "bun:test";
test("other file", () => console.log("RAN other file"));
`,
      };

      test.concurrent("fails without --only", async () => {
        expect(await runInCI(files)).toEqual({ ran: ["RAN other file"], errors: [onlyDisabledInCI], exitCode: 1 });
      });

      test.concurrent("runs the focused test with --only", async () => {
        expect(await runInCI(files, ["--only"])).toEqual({ ran: ["RAN focused"], errors: [], exitCode: 0 });
      });
    });

    test.concurrent("--only lifts the guard in --parallel workers", async () => {
      const result = await runInCI(
        {
          "a.test.js": `
import { test } from "bun:test";
test.only("focused a", () => console.log("RAN focused a"));
test("not focused", () => console.log("RAN not focused a"));
`,
          "b.test.js": `
import { test } from "vitest";
test("focused b", { only: true }, () => console.log("RAN focused b"));
test("not focused", () => console.log("RAN not focused b"));
`,
        },
        ["--only", "--parallel=2"],
      );
      expect({ ...result, ran: result.ran.sort() }).toEqual({
        ran: ["RAN focused a", "RAN focused b"],
        errors: [],
        exitCode: 0,
      });
    });

    test.concurrent("--only does not lift the snapshot guard", async () => {
      const result = await runInCI(
        {
          "snapshot.test.js": `
import { test, expect } from "bun:test";
test.only("new snapshot", () => { expect("value").toMatchSnapshot(); });
`,
        },
        ["--only"],
      );
      expect(result).toEqual({
        ran: [],
        errors: ["error: Snapshot creation is disabled in CI environments unless --update-snapshots is used"],
        exitCode: 1,
      });
    });
  });

  describe("snapshot restrictions", () => {
    test("toMatchSnapshot should work for existing snapshots when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-existing-snapshot", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("existing snapshot", () => {
  expect("hello world").toMatchSnapshot();
});
        `,
        "__snapshots__/test.test.js.snap": `// Bun Snapshot v1, https://bun.sh/docs/test/snapshots

exports[\`existing snapshot 1\`] = \`"hello world"\`;
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
    });

    test("toMatchSnapshot should fail for new snapshots 2 when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-new-snapshot", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new snapshot", () => {
  expect("this is new").toMatchSnapshot();
});
        `,
        "__snapshots__/test.test.js.snap": `// Bun Snapshot v1, https://bun.sh/docs/test/snapshots

exports[\`existing snapshot 1\`] = \`"hello world"\`;
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Snapshot creation is disabled in CI environments");
      expect(stderr).toContain('Snapshot name: "new snapshot 1"');
      expect(stderr).toContain('Received: "this is new"');
    });

    test("toMatchSnapshot should fail for new snapshots when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-new-snapshot", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new snapshot", () => {
  expect("this is new").toMatchSnapshot();
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Snapshot creation is disabled in CI environments");
      expect(stderr).toContain('Snapshot name: "new snapshot 1"');
      expect(stderr).toContain('Received: "this is new"');
    });

    test("toMatchSnapshot should work for new snapshots when CI=false", async () => {
      const dir = tempDirWithFiles("ci-new-snapshot-allowed", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new snapshot allowed", () => {
  expect("this should work").toMatchSnapshot();
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, CI: "false" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
      expect(stderr).toContain("snapshots: +1 added");
    });

    test("toMatchInlineSnapshot should work for existing inline snapshots when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-existing-inline", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("existing inline snapshot", () => {
  expect("hello").toMatchInlineSnapshot(\`"hello"\`);
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
    });

    test("toMatchInlineSnapshot should fail for new inline snapshots when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-new-inline", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new inline snapshot", () => {
  expect("this is new").toMatchInlineSnapshot();
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Inline snapshot creation is disabled in CI environments");
      expect(stderr).toContain('Received: "this is new"');
    });

    test("toMatchInlineSnapshot should work for new inline snapshots when CI=false", async () => {
      const dir = tempDirWithFiles("ci-new-inline-allowed", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new inline snapshot allowed", () => {
  expect("this should work").toMatchInlineSnapshot();
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js"],
        env: { ...bunEnv, CI: "false" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
    });

    test("toMatchSnapshot should allow new snapshots with --update-snapshots even when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-update-snapshots-flag", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new snapshot with update flag", () => {
  expect("new snapshot content").toMatchSnapshot();
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
      expect(stderr).toContain("snapshots: +1 added");
    });

    test("toMatchInlineSnapshot should allow updates with --update-snapshots even when GITHUB_ACTIONS=1", async () => {
      const dir = tempDirWithFiles("ci-update-inline-snapshots-flag", {
        "test.test.js": `
import { test, expect } from "bun:test";

test("new inline snapshot with update flag", () => {
  expect("inline snapshot content").toMatchInlineSnapshot();
});
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "test.test.js", "--update-snapshots"],
        env: { ...bunEnv, GITHUB_ACTIONS: "1" },
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stderr).toContain("1 pass");
    });
  });
});
