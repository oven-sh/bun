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
    ["--cpu", "invalid-cpu", "Invalid CPU architecture: 'invalid-cpu'"],
    ["--cpu", "!invalid-cpu", "Invalid CPU architecture: '!invalid-cpu'"],
    ["--os", "invalid-os", "Invalid operating system: 'invalid-os'"],
    ["--os", "!invalid-os", "Invalid operating system: '!invalid-os'"],
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
});

describe("bun install --libc flag and the libc field", () => {
  // Every package served by dummyRegistry shares one version table, so each variant gets its own
  // version: dep-glibc@1.0.0 declares glibc, dep-musl@2.0.0 declares musl, dep-universal@3.0.0
  // declares nothing. Like registry.npmjs.org, dummyRegistry only includes `libc` in the full
  // manifest, so a variant can only be skipped if bun asked for the full manifest.
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
   * The full manifest of the packages in `withoutFullManifest` is a 404, as on a registry that only
   * has the abbreviated document.
   */
  function serveByName(
    urls: string[],
    tables: Record<string, any>,
    fallback: ReturnType<typeof dummyRegistry> = dummyRegistry(urls, variants),
    withoutFullManifest: string[] = [],
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
      if (withoutFullManifest.includes(name) && accept === FULL_MANIFEST_ACCEPT) {
        urls.push(request.url);
        return new Response("not found", { status: 404 });
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

  /**
   * bun writes a fetched manifest to the cache from a thread pool task that does not hold up its
   * exit, so an install that must find it there waits for the file first.
   */
  async function cachedManifestCount(atLeast: number) {
    const cacheDir = join(package_dir, ".bun-cache");
    const deadline = performance.now() + 2_000;
    let count = 0;
    do {
      count = (await readdirSorted(cacheDir).catch(() => [] as string[])).filter(name => name.endsWith(".npm")).length;
      if (count >= atLeast) return count;
      await Bun.sleep(5);
    } while (performance.now() < deadline);
    throw new Error(`expected ${atLeast} cached manifest(s) in ${cacheDir}, found ${count}`);
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

  const installedVersion = async (...path: string[]) =>
    ((await Bun.file(join(package_dir, "node_modules", ...path, "package.json")).json()) as { version: string })
      .version;

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
    // Only optional dependencies pay for the full manifest; the skipped variant is never downloaded.
    expect(accepts).toEqual({
      "dep-universal": [ABBREVIATED_MANIFEST_ACCEPT],
      "dep-glibc": [FULL_MANIFEST_ACCEPT],
      "dep-musl": [FULL_MANIFEST_ACCEPT],
    });
    expect(tarballs(urls)).toEqual(["dep-glibc-1.0.0.tgz", "dep-universal-3.0.0.tgz"]);
    expect(await lockfileEntry("dep-glibc")).toContain(`{ "libc": "glibc" }`);
    expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);
    expect(await lockfileEntry("dep-universal")).toContain(", {}");

    // The lockfile alone decides what a frozen install for the other libc gets: no manifest is fetched.
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

  it("does not trust a cached abbreviated manifest for an optional dependency", async () => {
    const urls: string[] = [];
    const accepts = serveRecordingAccepts(urls);
    const env = await enableManifestCache();
    // As regular dependencies both variants install from the abbreviated manifests, which get cached.
    await writePackageJson({ dependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });
    await installWithEnv(env, "--libc", "glibc");
    expect(await installed()).toEqual(["dep-glibc", "dep-musl"]);
    expect(accepts).toEqual({
      "dep-glibc": [ABBREVIATED_MANIFEST_ACCEPT],
      "dep-musl": [ABBREVIATED_MANIFEST_ACCEPT],
    });
    expect(await cachedManifestCount(2)).toBe(2);

    // Resolving the same exact versions again as regular dependencies is served by the cache.
    await rm(join(package_dir, "bun.lockb"), { force: true });
    clear(accepts, urls);
    await installWithEnv(env, "--libc", "glibc");
    expect(accepts).toEqual({});

    // As optional dependencies, the cached manifests have these versions but not their libc, so the
    // full manifests are fetched instead of resolving from the cache.
    await rm(join(package_dir, "bun.lockb"), { force: true });
    await rm(join(package_dir, "node_modules", "dep-glibc"), { recursive: true });
    await rm(join(package_dir, "node_modules", "dep-musl"), { recursive: true });
    await writePackageJson({ optionalDependencies: { "dep-glibc": "1.0.0", "dep-musl": "2.0.0" } });
    await installWithEnv(env, "--libc", "glibc");
    expect(await installed()).toEqual(["dep-glibc"]);
    expect(accepts).toEqual({
      "dep-glibc": [FULL_MANIFEST_ACCEPT],
      "dep-musl": [FULL_MANIFEST_ACCEPT],
    });
  });

  it("records libc for a package that is both a regular and an optional dependency, and only filters the optional one", async () => {
    const urls: string[] = [];
    // dep-universal@3.0.0 optionally depends on dep-musl@2.0.0, which the root also depends on
    // directly. The root's edge only needs the abbreviated manifest; dep-universal's edge needs the
    // full one, and its libc must end up on the shared lockfile entry no matter which response
    // arrives first. It only disables dep-universal's optional edge: the root's regular dependency
    // installs dep-musl like it did before libc was read at all.
    const accepts = serveRecordingAccepts(urls, {
      "2.0.0": { libc: ["musl"] },
      "3.0.0": { optionalDependencies: { "dep-musl": "2.0.0" } },
    });
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0", "dep-musl": "2.0.0" } });

    await install("--libc", "glibc", "--save-text-lockfile");
    expect(await installed()).toEqual(["dep-musl", "dep-universal"]);
    expect(accepts["dep-musl"].sort()).toEqual([FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT].sort());
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

  it("falls back to the abbreviated manifest when the request for the full one fails", async () => {
    const urls: string[] = [];
    // baz@0.0.3 is a regular dependency of the root and baz@0.0.5 an optional dependency of
    // dep-universal@3.0.0, so baz is requested both ways, and the registry only has the abbreviated
    // document. The optional edge then resolves from that document, which has no libc, so baz@0.0.5
    // is installed the way it was before libc was read; the install neither fails nor drops the edge.
    const accepts = serveByName(
      urls,
      {
        baz: { "0.0.3": { libc: ["musl"] }, "0.0.5": { libc: ["musl"] } },
        "dep-universal": { "3.0.0": { optionalDependencies: { baz: "0.0.5" } } },
      },
      undefined,
      ["baz"],
    );
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0", baz: "0.0.3" } });

    const err = await install("--libc", "glibc", "--save-text-lockfile");
    expect(err).toContain(
      "warn: HTTP 404 downloading the full package metadata for baz, using the abbreviated metadata: its libc field will not be checked",
    );
    expect(accepts.baz.sort()).toEqual([FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT].sort());
    expect(await installed()).toEqual(["baz", "dep-universal"]);
    expect(await installedVersion("baz")).toBe("0.0.3");
    expect(await installedVersion("dep-universal", "node_modules", "baz")).toBe("0.0.5");
    expect(await Bun.file(join(package_dir, "bun.lock")).text()).not.toContain(`"libc"`);

    // Everything was resolved and saved, so installing from the lockfile needs no manifest at all.
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    clear(accepts, urls);
    expect(await install("--libc", "glibc", "--frozen-lockfile")).not.toContain("warn:");
    expect(accepts).toEqual({});
    expect(await installedVersion("dep-universal", "node_modules", "baz")).toBe("0.0.5");
  });

  it("falls back to the abbreviated manifest when the optional dependency is reached before the regular one", async () => {
    const urls: string[] = [];
    // Same registry, but here the regular dependency on baz comes from dep-both, which is only
    // resolved after its own manifest arrives, so the optional edge from dep-universal requests baz
    // first and its 404 may even be processed before the regular edge exists. Whichever of the two
    // requests the abbreviated document, both edges resolve from it, exactly as in the other order.
    const accepts = serveByName(
      urls,
      {
        baz: { "0.0.5": { libc: ["musl"] } },
        "dep-universal": {
          "3.0.0": { dependencies: { "dep-both": "1.0.0" }, optionalDependencies: { baz: "0.0.5" } },
        },
        "dep-both": { "1.0.0": { dependencies: { baz: "0.0.5" } } },
      },
      undefined,
      ["baz"],
    );
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0" } });

    const err = await install("--libc", "glibc", "--save-text-lockfile");
    expect(err).toContain("warn: HTTP 404 downloading the full package metadata for baz");
    expect(accepts.baz.sort()).toEqual([FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT].sort());
    expect(await installed()).toEqual(["baz", "dep-both", "dep-universal"]);
    expect(await lockfileEntry("baz")).not.toContain(`"libc"`);

    // Both edges were resolved, including the optional one that was waiting when the full request
    // failed, so installing from the lockfile needs no manifest at all.
    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    clear(accepts, urls);
    expect(await install("--libc", "glibc", "--frozen-lockfile")).not.toContain("warn:");
    expect(accepts).toEqual({});
    expect(await installed()).toEqual(["baz", "dep-both", "dep-universal"]);
  });

  it("falls back to the abbreviated manifest for a package that is only an optional dependency", async () => {
    const urls: string[] = [];
    // Nothing requested the abbreviated document, so the dependency that was waiting for the full
    // one requests it once the full one has failed: the package installs as it did before libc was
    // read instead of being left out.
    const accepts = serveByName(urls, { baz: { "0.0.5": { libc: ["musl"] } } }, undefined, ["baz"]);
    await writePackageJson({ optionalDependencies: { baz: "0.0.5" } });

    const err = await install("--libc", "glibc", "--save-text-lockfile");
    expect(err).toContain("warn: HTTP 404 downloading the full package metadata for baz");
    expect(accepts.baz).toEqual([FULL_MANIFEST_ACCEPT, ABBREVIATED_MANIFEST_ACCEPT]);
    expect(await installed()).toEqual(["baz"]);
    expect(await lockfileEntry("baz")).not.toContain(`"libc"`);

    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    clear(accepts, urls);
    expect(await install("--libc", "glibc", "--frozen-lockfile")).not.toContain("warn:");
    expect(accepts).toEqual({});
    expect(await installed()).toEqual(["baz"]);
  });

  it("falls back to a cached abbreviated manifest without requesting it again", async () => {
    const urls: string[] = [];
    // First install: baz is a regular dependency, so its abbreviated manifest ends up in the cache.
    const tables = {
      baz: { "0.0.5": { libc: ["musl"] } },
      "dep-universal": {
        "3.0.0": { dependencies: { "dep-both": "1.0.0" }, optionalDependencies: { baz: "0.0.5" } },
      },
      "dep-both": { "1.0.0": { dependencies: { baz: "0.0.5" } } },
    };
    serveByName(urls, tables, undefined, ["baz"]);
    const env = await enableManifestCache();
    await writePackageJson({ dependencies: { baz: "0.0.5" } });
    await installWithEnv(env, "--libc", "glibc");
    expect(await installed()).toEqual(["baz"]);
    expect(await cachedManifestCount(1)).toBe(1);

    // Second install: the optional edge from dep-universal requests the full document, which fails,
    // and the regular edge from dep-both is satisfied by the cached abbreviated one, which the
    // optional edge then falls back to as well. The dedupe entry of the failing request has to
    // survive the cache hit: the install must not fail, and the cached document is not requested.
    await rm(join(package_dir, "bun.lockb"), { force: true });
    await rm(join(package_dir, "node_modules", "baz"), { recursive: true });
    const accepts = serveByName(urls, tables, undefined, ["baz"]);
    await writePackageJson({ dependencies: { "dep-universal": "3.0.0" } });

    const err = await installWithEnv(env, "--libc", "glibc", "--save-text-lockfile");
    expect(err).toContain("warn: HTTP 404 downloading the full package metadata for baz");
    expect(accepts.baz).toEqual([FULL_MANIFEST_ACCEPT]);
    expect(await installed()).toEqual(["baz", "dep-both", "dep-universal"]);
    expect(await lockfileEntry("baz")).not.toContain(`"libc"`);

    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    clear(accepts, urls);
    expect(await install("--libc", "glibc", "--frozen-lockfile")).not.toContain("warn:");
    expect(accepts).toEqual({});
    expect(await installed()).toEqual(["baz", "dep-both", "dep-universal"]);
  });

  it("uses a cached abbreviated manifest for an optional dependency under --offline", async () => {
    const urls: string[] = [];
    // A regular dependency caches the abbreviated manifest (and the tarball), as every install
    // did before libc was read. Offline, the full document cannot be fetched, so an optional
    // dependency on the same package resolves from that document instead of being dropped; the
    // libc goes unchecked, like when the request for the full document fails.
    const accepts = serveRecordingAccepts(urls);
    const env = await enableManifestCache();
    await writePackageJson({ dependencies: { "dep-musl": "2.0.0" } });
    await installWithEnv(env, "--libc", "glibc");
    expect(await installed()).toEqual(["dep-musl"]);
    expect(accepts).toEqual({ "dep-musl": [ABBREVIATED_MANIFEST_ACCEPT] });
    expect(await cachedManifestCount(1)).toBe(1);

    await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
    await rm(join(package_dir, "bun.lockb"), { force: true });
    clear(accepts, urls);
    await writePackageJson({ optionalDependencies: { "dep-musl": "2.0.0" } });
    const err = await installWithEnv(env, "--libc", "glibc", "--offline", "--save-text-lockfile");
    expect(err).toContain(
      "warn: --offline: no cached full package metadata for dep-musl, using the cached abbreviated metadata: its libc field will not be checked",
    );
    expect(accepts).toEqual({});
    expect(urls).toEqual([]);
    expect(await installed()).toEqual(["dep-musl"]);
    expect(await lockfileEntry("dep-musl")).not.toContain(`"libc"`);
  });

  it("records libc when migrating a yarn.lock whose package is a regular dependency first and an optional one later", async () => {
    const urls: string[] = [];
    // The yarn.lock migration fetches every package's manifest to fill in os, cpu and libc. The
    // root's regular dependency on dep-musl comes first; dep-universal's optional dependency on it,
    // which is what makes the full manifest necessary, comes later and must still get it requested.
    const accepts = serveByName(urls, {
      "dep-universal": { "3.0.0": { optionalDependencies: { "dep-musl": "2.0.0" } } },
      "dep-musl": { "2.0.0": { libc: ["musl"] } },
    });
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

    await install("--save-text-lockfile", "--lockfile-only");
    expect(accepts["dep-musl"]).toContain(FULL_MANIFEST_ACCEPT);
    expect(await lockfileEntry("dep-musl")).toContain(`{ "libc": "musl" }`);
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
    expect(stderrText).toContain(`Invalid libc: '${value}'. Valid values are: *, any, glibc, musl.`);
    expect(exitCode).toBe(1);
  });
});
