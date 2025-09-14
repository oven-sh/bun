import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import path from "path";

test("bun --filter respects workspace dependency order", async () => {
  using dir = tempDir("filter-deps", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
      scripts: {
        build: "echo 'Building A' && sleep 0.5 && echo 'A built' && echo 'export const value = 42;' > dist/index.js",
        prebuild: "mkdir -p dist",
      },
    }),
    "packages/b/package.json": JSON.stringify({
      name: "b",
      version: "1.0.0",
      dependencies: {
        a: "workspace:*",
      },
      scripts: {
        build: "echo 'Building B' && test -f ../a/dist/index.js && echo 'B built successfully'",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--filter", "*", "build"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");

  // Check that A builds before B
  const aBuiltIndex = stdoutText.indexOf("A built");
  const bBuildingIndex = stdoutText.indexOf("Building B");
  
  expect(aBuiltIndex).toBeGreaterThan(-1);
  expect(bBuildingIndex).toBeGreaterThan(-1);
  expect(aBuiltIndex).toBeLessThan(bBuildingIndex);
});

test("bun --filter handles complex dependency chains", async () => {
  using dir = tempDir("filter-deps-chain", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
      scripts: {
        build: "echo 'Building A' && sleep 0.3 && echo 'A built' && echo 'export const a = 1;' > index.js",
      },
    }),
    "packages/b/package.json": JSON.stringify({
      name: "b",
      version: "1.0.0",
      dependencies: {
        a: "workspace:*",
      },
      scripts: {
        build: "echo 'Building B' && test -f ../a/index.js && sleep 0.3 && echo 'B built' && echo 'export const b = 2;' > index.js",
      },
    }),
    "packages/c/package.json": JSON.stringify({
      name: "c",
      version: "1.0.0",
      dependencies: {
        b: "workspace:*",
      },
      scripts: {
        build: "echo 'Building C' && test -f ../b/index.js && echo 'C built'",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--filter", "*", "build"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");

  // Check the build order
  const aBuiltIndex = stdoutText.indexOf("A built");
  const bBuildingIndex = stdoutText.indexOf("Building B");
  const bBuiltIndex = stdoutText.indexOf("B built");
  const cBuildingIndex = stdoutText.indexOf("Building C");
  
  expect(aBuiltIndex).toBeGreaterThan(-1);
  expect(bBuildingIndex).toBeGreaterThan(-1);
  expect(bBuiltIndex).toBeGreaterThan(-1);
  expect(cBuildingIndex).toBeGreaterThan(-1);
  
  // A must be built before B starts
  expect(aBuiltIndex).toBeLessThan(bBuildingIndex);
  // B must be built before C starts
  expect(bBuiltIndex).toBeLessThan(cBuildingIndex);
});

test("bun --filter handles parallel execution of independent packages", async () => {
  using dir = tempDir("filter-deps-parallel", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
      scripts: {
        build: "echo 'Building A' && sleep 0.3 && echo 'A built'",
      },
    }),
    "packages/b/package.json": JSON.stringify({
      name: "b",
      version: "1.0.0",
      scripts: {
        build: "echo 'Building B' && sleep 0.3 && echo 'B built'",
      },
    }),
    "packages/c/package.json": JSON.stringify({
      name: "c",
      version: "1.0.0",
      dependencies: {
        a: "workspace:*",
        b: "workspace:*",
      },
      scripts: {
        build: "echo 'Building C' && echo 'C built'",
      },
    }),
  });

  const startTime = Date.now();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--filter", "*", "build"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  const endTime = Date.now();

  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");

  // Check that A and B ran in parallel (total time should be ~300ms, not ~600ms)
  const duration = endTime - startTime;
  expect(duration).toBeLessThan(500);

  // Check that C runs after both A and B
  const aBuiltIndex = stdoutText.indexOf("A built");
  const bBuiltIndex = stdoutText.indexOf("B built");
  const cBuildingIndex = stdoutText.indexOf("Building C");
  
  expect(aBuiltIndex).toBeGreaterThan(-1);
  expect(bBuiltIndex).toBeGreaterThan(-1);
  expect(cBuildingIndex).toBeGreaterThan(-1);
  
  expect(aBuiltIndex).toBeLessThan(cBuildingIndex);
  expect(bBuiltIndex).toBeLessThan(cBuildingIndex);
});

test("bun --filter fails when dependency fails", async () => {
  using dir = tempDir("filter-deps-failure", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/a/package.json": JSON.stringify({
      name: "a",
      version: "1.0.0",
      scripts: {
        build: "echo 'Building A' && exit 1",
      },
    }),
    "packages/b/package.json": JSON.stringify({
      name: "b",
      version: "1.0.0",
      dependencies: {
        a: "workspace:*",
      },
      scripts: {
        build: "echo 'Should not run'",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--filter", "*", "build"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stdoutText).toContain("Building A");
  expect(stdoutText).not.toContain("Should not run");
});

test.skip("bun --filter with workspace: protocol dependency", async () => {
  using dir = tempDir("filter-workspace-protocol", {
    "package.json": JSON.stringify({
      name: "monorepo",
      private: true,
      workspaces: ["packages/*"],
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "@test/lib",
      version: "1.0.0",
      scripts: {
        build: "echo 'Building lib' && mkdir -p dist && echo 'done' > dist/lib.txt && sleep 0.1 && echo 'Lib built'",
      },
    }),
    "packages/app/package.json": JSON.stringify({
      name: "@test/app",
      version: "1.0.0",
      dependencies: {
        "@test/lib": "workspace:^1.0.0",
      },
      scripts: {
        build: "echo 'Building app' && test -f ../lib/dist/lib.txt && echo 'App built'",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--filter", "*", "build"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderrText).toBe("");

  // Check that lib builds before app
  const libBuildingIndex = stdoutText.indexOf("Building lib");
  const appBuildingIndex = stdoutText.indexOf("Building app");
  
  expect(libBuildingIndex).toBeGreaterThan(-1);
  expect(appBuildingIndex).toBeGreaterThan(-1);

  // Since lib must complete before app starts, app should start after lib builds
  const libBuiltIndex = stdoutText.indexOf("Lib built");
  expect(libBuiltIndex).toBeGreaterThan(-1);
  expect(libBuiltIndex).toBeLessThan(appBuildingIndex);
});
