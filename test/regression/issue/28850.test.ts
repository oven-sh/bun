// https://github.com/oven-sh/bun/issues/28850
// `bun install` should recursively discover workspaces declared in nested
// packages' own `workspaces` fields. A sub-workspace can declare its own
// `workspaces` and those child packages should be available as workspace
// dependencies just like packages listed directly in the root package.json.

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test.concurrent("nested workspaces declared in sub-packages are discovered recursively", async () => {
  using dir = tempDir("issue-28850", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      private: true,
      workspaces: ["libs/*"],
      dependencies: {
        "@my-org/ui-utils": "workspace:*",
        "@my-org/core": "workspace:*",
      },
    }),
    "packages/app/libs/ui-utils/package.json": JSON.stringify({
      name: "@my-org/ui-utils",
      version: "1.0.0",
    }),
    "packages/app/libs/core/package.json": JSON.stringify({
      name: "@my-org/core",
      version: "1.0.0",
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("failed to resolve");
  expect(output).not.toContain("not found");

  // Verify that the nested workspaces were linked into app's node_modules.
  // Workspace dependencies resolve to the declaring package's node_modules tree.
  const uiUtilsLink = Bun.file(
    join(String(dir), "packages", "app", "node_modules", "@my-org", "ui-utils", "package.json"),
  );
  const coreLink = Bun.file(join(String(dir), "packages", "app", "node_modules", "@my-org", "core", "package.json"));
  expect(await uiUtilsLink.exists()).toBe(true);
  expect(await coreLink.exists()).toBe(true);

  // Both symlinks should resolve to the sub-sub-workspace directories
  expect(JSON.parse(await uiUtilsLink.text()).name).toBe("@my-org/ui-utils");
  expect(JSON.parse(await coreLink.text()).name).toBe("@my-org/core");

  expect(exitCode).toBe(0);
});

test.concurrent("deeply nested workspace discovery works (sub-sub-workspace)", async () => {
  using dir = tempDir("issue-28850-deep", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      private: true,
      workspaces: ["libs/*"],
    }),
    "packages/app/libs/mid/package.json": JSON.stringify({
      name: "@my-org/mid",
      version: "1.0.0",
      workspaces: ["nested/*"],
      dependencies: {
        "@my-org/leaf": "workspace:*",
      },
    }),
    "packages/app/libs/mid/nested/leaf/package.json": JSON.stringify({
      name: "@my-org/leaf",
      version: "1.0.0",
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("failed to resolve");
  expect(output).not.toContain("not found");

  // mid declares leaf as a workspace dep, so the link lives next to mid's package.json
  const leafLink = Bun.file(
    join(String(dir), "packages", "app", "libs", "mid", "node_modules", "@my-org", "leaf", "package.json"),
  );
  expect(await leafLink.exists()).toBe(true);
  expect(JSON.parse(await leafLink.text()).name).toBe("@my-org/leaf");

  expect(exitCode).toBe(0);
});

test.concurrent("explicit paths in nested workspaces object-form ({ packages: [...] }) work too", async () => {
  using dir = tempDir("issue-28850-explicit", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/app"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      private: true,
      // exercise the object-form: workspaces: { packages: [...] }
      workspaces: { packages: ["libs/one", "libs/two"] },
      dependencies: {
        "@my-org/one": "workspace:*",
        "@my-org/two": "workspace:*",
      },
    }),
    "packages/app/libs/one/package.json": JSON.stringify({
      name: "@my-org/one",
      version: "1.0.0",
    }),
    "packages/app/libs/two/package.json": JSON.stringify({
      name: "@my-org/two",
      version: "1.0.0",
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("failed to resolve");
  expect(output).not.toContain("not found");

  const appNm = join(String(dir), "packages", "app", "node_modules", "@my-org");
  expect(await Bun.file(join(appNm, "one", "package.json")).exists()).toBe(true);
  expect(await Bun.file(join(appNm, "two", "package.json")).exists()).toBe(true);

  expect(exitCode).toBe(0);
});

test.concurrent("broken or missing nested `workspaces` paths do not fail root install", async () => {
  // A sub-package with a `workspaces` field pointing at a non-existent path
  // should NOT fail the whole install. Nested discovery is best-effort — if
  // the user wants a loud error, they can list the path at the root.
  using dir = tempDir("issue-28850-missing", {
    "package.json": JSON.stringify({
      name: "root",
      private: true,
      workspaces: ["packages/app"],
    }),
    "packages/app/package.json": JSON.stringify({
      name: "app",
      private: true,
      // This directory does not exist. Before, this logged "Workspace not
      // found" and converted into InstallFailed for the root install.
      workspaces: ["does-not-exist"],
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = stdout + stderr;
  expect(output).not.toContain("failed to resolve");
  expect(output).not.toContain("InstallFailed");
  expect(output).not.toContain("Workspace not found");

  expect(exitCode).toBe(0);
});
