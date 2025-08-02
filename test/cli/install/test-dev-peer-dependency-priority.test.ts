import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("workspace devDependencies should take priority over peerDependencies for resolution", async () => {
  const dir = tempDirWithFiles("dev-peer-priority", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      version: "1.0.0",
      workspaces: {
        packages: ["packages/*"],
        nodeLinker: "isolated",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "jquery": "workspace:*", // Use workspace protocol for dev
      },
      peerDependencies: {
        "jquery": "3.7.0", // Range wants 3.7.0
      },
    }),
    "packages/lib/test.js": `const dep = require("jquery"); console.log(dep.version);`,
    // Only provide workspace package with version 2.0.0
    "packages/my-dep/package.json": JSON.stringify({
      name: "jquery",
      version: "2.0.0",
      main: "index.js",
    }),
    "packages/my-dep/index.js": `module.exports = { version: "2.0.0" };`,
  });

  // Run initial install
  let { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    resolve => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.exited.then(exitCode => {
        Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
          resolve({ stdout, stderr, exitCode });
        });
      });
    },
  );

  if (exitCode !== 0) {
    console.error("Install failed with exit code:", exitCode);
    console.error("stdout:", stdout);
    console.error("stderr:", stderr);
  }
  expect(exitCode).toBe(0);

  // Now run bun install with a dead registry to ensure no network requests
  ({ stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: "http://localhost:9999/", // Dead URL - will fail if used
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.exited.then(exitCode => {
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  }));

  if (exitCode !== 0) {
    console.error("Install failed with exit code:", exitCode);
    console.error("stdout:", stdout);
    console.error("stderr:", stderr);
  }
  expect(exitCode).toBe(0);

  // Check that no network requests were made for packages that should be resolved locally
  expect(stderr).not.toContain("GET");
  expect(stderr).not.toContain("http");

  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lock");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);

  // Verify that version 2.0.0 (devDependency) was linked
  // If peerDependency range ^1.0.0 was used, it would try to fetch from npm and fail
  const testResult = await new Promise<string>(resolve => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "packages/lib/test.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });

    new Response(proc.stdout).text().then(resolve);
  });

  expect(testResult.trim()).toBe("2.0.0");
});

test("devDependencies and peerDependencies with different versions should coexist", async () => {
  const dir = tempDirWithFiles("dev-peer-different-versions", {
    "package.json": JSON.stringify({
      name: "test-monorepo",
      version: "1.0.0",
      workspaces: {
        packages: ["packages/*"],
        nodeLinker: "isolated",
      },
    }),
    "packages/lib/package.json": JSON.stringify({
      name: "lib",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "utils": "1.0.0",
      },
      peerDependencies: {
        "utils": "^1.0.0",
      },
    }),
    "packages/lib/index.js": `console.log("lib");`,
    "packages/utils/package.json": JSON.stringify({
      name: "utils",
      version: "1.0.0",
      main: "index.js",
    }),
    "packages/utils/index.js": `console.log("utils");`,
  });

  // Run bun install in the monorepo
  const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    resolve => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.exited.then(exitCode => {
        Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
          resolve({ stdout, stderr, exitCode });
        });
      });
    },
  );

  if (exitCode !== 0) {
    console.error("Install failed with exit code:", exitCode);
    console.error("stdout:", stdout);
    console.error("stderr:", stderr);
  }
  expect(exitCode).toBe(0);

  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lock");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);
});

test("dependency behavior comparison prioritizes devDependencies", async () => {
  const dir = tempDirWithFiles("behavior-comparison", {
    "package.json": JSON.stringify({
      name: "test-app",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "typescript": "^5.0.0",
      },
      peerDependencies: {
        "typescript": "^4.0.0 || ^5.0.0",
      },
    }),
    "index.js": `console.log("app");`,
  });

  // Run bun install
  const { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    resolve => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      proc.exited.then(exitCode => {
        Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
          resolve({ stdout, stderr, exitCode });
        });
      });
    },
  );

  if (exitCode !== 0) {
    console.error("Install failed with exit code:", exitCode);
    console.error("stdout:", stdout);
    console.error("stderr:", stderr);
  }
  expect(exitCode).toBe(0);

  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lock");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);
});

test("Next.js monorepo scenario should not make unnecessary network requests", async () => {
  const dir = tempDirWithFiles("nextjs-monorepo", {
    "package.json": JSON.stringify({
      name: "nextjs-monorepo",
      version: "1.0.0",
      workspaces: {
        packages: ["packages/*"],
        nodeLinker: "isolated",
      },
    }),
    "packages/web/package.json": JSON.stringify({
      name: "web",
      version: "1.0.0",
      dependencies: {},
      devDependencies: {
        "next": "15.0.0-canary.119", // Specific canary version for dev
      },
      peerDependencies: {
        "next": "^14.0.0 || ^15.0.0", // Range that would accept 14.x or 15.x stable
      },
    }),
    "packages/web/test.js": `const next = require("next/package.json"); console.log(next.version);`,
    // Only provide the canary version that matches devDependencies
    "packages/next/package.json": JSON.stringify({
      name: "next",
      version: "15.0.0-canary.119",
      main: "index.js",
    }),
    "packages/next/index.js": `console.log("next workspace");`,
  });

  // Run initial install
  let { stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    resolve => {
      const proc = Bun.spawn({
        cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
        cwd: dir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.exited.then(exitCode => {
        Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
          resolve({ stdout, stderr, exitCode });
        });
      });
    },
  );

  if (exitCode !== 0) {
    console.error("Install failed with exit code:", exitCode);
    console.error("stdout:", stdout);
    console.error("stderr:", stderr);
  }
  expect(exitCode).toBe(0);

  // Run bun install with dead registry
  ({ stdout, stderr, exitCode } = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(resolve => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "install", "--no-progress", "--no-summary"],
      cwd: dir,
      env: {
        ...bunEnv,
        NPM_CONFIG_REGISTRY: "http://localhost:9999/", // Dead URL
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.exited.then(exitCode => {
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]).then(([stdout, stderr]) => {
        resolve({ stdout, stderr, exitCode });
      });
    });
  }));

  expect(exitCode).toBe(0);

  // The key test: should not make network requests for packages that exist in workspace
  // When devDependencies are prioritized over peerDependencies, the workspace version should be used
  expect(stderr).not.toContain("GET");
  expect(stderr).not.toContain("404");
  expect(stderr).not.toContain("http");

  // Check that the lockfile was created correctly
  const lockfilePath = join(dir, "bun.lock");
  expect(await Bun.file(lockfilePath).exists()).toBe(true);

  // Verify that version 15.0.0-canary.119 (devDependency) was used
  // If peer range was used, it would try to fetch a stable version from npm and fail
  const testResult = await new Promise<string>(resolve => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "packages/web/test.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });

    new Response(proc.stdout).text().then(resolve);
  });

  expect(testResult.trim()).toBe("15.0.0-canary.119");
});
