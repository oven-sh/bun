// Commands that branch on the kind of a readdir entry (file, directory, symlink)
// must still work on filesystems whose readdir reports every entry as
// DT_UNKNOWN (FUSE such as sshfs, some NFS servers, XFS with ftype=0), which
// means resolving the kind with lstat instead of skipping the entry. Each test
// runs one command under `dtUnknownReaddir` (harness), which simulates such a
// filesystem with an LD_PRELOAD shim. `bun pm pack`, `bun publish` and the
// package copy done by `bun install` are covered in install/dt-unknown-readdir.test.ts.
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, dtUnknownReaddir, tempDir } from "harness";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

let shimEnv: NodeJS.Dict<string>;

beforeAll(async () => {
  if (dtUnknownReaddir.available) shimEnv = await dtUnknownReaddir.env();
}, 30_000);

async function run(
  cwd: string,
  args: string[],
  { shim = true, env = {} as Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...(shim ? shimEnv : bunEnv), ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (shim) expect(stderr).toContain(dtUnknownReaddir.marker);
  return { stdout, stderr, exitCode };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => !entry.isDirectory())
    .map(entry => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

function binsIn(binDir: string): string[] {
  // Not `existsSync(join(binDir, name))`: it follows symlinks, so it cannot see a dangling one.
  return existsSync(binDir) ? readdirSync(binDir).sort() : [];
}

// A package whose bins come from `directories.bin` (a directory to link every
// file of) rather than from `bin`. `nested/` is a directory, not a bin.
const directoriesBinPackage = (name: string) => ({
  [`${name}/package.json`]: JSON.stringify({ name, version: "1.0.0", directories: { bin: "bins" } }),
  [`${name}/bins/${name}-a`]: "#!/bin/sh\necho ran-a\n",
  [`${name}/bins/${name}-b`]: "#!/bin/sh\necho ran-b\n",
  [`${name}/bins/nested/not-a-bin`]: "",
});

const globalDirEnv = (globalDir: string) => ({
  BUN_INSTALL: globalDir,
  BUN_INSTALL_GLOBAL_DIR: join(globalDir, "install", "global"),
  BUN_INSTALL_BIN: join(globalDir, "bin"),
});

describe.skipIf(!dtUnknownReaddir.available)("on a filesystem whose readdir reports DT_UNKNOWN", () => {
  test.concurrent("bun install links the bins of a directories.bin package", async () => {
    using dir = tempDir("dt-unknown-install", {
      "package.json": JSON.stringify({ name: "app", dependencies: { dep: "file:./dep" } }),
      ...directoriesBinPackage("dep"),
    });

    const { stderr, exitCode } = await run(String(dir), ["install"], {
      env: { BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") },
    });

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(binsIn(join(String(dir), "node_modules", ".bin"))).toEqual(["dep-a", "dep-b"]);
  });

  test.concurrent("bunx finds the executable of a directories.bin package", async () => {
    using dir = tempDir("dt-unknown-bunx", {
      "package.json": JSON.stringify({ name: "app", dependencies: { tool: "file:./tool" } }),
      "tool/package.json": JSON.stringify({ name: "tool", version: "1.0.0", directories: { bin: "bins" } }),
      "tool/bins/tool-cli": "#!/bin/sh\necho tool-cli ran\n",
      "tool/bins/nested/not-a-bin": "",
    });
    chmodSync(join(String(dir), "tool", "bins", "tool-cli"), 0o755);
    const env = { BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") };
    expect(await run(String(dir), ["install"], { shim: false, env })).toMatchObject({ exitCode: 0 });

    // The bin is not named after the package, so bunx has to read the package's
    // `directories.bin` to learn its name. --no-install: failing to do so must
    // not fall through to installing the package from the registry.
    expect(await run(String(dir), ["x", "--no-install", "tool"], { env })).toEqual({
      stdout: "tool-cli ran\n",
      stderr: `${dtUnknownReaddir.marker}\n`,
      exitCode: 0,
    });
  });

  test.concurrent("bun link links the bins of a directories.bin package", async () => {
    using dir = tempDir("dt-unknown-link", directoriesBinPackage("linked"));
    const globalDir = join(String(dir), "global");

    const { stderr, exitCode } = await run(join(String(dir), "linked"), ["link"], { env: globalDirEnv(globalDir) });

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(binsIn(join(globalDir, "bin"))).toEqual(["linked-a", "linked-b"]);
  });

  test.concurrent("bun unlink removes the bins of a directories.bin package", async () => {
    using dir = tempDir("dt-unknown-unlink", directoriesBinPackage("linked"));
    const globalDir = join(String(dir), "global");
    const env = globalDirEnv(globalDir);
    expect(await run(join(String(dir), "linked"), ["link"], { shim: false, env })).toMatchObject({ exitCode: 0 });
    expect(binsIn(join(globalDir, "bin"))).toEqual(["linked-a", "linked-b"]);

    const { stderr, exitCode } = await run(join(String(dir), "linked"), ["unlink"], { env });

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(binsIn(join(globalDir, "bin"))).toEqual([]);
  });

  test.concurrent("bun remove deletes the removed package's dangling .bin symlinks", async () => {
    using dir = tempDir("dt-unknown-remove", {
      "package.json": JSON.stringify({ name: "app", dependencies: { dep: "file:./dep" } }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", bin: { "dep-cli": "cli.js" } }),
      "dep/cli.js": "",
    });
    const env = { BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache") };
    const binDir = join(String(dir), "node_modules", ".bin");
    expect(await run(String(dir), ["install"], { shim: false, env })).toMatchObject({ exitCode: 0 });
    expect(binsIn(binDir)).toEqual(["dep-cli"]);

    const { stderr, exitCode } = await run(String(dir), ["remove", "dep"], { env });

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(binsIn(binDir)).toEqual([]);
  });

  test.concurrent("bun create copies a local template", async () => {
    using dir = tempDir("dt-unknown-create", {
      "templates/tmpl/package.json": JSON.stringify({ name: "tmpl", version: "1.0.0" }),
      "templates/tmpl/index.js": "",
      "templates/tmpl/src/lib.js": "",
      "templates/tmpl/src/deep/x.js": "",
      // Skipped by name, which takes knowing that one is a directory and the other a file.
      "templates/tmpl/node_modules/left-behind.js": "",
      "templates/tmpl/yarn.lock": "",
    });

    const { stderr, exitCode } = await run(String(dir), ["create", "tmpl", "out", "--no-git", "--no-install"], {
      env: { BUN_CREATE_DIR: join(String(dir), "templates") },
    });

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    expect(filesUnder(join(String(dir), "out"))).toEqual(["index.js", "package.json", "src/deep/x.js", "src/lib.js"]);
  });

  test.concurrent("bun init does not add an entry point next to existing source files", async () => {
    using dir = tempDir("dt-unknown-init", { "app.ts": "export {};\n" });
    // `bun init` ends by running `bun install`; point it at a registry that
    // answers nothing so the test stays offline. init still exits 0 (the
    // install's 404s go to stderr), and package.json is written before it runs.
    using registry = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });

    const { stdout, exitCode } = await run(String(dir), ["init", "-y"], {
      env: {
        NPM_CONFIG_REGISTRY: `http://localhost:${registry.port}/`,
        BUN_INSTALL_CACHE_DIR: join(String(dir), ".cache"),
        BUN_AGENT_RULE_DISABLED: "1",
      },
    });

    expect(stdout).not.toContain("index.ts");
    expect(exitCode).toBe(0);
    const pkg = await Bun.file(join(String(dir), "package.json")).json();
    expect(pkg).not.toHaveProperty("module");
    expect(existsSync(join(String(dir), "index.ts"))).toBe(false);
  });
});
