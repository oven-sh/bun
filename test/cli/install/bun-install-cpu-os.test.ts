import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { exists, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isLinux, libcFamily, readdirSorted, toMatchNodeModulesAt } from "harness";
import { join } from "path";
import {
  ABBREVIATED_MANIFEST_ACCEPT,
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  FULL_MANIFEST_ACCEPT,
  package_dir,
  root_url,
  setHandler,
} from "./dummy.registry.js";

expect.extend({
  toMatchNodeModulesAt,
});

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach({ linker: "hoisted" });
});
afterEach(dummyAfterEach);

describe("bun install --cpu and --os flags", () => {
  it("should filter dependencies by CPU architecture", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-cpu-filter",
        version: "1.0.0",
        dependencies: {
          "dep-x64-only": "1.0.0",
        },
      }),
    );

    // Install with arm64 CPU - should skip the x64-only dependency
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "arm64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // The package should not be installed
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache"]);

    // Install with x64 CPU - should install the dependency
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(join(package_dir, "bun.lockb"), { force: true });

    const { exited: exited2 } = spawn({
      cmd: [bunExe(), "install", "--cpu", "x64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode2 = await exited2;
    expect(exitCode2).toBe(0);

    // The package should be installed
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-x64-only"]);
  });

  it("should filter dependencies by OS", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          os: ["linux"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-os-filter",
        version: "1.0.0",
        dependencies: {
          "dep-linux-only": "1.0.0",
        },
      }),
    );

    // Install with darwin OS - should skip the linux-only dependency
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--os", "darwin"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // The package should not be installed
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache"]);

    // Install with linux OS - should install the dependency
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(join(package_dir, "bun.lockb"), { force: true });

    const { exited: exited2 } = spawn({
      cmd: [bunExe(), "install", "--os", "linux"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode2 = await exited2;
    expect(exitCode2).toBe(0);

    // The package should be installed
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-linux-only"]);
  });

  it("should filter dependencies by both CPU and OS", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["arm64"],
          os: ["darwin"],
        },
        "2.0.0": {
          cpu: ["x64"],
          os: ["linux"],
        },
        "3.0.0": {},
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-cpu-os-filter",
        version: "1.0.0",
        optionalDependencies: {
          "dep-darwin-arm64": "1.0.0",
          "dep-linux-x64": "2.0.0",
          "dep-universal": "3.0.0",
        },
      }),
    );

    // Install with linux/x64 - should only install linux-x64 and universal deps
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "x64", "--os", "linux"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Check which packages were installed
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
      ".cache",
      "dep-linux-x64",
      "dep-universal",
    ]);
  });

  it("should handle multiple CPU architectures in package metadata", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64", "arm64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-multi-cpu",
        version: "1.0.0",
        dependencies: {
          "dep-multi-cpu": "1.0.0",
        },
      }),
    );

    // Install with arm64 - should install since arm64 is in the list
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "arm64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-multi-cpu"]);
  });

  // A negated unknown name is just as much of a typo as a plain one.
  it.each([
    ["--cpu", "invalid-cpu", "invalid CPU architecture: 'invalid-cpu'"],
    ["--cpu", "!invalid-cpu", "invalid CPU architecture: '!invalid-cpu'"],
    ["--os", "invalid-os", "invalid operating system: 'invalid-os'"],
    ["--os", "!invalid-os", "invalid operating system: '!invalid-os'"],
  ])("should error on %s %s", async (flag, value, message) => {
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-invalid-platform",
        version: "1.0.0",
        dependencies: {},
      }),
    );

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", flag, value],
      cwd: package_dir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });

    const [stderrText, exitCode] = await Promise.all([stderr.text(), exited]);
    expect(stderrText).toContain(message);
    expect(exitCode).toBe(1);
  });

  it("should skip installing packages with negated CPU/OS", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["!arm64"],
        },
        "2.0.0": {
          os: ["!linux"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-negated",
        version: "1.0.0",
        optionalDependencies: {
          "dep-not-arm64": "1.0.0",
          "dep-not-linux": "2.0.0",
        },
      }),
    );

    // Install with arm64 - should skip dep-not-arm64
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "arm64", "--os", "darwin"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should skip dep-not-arm64 and install dep-not-linux
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-not-linux"]);
  });

  it("should support multiple CPU architectures", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64"],
        },
        "2.0.0": {
          cpu: ["arm64"],
        },
        "3.0.0": {
          cpu: ["ppc64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-multiple-cpu",
        version: "1.0.0",
        optionalDependencies: {
          "dep-x64": "1.0.0",
          "dep-arm64": "2.0.0",
          "dep-ppc64": "3.0.0",
        },
      }),
    );

    // Install with multiple CPU architectures - should install both x64 and arm64 deps
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "x64", "--cpu", "arm64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should install x64 and arm64 deps, skip ppc64
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-arm64", "dep-x64"]);
  });

  it("should support multiple operating systems", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          os: ["linux"],
        },
        "2.0.0": {
          os: ["darwin"],
        },
        "3.0.0": {
          os: ["win32"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-multiple-os",
        version: "1.0.0",
        optionalDependencies: {
          "dep-linux": "1.0.0",
          "dep-darwin": "2.0.0",
          "dep-win32": "3.0.0",
        },
      }),
    );

    // Install with multiple OS - should install both linux and darwin deps
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--os", "linux", "--os", "darwin"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should install linux and darwin deps, skip win32
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-darwin", "dep-linux"]);
  });

  it("should support multiple CPU and OS combinations", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64"],
          os: ["linux"],
        },
        "2.0.0": {
          cpu: ["arm64"],
          os: ["darwin"],
        },
        "3.0.0": {
          cpu: ["x64"],
          os: ["darwin"],
        },
        "4.0.0": {
          cpu: ["arm64"],
          os: ["linux"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-multiple-combo",
        version: "1.0.0",
        optionalDependencies: {
          "dep-x64-linux": "1.0.0",
          "dep-arm64-darwin": "2.0.0",
          "dep-x64-darwin": "3.0.0",
          "dep-arm64-linux": "4.0.0",
        },
      }),
    );

    // Install with multiple CPU and OS - should match any combination
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "x64", "--cpu", "arm64", "--os", "linux"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should install packages that match (x64 OR arm64) AND linux
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
      ".cache",
      "dep-arm64-linux",
      "dep-x64-linux",
    ]);
  });

  it("should support * wildcard for all architectures", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64"],
        },
        "2.0.0": {
          cpu: ["arm64"],
        },
        "3.0.0": {
          cpu: ["ppc64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-wildcard-cpu",
        version: "1.0.0",
        optionalDependencies: {
          "dep-x64": "1.0.0",
          "dep-arm64": "2.0.0",
          "dep-ppc64": "3.0.0",
        },
      }),
    );

    // Install with * wildcard - should install all packages regardless of CPU
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "*"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should install all CPU-specific deps
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
      ".cache",
      "dep-arm64",
      "dep-ppc64",
      "dep-x64",
    ]);
  });

  it("should support * wildcard for all operating systems", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          os: ["linux"],
        },
        "2.0.0": {
          os: ["darwin"],
        },
        "3.0.0": {
          os: ["win32"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-wildcard-os",
        version: "1.0.0",
        optionalDependencies: {
          "dep-linux": "1.0.0",
          "dep-darwin": "2.0.0",
          "dep-win32": "3.0.0",
        },
      }),
    );

    // Install with * wildcard - should install all packages regardless of OS
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--os", "*"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should install all OS-specific deps
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([
      ".cache",
      "dep-darwin",
      "dep-linux",
      "dep-win32",
    ]);
  });

  it("should support negation with ! prefix", async () => {
    const urls: string[] = [];
    setHandler(
      dummyRegistry(urls, {
        "1.0.0": {
          cpu: ["x64"],
        },
        "2.0.0": {
          cpu: ["arm64"],
        },
        "3.0.0": {
          cpu: ["ppc64"],
        },
      }),
    );

    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({
        name: "test-negation",
        version: "1.0.0",
        optionalDependencies: {
          "dep-x64": "1.0.0",
          "dep-arm64": "2.0.0",
          "dep-ppc64": "3.0.0",
        },
      }),
    );

    // Install with negation - exclude x64 packages
    const { exited } = spawn({
      cmd: [bunExe(), "install", "--cpu", "*", "--cpu", "!x64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await exited;
    expect(exitCode).toBe(0);

    // Should skip x64 dep and install other CPU deps
    expect(await readdirSorted(join(package_dir, "node_modules"))).toEqual([".cache", "dep-arm64", "dep-ppc64"]);
  });

  // Every package name resolves against this one version table. A skipped package needs no tarball.
  const platformWarningRegistry = () =>
    dummyRegistry([], {
      "1.0.0": { os: ["win32"] },
      "2.0.0": { cpu: ["arm64", "ppc64"], os: ["!linux"] },
      "3.0.0": { dependencies: { "dep-win32-only": "1.0.0", "transitive-win32-only": "1.0.0" } },
      "4.0.0": { cpu: ["s390x"] },
    });
  const warningLines = (stderr: string) => stderr.split("\n").filter(line => line.startsWith("warn:"));
  const installedNames = async () =>
    (await readdirSorted(join(package_dir, "node_modules"))).filter(name => !name.startsWith("."));

  // A dependency that the project requires isn't skipped silently. Optional ones are, and so are the dependencies of
  // dependencies, which the project can't do anything about (run with --verbose to list them).
  it.each(["hoisted", "isolated"])(
    "warns about each direct required dependency left out for the target platform (%s linker)",
    async linker => {
      setHandler(platformWarningRegistry());
      await writeFile(
        join(package_dir, "package.json"),
        JSON.stringify({
          name: "test-platform-warning",
          version: "1.0.0",
          workspaces: ["packages/*"],
          dependencies: { "dep-win32-only": "1.0.0", "dep-universal": "3.0.0" },
          devDependencies: { "dep-not-linux": "2.0.0" },
          optionalDependencies: { "dep-s390x-only": "4.0.0" },
        }),
      );
      await Bun.write(
        join(package_dir, "packages", "member", "package.json"),
        // One that the root also depends on, and one of its own.
        JSON.stringify({ name: "member", dependencies: { "dep-win32-only": "1.0.0", "member-s390x-only": "4.0.0" } }),
      );
      const install = async (...flags: string[]) => {
        await using proc = spawn({
          cmd: [bunExe(), "install", "--os", "linux", "--cpu", "x64", "--linker", linker, ...flags],
          cwd: package_dir,
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(stdout).not.toContain("dep-win32-only");
        expect(exitCode).toBe(0);
        return warningLines(stderr).sort();
      };
      const win32 = `warn: skipping dep-win32-only@1.0.0: unsupported platform (wants os "win32")`;
      const notLinux = `warn: skipping dep-not-linux@2.0.0: unsupported platform (wants os "!linux", cpu [ "arm64", "ppc64", ])`;
      const s390x = `warn: skipping member-s390x-only@4.0.0: unsupported platform (wants cpu "s390x")`;

      expect(await install()).toEqual([notLinux, win32, s390x]);
      expect(await installedNames()).toEqual(linker === "hoisted" ? ["dep-universal", "member"] : ["dep-universal"]);
      // a run with nothing to resolve and nothing to link does not repeat it
      expect(await install()).toEqual([]);

      const removeNodeModules = () => rm(join(package_dir, "node_modules"), { recursive: true, force: true });
      // An install from the lockfile does. A package that isn't requested isn't reported as missing.
      await removeNodeModules();
      expect(await install("--production")).toEqual([win32, s390x]);
      await removeNodeModules();
      expect(await install("--silent")).toEqual([]);

      await removeNodeModules();
      await rm(join(package_dir, "bun.lock"), { force: true });
      await rm(join(package_dir, "bun.lockb"), { force: true });
      expect(await install("--filter", "member")).toEqual([win32, s390x]);
    },
  );

  // `bun add` printed `installed dep-win32-only@1.0.0` for a package it had left out.
  it.each([
    ["dependencies", [] as string[]],
    ["optionalDependencies", ["--optional"]],
  ])("bun add reports a package left out for the target platform as skipped (%s)", async (field, flags) => {
    setHandler(platformWarningRegistry());
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "test-platform-add", version: "1.0.0" }));

    await using proc = spawn({
      cmd: [bunExe(), "add", "dep-win32-only@1.0.0", ...flags, "--os", "linux", "--cpu", "x64"],
      cwd: package_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("error:");
    expect(warningLines(stderr)).toEqual(
      field === "dependencies" ? [`warn: skipping dep-win32-only@1.0.0: unsupported platform (wants os "win32")`] : [],
    );
    expect(stdout).not.toContain("installed dep-win32-only");
    expect(stdout).toContain("skipped dep-win32-only@1.0.0 (unsupported platform)\n");
    expect(await installedNames()).toEqual([]);
    expect(JSON.parse(await Bun.file(join(package_dir, "package.json")).text())[field]).toEqual({
      "dep-win32-only": "1.0.0",
    });
    expect(exitCode).toBe(0);
  });
});

describe("bun install --libc flag and the libc field", () => {
  // Every package served by dummyRegistry shares one version table, so each variant gets its own
  // version: dep-glibc@1.0.0 declares glibc, dep-musl@2.0.0 declares musl, dep-universal@3.0.0
  // declares nothing. Like registry.npmjs.org, dummyRegistry only includes `libc` in the full
  // manifest, so a variant can only be skipped if bun asked for the full manifest, which it does
  // for a package whose name contains `linux`, `musl` or `glibc`.
  const variants = {
    "1.0.0": { libc: ["glibc"] },
    "2.0.0": { libc: ["musl"] },
    "3.0.0": {},
  };

  /** Serves `info` and records the Accept header of every manifest request, keyed by package name. */
  function serveRecordingAccepts(urls: string[], info: any = variants) {
    return serveByName(urls, {}, dummyRegistry(urls, info));
  }

  /**
   * Like `serveRecordingAccepts`, with a version table per package name (`fallback` serves the rest).
   * `failing` gives the status a package's full or abbreviated manifest is answered with instead.
   */
  function serveByName(
    urls: string[],
    tables: Record<string, any>,
    fallback: ReturnType<typeof dummyRegistry> = dummyRegistry(urls, variants),
    failing: Record<string, { full?: number; abbreviated?: number }> = {},
  ) {
    const accepts: Record<string, string[]> = {};
    const registries = Object.fromEntries(
      Object.entries(tables).map(([name, info]) => [name, dummyRegistry(urls, info)]),
    );
    setHandler(request => {
      if (request.url.endsWith(".tgz")) return fallback(request);
      const name = new URL(request.url).pathname.slice(1);
      const accept = request.headers.get("accept")!;
      (accepts[name] ??= []).push(accept);
      const status = failing[name]?.[accept === FULL_MANIFEST_ACCEPT ? "full" : "abbreviated"];
      if (status) {
        urls.push(request.url);
        return new Response("failing", { status });
      }
      return (registries[name] ?? fallback)(request);
    });
    return accepts;
  }

  function clear(accepts: Record<string, string[]>, urls: string[]) {
    for (const name of Object.keys(accepts)) delete accepts[name];
    urls.length = 0;
  }

  /** Runs `bun install`, which has to succeed, and returns its stderr. */
  const install = (...args: string[]) => installWithEnv(bunEnv, ...args);

  /**
   * `dummyBeforeEach` disables the cache, and with it the manifest cache. The tests about manifests
   * that are already cached re-enable it, with the cache inside the package directory; they run every
   * install with the returned environment.
   */
  async function enableManifestCache() {
    await writeFile(
      join(package_dir, "bunfig.toml"),
      Bun.TOML.stringify({ install: { registry: root_url, saveTextLockfile: false } }),
    );
    return { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(package_dir, ".bun-cache") };
  }

  async function installWithEnv(env: typeof bunEnv, ...args: string[]) {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", ...args],
      cwd: package_dir,
      env,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [err, exitCode] = await Promise.all([stderr.text(), exited]);
    expect(err).not.toContain("error:");
    expect(exitCode).toBe(0);
    return err;
  }

  const warnings = (err: string) => err.split(/\r?\n/).filter(line => line.startsWith("warn:"));

  /** Installed packages: node_modules entries with a package.json (the .cache directory has none). */
  async function installed() {
    const names = await readdirSorted(join(package_dir, "node_modules"));
    const hasPackageJson = await Promise.all(
      names.map(name => exists(join(package_dir, "node_modules", name, "package.json"))),
    );
    return names.filter((_, i) => hasPackageJson[i]);
  }

  const tarballs = (urls: string[]) =>
    urls
      .filter(url => url.endsWith(".tgz"))
      .map(url => url.slice(url.lastIndexOf("/") + 1))
      .sort();

  const writePackageJson = (deps: Record<string, Record<string, string>>) =>
    writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "test-libc", version: "1.0.0", ...deps }));

  async function lockfileEntry(name: string) {
    const lockfile = await Bun.file(join(package_dir, "bun.lock")).text();
    return lockfile.split("\n").find(line => line.trimStart().startsWith(`"${name}": ["${name}@`));
  }

  it("filters optionalDependencies by --libc and records libc in bun.lock", async () => {
    const urls: string[] = [];
    const accepts = serveRecordingAccepts(urls);
    await writePackageJson({
      dependencies: { "dep-universal": "3.0.0" },
      optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" },
    });

    await install("--libc", "glibc", "--save-text-lockfile");
    expect(await installed()).toEqual(["dep-glibc", "dep-universal"]);
    // Only the names that suggest a libc pay for the full manifest; the skipped variant is never downloaded.
    expect(accepts).toEqual({
      "dep-universal": [ABBREVIATED_MANIFEST_ACCEPT],
      "dep-glibc": [FULL_MANIFEST_ACCEPT],
      "dep-musl": [FULL_MANIFEST_ACCEPT],
    });
    expect(tarballs(urls)).toEqual(["dep-glibc-1.0.0.tgz", "dep-universal-3.0.0.tgz"]);
    expect(await lockfileEntry("dep-glibc")).toContain(`{ "libc": "glibc" }`);
    expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);
    expect(await lockfileEntry("dep-universal")).toContain(", {}");

    // The lockfile alone decides what a frozen install for the other libc gets, so no manifest is fetched.
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    clear(accepts, urls);
    await install("--libc", "musl", "--frozen-lockfile");
    expect(await installed()).toEqual(["dep-musl", "dep-universal"]);
    expect(accepts).toEqual({});
    expect(tarballs(urls)).toEqual(["dep-musl-2.0.0.tgz", "dep-universal-3.0.0.tgz"]);
  });

  it("records libc in bun.lockb", async () => {
    setHandler(dummyRegistry([], variants));
    await writePackageJson({ optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });

    await install("--libc", "musl");
    expect(await installed()).toEqual(["dep-musl"]);
    expect(await exists(join(package_dir, "bun.lockb"))).toBe(true);

    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await install("--libc", "glibc", "--frozen-lockfile");
    expect(await installed()).toEqual(["dep-glibc"]);
  });

  it("defaults to the libc this build of bun uses on Linux and does not filter by libc elsewhere", async () => {
    setHandler(dummyRegistry([], variants));
    await writePackageJson({ optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });

    await install();
    expect(await installed()).toEqual(
      isLinux ? [libcFamily === "musl" ? "dep-musl" : "dep-glibc"] : ["dep-glibc", "dep-musl"],
    );
  });

  // The same spellings --os and --cpu accept: `*` or `any` for every value, a repeated flag, and `!name`.
  it.each([
    [
      ["--libc", "*"],
      ["dep-glibc", "dep-musl"],
    ],
    [
      ["--libc", "any"],
      ["dep-glibc", "dep-musl"],
    ],
    [
      ["--libc", "glibc", "--libc", "musl"],
      ["dep-glibc", "dep-musl"],
    ],
    [["--libc", "!glibc"], ["dep-musl"]],
    [["--libc=glibc"], ["dep-glibc"]],
  ])("bun install %p installs %p", async (flags, expected) => {
    setHandler(dummyRegistry([], variants));
    await writePackageJson({ optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });

    await install(...flags);
    expect(await installed()).toEqual(expected);
  });

  it("combines with --os and --cpu", async () => {
    setHandler(
      dummyRegistry([], {
        "1.0.0": { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
        "2.0.0": { os: ["linux"], cpu: ["x64"], libc: ["musl"] },
      }),
    );
    await writePackageJson({ optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });

    await install("--os", "linux", "--cpu", "x64", "--libc", "musl");
    expect(await installed()).toEqual(["dep-musl"]);

    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(join(package_dir, "bun.lockb"), { force: true });
    await install("--os", "darwin", "--cpu", "x64", "--libc", "musl");
    expect(await installed()).toEqual([]);
  });

  it("requests the full manifest by the package's name, whatever the kind of dependency and the host", async () => {
    const urls: string[] = [];
    const accepts = serveRecordingAccepts(urls, {
      "1.0.0": { os: ["linux"], libc: ["glibc"] },
      "2.0.0": { libc: ["musl"] },
      "3.0.0": {},
    });
    await writePackageJson({
      dependencies: { "dep-musl": "2.0.0" },
      devDependencies: { "dep-linux-x64": "1.0.0" },
      optionalDependencies: { "dep-universal": "3.0.0" },
    });

    await install("--lockfile-only", "--save-text-lockfile");
    expect(accepts).toEqual({
      "dep-musl": [FULL_MANIFEST_ACCEPT],
      "dep-linux-x64": [FULL_MANIFEST_ACCEPT],
      "dep-universal": [ABBREVIATED_MANIFEST_ACCEPT],
    });
    expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);
    expect(await lockfileEntry("dep-linux-x64")).toContain(`{ "os": "linux", "libc": "glibc" }`);
  });

  it("only filters the optional dependency on a package that is both a regular and an optional dependency", async () => {
    const urls: string[] = [];
    // dep-universal@3.0.0 optionally depends on dep-musl@2.0.0, which the root also depends on
    // directly. One request serves both edges. The libc only disables dep-universal's optional edge:
    // the root's regular dependency installs dep-musl like it did before libc was read at all.
    const accepts = serveRecordingAccepts(urls, {
      "2.0.0": { libc: ["musl"] },
      "3.0.0": { optionalDependencies: { "dep-musl": "2.0.0" } },
    });
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0", "dep-musl": "2.0.0" } });

    await install("--libc", "glibc", "--save-text-lockfile");
    expect(await installed()).toEqual(["dep-musl", "dep-universal"]);
    expect(accepts["dep-musl"]).toEqual([FULL_MANIFEST_ACCEPT]);
    expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);

    // The lockfile now knows dep-musl's libc. Whether the root gets it still depends only on how the
    // root depends on it, not on that knowledge: a devDependency is a regular dependency too.
    for (const [group, expected] of [
      ["optionalDependencies", ["dep-universal"]],
      ["devDependencies", ["dep-musl", "dep-universal"]],
    ] as const) {
      await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
      await writePackageJson({ dependencies: { "dep-universal": "3.0.0" }, [group]: { "dep-musl": "2.0.0" } });
      await install("--libc", "glibc");
      expect(await installed()).toEqual([...expected]);
      expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);
    }
  });

  it("installs a package for its regular dependents when an optional dependent skips it for libc", async () => {
    const urls: string[] = [];
    // dep-universal@3.0.0 depends on dep-musl@2.0.0 optionally and on dep-both@1.0.0, which depends
    // on dep-musl@2.0.0 regularly. With --libc glibc, dep-universal's edge is skipped but dep-both's
    // is not. The optional edge is normally resolved first (it waits for one manifest, dep-both's
    // edge for two), so skipping it must leave the package downloadable for the later edge.
    serveByName(urls, {
      "dep-universal": {
        "3.0.0": { dependencies: { "dep-both": "1.0.0" }, optionalDependencies: { "dep-musl": "2.0.0" } },
      },
      "dep-both": { "1.0.0": { dependencies: { "dep-musl": "2.0.0" } } },
      "dep-musl": { "2.0.0": { libc: ["musl"] } },
    });
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0" } });

    await install("--libc", "glibc", "--save-text-lockfile");
    expect(await installed()).toEqual(["dep-both", "dep-musl", "dep-universal"]);
    expect(tarballs(urls)).toEqual(["dep-both-1.0.0.tgz", "dep-musl-2.0.0.tgz", "dep-universal-3.0.0.tgz"]);
    expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);
  });

  it("takes a 404 for the full manifest as final", async () => {
    const urls: string[] = [];
    const accepts = serveByName(urls, {}, undefined, { "dep-musl": { full: 404 } });
    await writePackageJson({ optionalDependencies: { "dep-musl": "2.0.0" } });

    const err = await install("--libc", "musl");
    expect(warnings(err)).toEqual([`warn: GET ${root_url}/dep-musl - 404`]);
    expect(accepts).toEqual({ "dep-musl": [FULL_MANIFEST_ACCEPT] });
    expect(await exists(join(package_dir, "node_modules", "dep-musl"))).toBe(false);
  });

  it("falls back to the abbreviated manifest without a message once the retries of the full one are used up", async () => {
    const urls: string[] = [];
    const accepts = serveByName(urls, {}, undefined, { "dep-musl": { full: 503 } });
    await writePackageJson({ optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });

    const env = { ...bunEnv, BUN_CONFIG_HTTP_RETRY_COUNT: "1" };
    expect(warnings(await installWithEnv(env, "--libc", "glibc", "--save-text-lockfile"))).toEqual([]);
    expect(accepts["dep-musl"]).toEqual([FULL_MANIFEST_ACCEPT, FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT]);
    // That document has no libc, so dep-musl is installed the way it was before libc was read.
    expect(await installed()).toEqual(["dep-glibc", "dep-musl"]);
    expect(await lockfileEntry("dep-musl")).not.toContain(`"libc"`);
  });

  it.each<[string[], string[]]>([
    [[], [FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT]],
    // The abbreviated manifest has no publish times either, and those cannot be done without.
    [["--minimum-release-age", "60"], [FULL_MANIFEST_ACCEPT]],
  ])("warns once when no manifest can be downloaded (extra args: %p)", async (args, requests) => {
    const urls: string[] = [];
    const accepts = serveByName(urls, {}, undefined, { "dep-musl": { full: 503, abbreviated: 503 } });
    await writePackageJson({ optionalDependencies: { "dep-musl": "2.0.0" } });

    const err = await installWithEnv({ ...bunEnv, BUN_CONFIG_HTTP_RETRY_COUNT: "0" }, "--libc", "musl", ...args);
    expect(warnings(err)).toEqual([`warn: GET ${root_url}/dep-musl - 503`]);
    expect(accepts).toEqual({ "dep-musl": requests });
  });

  it.each(["--offline", "--prefer-offline"])(
    "%s resolves an optional dependency from a cached abbreviated manifest",
    async flag => {
      const urls: string[] = [];
      const accepts = serveByName(urls, {}, undefined, { "dep-musl": { full: 503 } });
      const env = { ...(await enableManifestCache()), BUN_CONFIG_HTTP_RETRY_COUNT: "0" };
      await writePackageJson({ optionalDependencies: { "dep-musl": "^2.0.0" } });
      // `bun install` does not wait for its manifest cache writes before it exits.
      for (let attempt = 0; ; attempt++) {
        await installWithEnv(env, "--libc", "musl");
        expect(accepts["dep-musl"]).toEqual([FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT]);
        clear(accepts, urls);
        await rm(join(package_dir, "bun.lockb"), { force: true });
        if ((await readdirSorted(env.BUN_INSTALL_CACHE_DIR)).some(name => name.endsWith(".npm"))) break;
        if (attempt === 20) throw new Error("the manifest was never cached");
      }
      await rm(join(package_dir, "node_modules"), { recursive: true, force: true });

      expect(warnings(await installWithEnv(env, "--libc", "musl", flag))).toEqual([]);
      expect(accepts).toEqual({});
      expect(await installed()).toEqual(["dep-musl"]);
    },
  );

  // The yarn.lock migration fetches every package's manifest to fill in os, cpu and libc; no dependency waits for them.
  it.each<[number | undefined, string[], string]>([
    [undefined, [FULL_MANIFEST_ACCEPT], `{ "os": "linux", "libc": "musl" }`],
    [503, [FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT], `{ "os": "linux" }`],
  ])("migrates a yarn.lock when the status of the full manifest is %p", async (full, requests, info) => {
    const urls: string[] = [];
    const accepts = serveByName(
      urls,
      {
        "dep-universal": { "3.0.0": { optionalDependencies: { "dep-musl": "2.0.0" } } },
        "dep-musl": { "2.0.0": { os: ["linux"], libc: ["musl"] } },
      },
      undefined,
      { "dep-musl": { full } },
    );
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0", "dep-musl": "2.0.0" } });
    await writeFile(
      join(package_dir, "yarn.lock"),
      [
        "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.",
        "# yarn lockfile v1",
        "",
        "",
        "dep-musl@2.0.0:",
        '  version "2.0.0"',
        '  resolved "https://registry.yarnpkg.com/dep-musl/-/dep-musl-2.0.0.tgz#0000000000000000000000000000000000000000"',
        "",
        "dep-universal@3.0.0:",
        '  version "3.0.0"',
        '  resolved "https://registry.yarnpkg.com/dep-universal/-/dep-universal-3.0.0.tgz#0000000000000000000000000000000000000000"',
        "  optionalDependencies:",
        '    dep-musl "2.0.0"',
        "",
      ].join("\n"),
    );

    const env = { ...bunEnv, BUN_CONFIG_HTTP_RETRY_COUNT: "0" };
    expect(warnings(await installWithEnv(env, "--save-text-lockfile", "--lockfile-only"))).toEqual([]);
    expect(accepts["dep-musl"]).toEqual(requests);
    expect(await lockfileEntry("dep-musl")).toContain(info);
  });

  // None of these may silently turn into "every libc".
  it.each(["bionic", "!bionic", "!", ""])("should error on --libc %p", async value => {
    await writePackageJson({});

    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install", `--libc=${value}`],
      cwd: package_dir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });

    const [stderrText, exitCode] = await Promise.all([stderr.text(), exited]);
    expect(stderrText).toContain(`invalid libc: '${value}'. valid values: *, any, glibc, musl.`);
    expect(exitCode).toBe(1);
  });
});
