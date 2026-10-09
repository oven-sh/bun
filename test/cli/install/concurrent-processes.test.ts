import { file, spawn, write } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

// Two package manager processes that edit the same project at the same time. Each one reads
// package.json and bun.lock, edits them in memory and writes them back, so without the project
// lock the one that writes last drops the other one's edit, and two installs of one project
// place the same packages twice. These tests start the processes together and check the result
// on disk.
describe("package manager processes that share a project", () => {
  const registry = new VerdaccioRegistry();
  // One package cache for every process these tests start, filled before the tests run. The
  // tests are about processes that share a project; two projects that fill one cache with the
  // same package at the same time is a different race (the CI runner points every process at
  // one cache), and the project lock does not serialize different projects on purpose.
  const cacheRoot = tempDir("concurrent-processes-cache", {});
  const cacheDir = join(String(cacheRoot), "cache");
  const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir };
  // Packages with an index.js to edit, and nothing to run.
  const PATCHABLE = [
    "no-deps@1.0.0",
    "is-number@1.0.0",
    "left-pad@1.0.0",
    "basic-1@1.0.0",
    "no-deps-esm@1.0.0",
    "no-deps-exports@1.0.0",
    "no-deps-tags@1.0.0",
    "no-deps-browser-field@1.0.0",
  ];
  const PACKAGES = [...PATCHABLE, "a-dep@1.0.1", "lifecycle-postinstall@1.0.0"];

  beforeAll(async () => {
    await registry.start();
    const { packageDir } = await registry.createTestDir();
    succeeded(await run(packageDir, "add", ...PACKAGES));
  });

  afterAll(() => {
    registry.stop();
    cacheRoot[Symbol.dispose]();
  });

  function run(cwd: string, ...args: string[]) {
    return runWithEnv(env, cwd, ...args);
  }

  async function runWithEnv(env: Record<string, string | undefined>, cwd: string, ...args: string[]) {
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { args, stdout, stderr, exitCode };
  }

  // The command exited 0 without reporting an error. A failure shows the whole output.
  function succeeded({ args, stdout, stderr, exitCode }: Awaited<ReturnType<typeof run>>) {
    expect({ args, exitCode, output: exitCode === 0 && !stderr.includes("error:") ? "" : stdout + stderr }).toEqual({
      args,
      exitCode: 0,
      output: "",
    });
  }

  async function installed(cwd: string) {
    succeeded(await run(cwd, "install"));
  }

  // `bun add` reads package.json a few milliseconds after it starts and writes it back once the
  // package is installed. `bun remove` started at the same time writes in between.
  async function addAndRemoveTogether(cwd: string) {
    const results = await Promise.all([run(cwd, "add", "is-number@1.0.0"), run(cwd, "remove", "a-dep")]);
    for (const result of results) succeeded(result);
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
    succeeded(await run(packageDir, "install", "--frozen-lockfile"));
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
    succeeded(await run(packageDir, "install", "--frozen-lockfile"));
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
    for (const result of results) succeeded(result);
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

  // The same lost update, with the order forced. `bun remove` writes package.json after the root
  // scripts ran, so a remove held in its postinstall script still has its edit in memory while
  // the add arrives. Before the lock the add went through at once and the remove then wrote its
  // stale copy over it. Now the add waits and starts from the remove's result.
  for (const where of ["the project root", "a workspace package"]) {
    test.concurrent(`a bun add that arrives while bun remove holds ${where} waits, and both edits land`, async () => {
      const dependencies = { "no-deps": "1.0.0", "a-dep": "1.0.1" };
      const postinstall = `${bunExe()} hold.js`;
      const { packageDir, packageJson } = await registry.createTestDir({
        files: {
          // Holds only the process started with HOLD in its environment; the `bun add` and the
          // `bun install` below run it too. The test writes "release"; the deadline only bounds
          // the damage if it never does.
          "hold.js": `
            const fs = require("fs");
            if (!process.env.HOLD) process.exit(0);
            fs.writeFileSync("postinstall-started", "");
            const deadline = Date.now() + 30_000;
            while (!fs.existsSync("release") && Date.now() < deadline) Bun.sleepSync(5);
          `,
        },
      });
      let cwd = packageDir;
      let editedPackageJson = packageJson;
      if (where === "the project root") {
        await write(packageJson, JSON.stringify({ name: "held", dependencies, scripts: { postinstall } }));
      } else {
        await write(
          packageJson,
          JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { postinstall } }),
        );
        cwd = join(packageDir, "packages", "app");
        editedPackageJson = join(cwd, "package.json");
        await write(editedPackageJson, JSON.stringify({ name: "app", dependencies }));
      }

      // Also the first install of the project. It holds in the postinstall script once it has
      // placed the packages, and writes package.json after that.
      const removeArgs = ["remove", "a-dep"];
      await using remove = spawn({
        cmd: [bunExe(), ...removeArgs],
        cwd,
        env: { ...env, HOLD: "1" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const removeOutput = Promise.all([remove.stdout.text(), remove.stderr.text(), remove.exited]);
      while (!existsSync(join(packageDir, "postinstall-started"))) {
        expect(remove.exitCode).toBeNull();
        await Bun.sleep(5);
      }

      const addArgs = ["add", "is-number@1.0.0"];
      await using add = spawn({
        cmd: [bunExe(), ...addArgs],
        cwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const addStdout = add.stdout.text();
      // Settles when the message shows up, or when `bun add` closes its stderr without it.
      // `addStderr` is the whole stream either way.
      const stderrSoFar: string[] = [];
      const sawMessage = Promise.withResolvers<void>();
      const addStderr = (async () => {
        for await (const chunk of add.stderr) {
          stderrSoFar.push(Buffer.from(chunk).toString());
          if (stderrSoFar.join("").includes("Waiting for another bun process")) sawMessage.resolve();
        }
        sawMessage.resolve();
        return stderrSoFar.join("");
      })();
      await sawMessage.promise;
      // Captured before the release, so a failed assertion does not leave hold.js waiting for it.
      const whileHeld = { stderr: stderrSoFar.join(""), addExitCode: add.exitCode };
      await write(join(packageDir, "release"), "");
      const [removeStdout, removeStderr, removeExitCode] = await removeOutput;
      const addResult = { args: addArgs, stdout: await addStdout, stderr: await addStderr, exitCode: await add.exited };

      // Both commands exit 0 either way. What differs is what is left in package.json.
      expect((await file(editedPackageJson).json()).dependencies).toEqual({ "no-deps": "1.0.0", "is-number": "1.0.0" });
      expect(whileHeld).toEqual({
        stderr: expect.stringContaining(`Waiting for another bun process to finish in ${packageDir}`),
        addExitCode: null,
      });
      succeeded({ args: removeArgs, stdout: removeStdout, stderr: removeStderr, exitCode: removeExitCode });
      succeeded(addResult);
      succeeded(await run(packageDir, "install", "--frozen-lockfile"));
    });
  }

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

    const result = await run(packageDir, "install");
    succeeded(result);
    expect(result.stderr).not.toContain("Waiting for another bun process");
    expect((await file(packageJson).json()).dependencies).toEqual({ "no-deps": "1.0.0", "left-pad": "1.0.0" });
    expect(existsSync(join(packageDir, "node_modules", "left-pad"))).toBe(true);
  });

  // `bun patch <pkg>` installs, then replaces the package's hard links into the cache with copies,
  // so that the user's edits stay out of the cache. The install pass of a sibling used to link the
  // package from the cache again, and the `--commit` processes used to drop each other's entries.
  test.concurrent("bun patch of eight packages started together, then eight commits", async () => {
    const { packageDir, packageJson } = await registry.createTestDir();
    const names = PATCHABLE.map(spec => spec.split("@")[0]);
    await write(
      packageJson,
      JSON.stringify({ name: "patched", dependencies: Object.fromEntries(PATCHABLE.map(spec => spec.split("@"))) }),
    );
    await installed(packageDir);

    for (const result of await Promise.all(names.map(name => run(packageDir, "patch", name)))) succeeded(result);
    for (const name of names) appendFileSync(join(packageDir, "node_modules", name, "index.js"), "\n// edited\n");
    const editedInCache = PATCHABLE.filter(spec =>
      readFileSync(join(cacheEntry(spec), "index.js"), "utf8").includes("// edited"),
    );
    const commits = names.map(name => run(packageDir, "patch", "--commit", join("node_modules", name)));
    for (const result of await Promise.all(commits)) succeeded(result);

    expect({
      editedInCache,
      patchedDependencies: (await file(packageJson).json()).patchedDependencies,
      patchFiles: readdirSync(join(packageDir, "patches")).sort(),
    }).toEqual({
      editedInCache: [],
      patchedDependencies: Object.fromEntries(PATCHABLE.map(spec => [spec, `patches/${spec}.patch`])),
      patchFiles: PATCHABLE.map(spec => `${spec}.patch`).sort(),
    });
    succeeded(await run(packageDir, "install", "--frozen-lockfile"));
  });

  // The directory the cache keeps `name@version` in. Its name also carries the registry.
  function cacheEntry(spec: string) {
    const [name, version] = spec.split("@");
    const entries = readdirSync(cacheDir).filter(entry => {
      if (!entry.startsWith(`${name}@`)) return false;
      return JSON.parse(readFileSync(join(cacheDir, entry, "package.json"), "utf8")).version === version;
    });
    expect(entries).toHaveLength(1);
    return join(cacheDir, entries[0]);
  }

  // `bun link` in a package directory removes the entry the global directory has for the package
  // and creates it again. Eight of them used to remove each other's entries and fail with EEXIST.
  test.concurrent("bun link of one package started eight times registers it", async () => {
    using dir = tempDir("link-register", {
      "lib/package.json": JSON.stringify({ name: "linked-lib", version: "1.0.0" }),
    });
    const libDir = join(String(dir), "lib");
    const globalDir = join(String(dir), "install", "global");
    const linkEnv = { ...env, BUN_INSTALL: String(dir), BUN_INSTALL_GLOBAL_DIR: globalDir };

    const results = await Promise.all(Array.from({ length: 8 }, () => runWithEnv(linkEnv, libDir, "link")));
    for (const result of results) succeeded(result);
    expect(realpathSync(join(globalDir, "node_modules", "linked-lib"))).toBe(realpathSync(libDir));
  });

  // Every `bunx <pkg>@<version>` of one version shares one install directory under the temp dir.
  // Windows bunx installs are not race free (see bunx.test.ts).
  test.concurrent.skipIf(isWindows)("cold bunx runs of one package started together all run it", async () => {
    using dir = tempDir("bunx-race", { "tmp/.keep": "", "app/.keep": "" });
    const temp = join(String(dir), "tmp");
    const cwd = join(String(dir), "app");
    const bunxEnv = {
      ...bunEnv,
      TMPDIR: temp,
      BUN_TMPDIR: temp,
      TEMP: temp,
      BUN_INSTALL_CACHE_DIR: join(temp, "install-cache"),
      npm_config_registry: registry.registryUrl(),
    };

    const results = await Promise.all(
      Array.from({ length: 6 }, async () => {
        await using proc = spawn({
          cmd: [bunExe(), "x", "what-bin@1.0.0"],
          cwd,
          env: bunxEnv,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { exitCode, output: exitCode === 0 && !stderr.includes("error:") ? "" : stdout + stderr };
      }),
    );
    expect(results).toEqual(results.map(() => ({ exitCode: 0, output: "" })));
    // what-bin writes this file into the directory it runs in.
    expect(await file(join(cwd, "what-bin.txt")).text()).toBe("what-bin@1.0.0");
  });
});
