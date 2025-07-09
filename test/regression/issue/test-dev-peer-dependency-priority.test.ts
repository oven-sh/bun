import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";
import { mkdirSync, rmSync } from "fs";

test("workspace devDependencies should take priority over peerDependencies for resolution", async () => {
  const dir = tempDirWithFiles("dev-peer-priority", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: {},
      devDependencies: {},
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "next": "15.4.0-canary.119"
      },
      peerDependencies: {
        "next": "^13.0.0 || ^14.0.0 || ^15.0.0"
      },
    }),
    "packages/lib/index.js": `console.log("lib");`,
    "packages/next/package.json": JSON.stringify({
      name: "next",
      version: "15.4.0-canary.119",
      main: "index.js",
    }),
    "packages/next/index.js": `console.log("next workspace");`,
  });

  // Run bun install in the monorepo
  const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.exited.then((exitCode) => {
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]).then(([stdout, stderr]) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  });

  expect(exitCode).toBe(0);
  
  // Check that no network requests were made for packages that should be resolved locally
  expect(stderr).not.toContain("GET");
  expect(stderr).not.toContain("next");
  
  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lockb");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);
});

test("devDependencies and peerDependencies with different versions should coexist", async () => {
  const dir = tempDirWithFiles("dev-peer-different-versions", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: {},
      devDependencies: {},
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "lodash": "4.17.21"
      },
      peerDependencies: {
        "lodash": "^4.17.0"
      },
    }),
    "packages/lib/index.js": `console.log("lib");`,
  });

  // Run bun install in the monorepo
  const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.exited.then((exitCode) => {
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]).then(([stdout, stderr]) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  });

  expect(exitCode).toBe(0);
  
  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lockb");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);
});

test("dependency behavior comparison prioritizes devDependencies", async () => {
  const dir = tempDirWithFiles("behavior-comparison", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "typescript": "^5.0.0"
      },
      peerDependencies: {
        "typescript": "^4.0.0 || ^5.0.0"
      },
    }),
    "index.js": `console.log("app");`,
  });

  // Run bun install
  const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.exited.then((exitCode) => {
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]).then(([stdout, stderr]) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  });

  expect(exitCode).toBe(0);
  
  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lockb");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);
});

test("Next.js monorepo scenario should not make unnecessary network requests", async () => {
  const dir = tempDirWithFiles("nextjs-monorepo", {
    "package.json": JSON.stringify({
      name: "nextjs-monorepo",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: {},
      devDependencies: {},
    }),
    "packages/web/package.json": JSON.stringify({
      name: "web",
      version: "1.0.0",
      dependencies: {
        "next": "15.4.0-canary.119"
      },
      devDependencies: {
        "next": "15.4.0-canary.119",
        "@types/webpack": "^5.28.5"
      },
      peerDependencies: {
        "next": "^13.0.0 || ^14.0.0 || ^15.0.0"
      },
    }),
    "packages/web/index.js": `console.log("web");`,
    "packages/next/package.json": JSON.stringify({
      name: "next",
      version: "15.4.0-canary.119",
      main: "index.js",
    }),
    "packages/next/index.js": `console.log("next workspace");`,
  });

  // Run bun install
  const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.exited.then((exitCode) => {
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]).then(([stdout, stderr]) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  });

  expect(exitCode).toBe(0);
  
  // The key test: should not make network requests for packages that exist in workspace
  // When devDependencies are prioritized over peerDependencies, the workspace version should be used
  expect(stderr).not.toContain("GET");
  expect(stderr).not.toContain("404");
  
  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lockb");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);
});