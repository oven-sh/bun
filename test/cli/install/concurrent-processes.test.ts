import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tmpdirSync, VerdaccioRegistry } from "harness";
import { join } from "path";

// Two package manager processes that edit the same project at the same time. Each one reads
// package.json and bun.lock, edits them in memory and writes them back, so without the project
// lock the one that writes last drops the other one's edit, and two installs of one project
// place the same packages twice. These tests start the processes together and check the result
// on disk.
describe("package manager processes that share a project", () => {
  const registry = new VerdaccioRegistry();

  beforeAll(async () => {
    await registry.start();
  });

  afterAll(() => {
    registry.stop();
  });

  async function run(cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { args, stdout, stderr, exitCode };
  }

  async function installed(cwd: string) {
    const { stderr, exitCode } = await run(cwd, "install");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  }

  // `bun add` reads package.json a few milliseconds after it starts and writes it back once the
  // package is installed. `bun remove` started at the same time writes in between.
  async function addAndRemoveTogether(cwd: string) {
    const [add, remove] = await Promise.all([run(cwd, "add", "is-number@1.0.0"), run(cwd, "remove", "a-dep")]);
    for (const result of [add, remove]) {
      expect(result.stderr).not.toContain("error:");
      expect(result.exitCode).toBe(0);
    }
  }

  test.concurrent("bun add and bun remove started together both reach package.json and bun.lock", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(packageJson, JSON.stringify({ name: "race", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } }));
    await installed(packageDir);

    await addAndRemoveTogether(packageDir);

    expect((await file(packageJson).json()).dependencies).toEqual({ "no-deps": "1.0.0", "is-number": "1.0.0" });
    expect({
      "a-dep": existsSync(join(packageDir, "node_modules", "a-dep")),
      "is-number": existsSync(join(packageDir, "node_modules", "is-number")),
    }).toEqual({ "a-dep": false, "is-number": true });

    // bun.lock was written by whichever process ran second, from the other one's result.
    const frozen = await run(packageDir, "install", "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  // The package.json of the workspace the command runs in is read while the project root is
  // being located, before the lock is taken. It has to be read again once the lock is held.
  test.concurrent("bun add and bun remove started together in a workspace package", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(packageJson, JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    const appDir = join(packageDir, "packages", "app");
    const appPackageJson = join(appDir, "package.json");
    await write(
      appPackageJson,
      JSON.stringify({ name: "app", dependencies: { "no-deps": "1.0.0", "a-dep": "1.0.1" } }),
    );
    await installed(packageDir);

    await addAndRemoveTogether(appDir);

    expect((await file(appPackageJson).json()).dependencies).toEqual({ "no-deps": "1.0.0", "is-number": "1.0.0" });
    const frozen = await run(packageDir, "install", "--frozen-lockfile");
    expect(frozen.stderr).not.toContain("error:");
    expect(frozen.exitCode).toBe(0);
  });

  test.concurrent("installs of one project started together install and run each package once", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "many-installs",
        dependencies: { "lifecycle-postinstall": "1.0.0", "no-deps": "1.0.0" },
        trustedDependencies: ["lifecycle-postinstall"],
      }),
    );

    const results = await Promise.all(Array.from({ length: 4 }, () => run(packageDir, "install")));
    expect(
      results.map(({ stderr, exitCode }) => ({ stderr: stderr.includes("error:") ? stderr : "", exitCode })),
    ).toEqual(results.map(() => ({ stderr: "", exitCode: 0 })));
    // The first install runs the script, which writes "postinstall!". The others find the package
    // installed and leave it alone. A second run of the script writes "postinstall exists!".
    expect(await file(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt")).text()).toBe(
      "postinstall!",
    );
    expect(results.filter(({ stdout }) => stdout.includes("2 packages installed"))).toHaveLength(1);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toMatchObject({
      version: "1.0.0",
    });
  });

  test.concurrent("a second process waits for the one that holds the project", async () => {
    const { packageDir, packageJson } = await registry.createTestDir({
      files: {
        "hold.js": `
          const fs = require("fs");
          fs.writeFileSync("postinstall-started", "");
          while (!fs.existsSync("release")) Bun.sleepSync(5);
        `,
      },
    });
    // The root postinstall script runs while the install still holds the project.
    await write(
      packageJson,
      JSON.stringify({
        name: "held",
        dependencies: { "no-deps": "1.0.0" },
        scripts: { postinstall: `${bunExe()} hold.js` },
      }),
    );

    await using install = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const installOutput = Promise.all([install.stdout.text(), install.stderr.text(), install.exited]);
    while (!existsSync(join(packageDir, "postinstall-started"))) {
      expect(install.exitCode).toBeNull();
      await Bun.sleep(5);
    }

    await using add = spawn({
      cmd: [bunExe(), "add", "left-pad@1.0.0"],
      cwd: packageDir,
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const addStdout = add.stdout.text();
    // Resolves as soon as the message shows up, or with everything `bun add` wrote if it finished
    // without it. The stream is read to its end either way.
    const waitingMessage = new Promise<string>(async resolve => {
      let stderr = "";
      for await (const chunk of add.stderr) {
        stderr += Buffer.from(chunk).toString();
        if (stderr.includes("Waiting for another bun process to finish in ")) resolve(stderr);
      }
      resolve(stderr);
    });
    expect(await waitingMessage).toContain(`Waiting for another bun process to finish in ${packageDir}`);
    expect(add.exitCode).toBeNull();

    await write(join(packageDir, "release"), "");
    const [, installStderr, installExitCode] = await installOutput;
    expect(installStderr).not.toContain("error:");
    expect(installExitCode).toBe(0);

    const addExitCode = await add.exited;
    expect(await addStdout).toContain("installed left-pad@1.0.0");
    expect(addExitCode).toBe(0);
    expect((await file(packageJson).json()).dependencies).toEqual({ "no-deps": "1.0.0", "left-pad": "1.0.0" });
  });

  // The install holds the project while its scripts run. The nested `bun add` runs under that
  // lock instead of waiting for it. (`--ignore-scripts` keeps the nested add from running this
  // postinstall script again.)
  test.concurrent("a lifecycle script can run bun add in the project being installed", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    await write(
      packageJson,
      JSON.stringify({
        name: "nested",
        dependencies: { "no-deps": "1.0.0" },
        scripts: { postinstall: `${bunExe()} add --ignore-scripts left-pad@1.0.0` },
      }),
    );

    const { stderr, exitCode } = await run(packageDir, "install");
    expect(stderr).not.toContain("error:");
    expect(stderr).not.toContain("Waiting for another bun process");
    expect(exitCode).toBe(0);
    expect((await file(packageJson).json()).dependencies).toEqual({ "no-deps": "1.0.0", "left-pad": "1.0.0" });
    expect(existsSync(join(packageDir, "node_modules", "left-pad"))).toBe(true);
  });

  // Every `bunx <pkg>@<version>` of one version shares one install directory under the temp dir.
  // Windows bunx installs are not race free (see bunx.test.ts).
  test.concurrent.skipIf(isWindows)("cold bunx runs of one package started together all run it", async () => {
    const tempDir = tmpdirSync();
    const cwd = tmpdirSync();
    const env = {
      ...bunEnv,
      TMPDIR: tempDir,
      BUN_TMPDIR: tempDir,
      TEMP: tempDir,
      BUN_INSTALL_CACHE_DIR: join(tempDir, "install-cache"),
      npm_config_registry: registry.registryUrl(),
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, async () => {
        await using proc = spawn({
          cmd: [bunExe(), "x", "what-bin@1.0.0"],
          cwd,
          env,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stderr: stderr.includes("error:") ? stdout + stderr : "", exitCode };
      }),
    );
    expect(results).toEqual(results.map(() => ({ stderr: "", exitCode: 0 })));
    // what-bin writes this file into the directory it runs in.
    expect(await file(join(cwd, "what-bin.txt")).text()).toBe("what-bin@1.0.0");
  });
});
