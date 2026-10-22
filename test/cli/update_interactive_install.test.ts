import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { installEnv, TestRegistry } from "registry";

let registry: TestRegistry;
beforeAll(() => {
  registry = new TestRegistry().start();
});
afterAll(() => {
  registry.stop();
});

// Installs `no-deps@<range>`, types `keys` into `bun update --interactive` and returns what package.json and node_modules hold.
async function updateNoDeps(range: string, keys: string) {
  using dir = tempDir("update-interactive-install", {
    "bunfig.toml": `[install]\ncache = false\nregistry = "${registry.registryUrl()}"\n`,
    "package.json": JSON.stringify({ name: "test-project", version: "1.0.0", dependencies: { "no-deps": range } }),
  });
  const installed = () => Bun.file(join(String(dir), "node_modules", "no-deps", "package.json")).json();

  await using install = Bun.spawn({ cmd: [bunExe(), "install"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
  expect({ stderr: await install.stderr.text(), exitCode: await install.exited }).toMatchObject({ exitCode: 0 });
  const before = (await installed()).version;

  await using update = Bun.spawn({
    cmd: [bunExe(), "update", "--interactive"],
    cwd: String(dir),
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  update.stdin.write(keys);
  update.stdin.end();
  const [stderr, exitCode] = await Promise.all([update.stderr.text(), update.exited, update.stdout.text()]);
  expect(stderr).not.toContain("error:");
  return {
    before,
    declared: (await Bun.file(join(String(dir), "package.json")).json()).dependencies["no-deps"],
    installed: (await installed()).version,
    exitCode,
  };
}

describe.concurrent("bun update --interactive actually installs packages", () => {
  // Only package.json used to change, not node_modules.
  test("should update package.json AND install packages", async () => {
    // Nothing newer is in range, so Space selects the row's Latest.
    expect(await updateNoDeps("1.0.0", " \r")).toEqual({
      before: "1.0.0",
      declared: "2.0.0",
      installed: "2.0.0",
      exitCode: 0,
    });
  });

  test("should work with --latest flag", async () => {
    // 'l' toggles the row to Latest and selects it.
    expect(await updateNoDeps("^1.0.0", "l\r")).toEqual({
      before: "1.1.0",
      declared: "^2.0.0",
      installed: "2.0.0",
      exitCode: 0,
    });
  });

  test("updates a catalog entry from a workspace member", async () => {
    using dir = tempDir("update-interactive-catalog", {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
        catalog: { "no-deps": "1.0.0", "a-dep": "^1.0.1" },
      }),
      "packages/a/package.json": JSON.stringify({ name: "a", dependencies: { "no-deps": "catalog:" } }),
      "packages/b/package.json": JSON.stringify({ name: "b", dependencies: { "a-dep": "catalog:" } }),
    });
    const env = installEnv(String(dir));
    // The link in the list of cached versions is the last thing that a download writes.
    const isDownloaded = () =>
      readdirSync(join(env.BUN_INSTALL_CACHE_DIR, "no-deps")).some(version => version.startsWith("2.0.0"));

    // During the update, the manifest of the entry that stays arrives after the download of the new version.
    let updating = false;
    using slowRegistry = new TestRegistry({
      async intercept(request) {
        if (!updating || new URL(request.url).pathname !== "/a-dep") return;
        const deadline = Date.now() + 5000;
        while (!isDownloaded() && Date.now() < deadline) await Bun.sleep(1);
      },
    }).start();
    await Bun.write(join(String(dir), "bunfig.toml"), `[install]\nregistry = "${slowRegistry.registryUrl()}"\n`);

    await using install = Bun.spawn({ cmd: [bunExe(), "install"], cwd: String(dir), env, stderr: "pipe" });
    expect({ stderr: await install.stderr.text(), exitCode: await install.exited }).toMatchObject({ exitCode: 0 });

    updating = true;
    await using update = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: join(String(dir), "packages", "a"),
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    update.stdin.write("l\r");
    update.stdin.end();
    const [stderr, exitCode] = await Promise.all([update.stderr.text(), update.exited, update.stdout.text()]);
    expect(stderr).not.toContain("error:");
    expect({
      declared: (await Bun.file(join(String(dir), "package.json")).json()).catalog,
      locked: (await Bun.file(join(String(dir), "bun.lock")).text()).match(/"no-deps@([^"]+)"/)?.[1],
      installed: (await Bun.file(join(String(dir), "packages/a/node_modules/no-deps/package.json")).json()).version,
      exitCode,
    }).toEqual({
      declared: { "no-deps": "2.0.0", "a-dep": "^1.0.1" },
      locked: "2.0.0",
      installed: "2.0.0",
      exitCode: 0,
    });
  });

  test("refuses to prompt when stdin is not a TTY", async () => {
    using dir = tempDir("update-interactive-no-tty", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: { "is-even": "0.1.0" },
      }),
    });

    // stdin is a pipe we never write to. Previously this reached the menu and
    // blocked on read(); now the gate fires before any manifest resolution.
    await using updateProc = Bun.spawn({
      cmd: [bunExe(), "update", "--interactive"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        // Drop the harness bypass so the real isatty gate is exercised.
        BUN_INTERNAL_INTERACTIVE_ASSUME_TTY: undefined,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      updateProc.stdout.text(),
      updateProc.stderr.text(),
      updateProc.exited,
    ]);

    expect(stderr).toContain("requires an interactive terminal");
    // No cursor-control escapes leaked into piped output.
    expect(stdout).not.toContain("\x1b[");
    expect(exitCode).toBe(1);

    // package.json untouched
    const pkg = JSON.parse(readFileSync(join(String(dir), "package.json"), "utf8"));
    expect(pkg.dependencies["is-even"]).toBe("0.1.0");
  });
});
