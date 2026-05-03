import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

function createWorkspaceWithSleepScripts(count: number) {
  const packages: Record<string, object> = {};
  for (let i = 0; i < count; i++) {
    packages[`pkg${i}`] = {
      "index.js": `
        const start = Date.now();
        await Bun.write('timing.txt', String(start));
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('done-pkg${i}');
      `,
      "package.json": JSON.stringify({
        name: `pkg${i}`,
        scripts: {
          build: `${bunExe()} run index.js`,
        },
      }),
    };
  }
  return tempDirWithFiles("concurrency-test", {
    packages,
    "package.json": JSON.stringify({
      name: "ws",
      workspaces: ["packages/*"],
    }),
  });
}

describe("--concurrency flag", () => {
  test("limits concurrent scripts with --filter", () => {
    const dir = createWorkspaceWithSleepScripts(4);

    const start = Date.now();
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--concurrency", "2", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const elapsed = Date.now() - start;
    const output = stdout.toString();

    // All 4 packages should complete
    expect(output).toMatch(/done-pkg0/);
    expect(output).toMatch(/done-pkg1/);
    expect(output).toMatch(/done-pkg2/);
    expect(output).toMatch(/done-pkg3/);
    expect(exitCode).toBe(0);

    // With concurrency=2 and 4 packages sleeping 500ms each,
    // it should take at least ~1000ms (2 batches of 2).
    // Without concurrency limit it would take ~500ms.
    expect(elapsed).toBeGreaterThan(800);
  });

  test("unlimited concurrency without flag", () => {
    const dir = createWorkspaceWithSleepScripts(4);

    const start = Date.now();
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const elapsed = Date.now() - start;
    const output = stdout.toString();

    expect(output).toMatch(/done-pkg0/);
    expect(output).toMatch(/done-pkg1/);
    expect(output).toMatch(/done-pkg2/);
    expect(output).toMatch(/done-pkg3/);
    expect(exitCode).toBe(0);

    // Without limit, all 4 run in parallel — should finish in ~500ms
    expect(elapsed).toBeLessThan(2000);
  });

  test("concurrency=1 runs sequentially", () => {
    const dir = createWorkspaceWithSleepScripts(3);

    const start = Date.now();
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--concurrency", "1", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const elapsed = Date.now() - start;
    const output = stdout.toString();

    expect(output).toMatch(/done-pkg0/);
    expect(output).toMatch(/done-pkg1/);
    expect(output).toMatch(/done-pkg2/);
    expect(exitCode).toBe(0);

    // With concurrency=1, 3 packages × 500ms = at least 1500ms
    expect(elapsed).toBeGreaterThan(1200);
  });

  test("errors on --concurrency 0", () => {
    const dir = createWorkspaceWithSleepScripts(2);

    const { exitCode, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--concurrency", "0", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr.toString()).toMatch(/--concurrency must be at least 1/);
    expect(exitCode).not.toBe(0);
  });

  test("errors on --concurrency with non-numeric value", () => {
    const dir = createWorkspaceWithSleepScripts(2);

    const { exitCode, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--concurrency", "abc", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr.toString()).toMatch(/Invalid concurrency/);
    expect(exitCode).not.toBe(0);
  });

  test("respects dependency order with concurrency limit", () => {
    const dir = tempDirWithFiles("concurrency-deps", {
      packages: {
        dep0: {
          "index.js": `
            await new Promise(resolve => setTimeout(resolve, 200));
            await Bun.write('out.txt', 'dep0-done');
            console.log('done-dep0');
          `,
          "package.json": JSON.stringify({
            name: "dep0",
            scripts: { build: `${bunExe()} run index.js` },
          }),
        },
        dep1: {
          "index.js": `
            const content = await Bun.file('../dep0/out.txt').text();
            console.log('dep1-read:' + content);
          `,
          "package.json": JSON.stringify({
            name: "dep1",
            dependencies: { dep0: "*" },
            scripts: { build: `${bunExe()} run index.js` },
          }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
      }),
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--concurrency", "1", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = stdout.toString();
    expect(output).toMatch(/done-dep0/);
    expect(output).toMatch(/dep1-read:dep0-done/);
    expect(exitCode).toBe(0);
  });

  test("works with --parallel mode", () => {
    const dir = createWorkspaceWithSleepScripts(4);

    const start = Date.now();
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--parallel", "--filter", "*", "--concurrency", "2", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const elapsed = Date.now() - start;
    const output = stdout.toString();

    expect(output).toMatch(/done-pkg0/);
    expect(output).toMatch(/done-pkg1/);
    expect(output).toMatch(/done-pkg2/);
    expect(output).toMatch(/done-pkg3/);
    expect(exitCode).toBe(0);

    // With concurrency=2, should take at least ~1000ms
    expect(elapsed).toBeGreaterThan(800);
  });
});
