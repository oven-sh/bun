// A symlink in the package cache must still reach node_modules. Every backend
// recreates it as a symlink when its target stays inside the package, the
// rule the tarball extractor already applies. A symlink that leaves the
// package is left out.
// https://github.com/oven-sh/bun/issues/43788
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

// Move every regular file under `dir` into `dir/.store` and leave a relative
// symlink in its place.
function symlinkFiles(dir: string) {
  const store = join(dir, ".store");
  mkdirSync(store);
  let n = 0;
  const walk = (cur: string) => {
    for (const name of readdirSync(cur)) {
      const p = join(cur, name);
      if (p === store) continue;
      const st = lstatSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (st.isFile()) {
        const backing = join(store, `${n++}`);
        renameSync(p, backing);
        symlinkSync(relative(dirname(p), backing), p);
      }
    }
  };
  walk(dir);
  return n;
}

async function install(cwd: string, cache: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error");
  expect(stdout).toMatch(/\d+ packages? installed/);
  expect(exitCode).toBe(0);
}

describe.skipIf(isWindows)("install from a cache whose files are symlinks", () => {
  describe.each(["hardlink", "copyfile", "symlink"])("%s backend", backend => {
    describe.each(["hoisted", "isolated"])("%s linker", linker => {
      test.concurrent("installs the package files", async () => {
        using dir = tempDir(`symlinked-cache-${backend}-${linker}`, {
          "package.json": JSON.stringify({
            name: "symlinked-cache-test",
            dependencies: { bar: "file:./bar-0.0.2.tgz" },
          }),
        });
        cpSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(String(dir), "bar-0.0.2.tgz"));
        const cache = join(String(dir), "cache");

        // Populate the cache, then turn every cached file into a symlink.
        await install(String(dir), cache, ["--backend", "copyfile"]);
        const cached = readdirSync(cache).filter(name => name.startsWith("@T@"));
        expect(cached).toHaveLength(1);
        const pkg = join(cache, cached[0]);
        mkdirSync(join(pkg, "cjs"));
        writeFileSync(join(pkg, "cjs", "index.js"), "module.exports = 'cjs';");
        expect(symlinkFiles(pkg)).toBe(2);
        // Symlinks that leave the package, by an absolute or a climbing
        // relative target, must not reach node_modules.
        writeFileSync(join(cache, "outside.js"), "module.exports = 1;");
        symlinkSync(join(cache, "outside.js"), join(pkg, "absolute.js"));
        symlinkSync(join("..", "outside.js"), join(pkg, "climbing.js"));
        symlinkSync("absolute.js", join(pkg, "indirect.js"));
        rmSync(join(String(dir), "node_modules"), { recursive: true });

        await install(String(dir), cache, ["--backend", backend, "--linker", linker]);
        const installed = join(String(dir), "node_modules", "bar");
        expect(lstatSync(join(installed, "package.json")).isSymbolicLink()).toBe(true);
        expect(await Bun.file(join(installed, "package.json")).json()).toMatchObject({
          name: "bar",
          version: "0.0.2",
        });
        expect(lstatSync(join(installed, "cjs", "index.js")).isSymbolicLink()).toBe(true);
        expect(await Bun.file(join(installed, "cjs", "index.js")).text()).toBe("module.exports = 'cjs';");
        expect(() => lstatSync(join(installed, "absolute.js"))).toThrow("ENOENT");
        expect(() => lstatSync(join(installed, "climbing.js"))).toThrow("ENOENT");
        // A link to a left-out link must not resolve through the cache either.
        expect(() => realpathSync(join(installed, "indirect.js"))).toThrow("ENOENT");
      });
    });
  });
});

// A folder dependency is linked into the isolated store again on every
// install. A file that replaces an in-package symlink must replace the stale
// link in the store, not write through it.
test.skipIf(isWindows)("isolated store follows a folder dependency whose symlink becomes a file", async () => {
  using dir = tempDir("symlink-to-file", {
    "package.json": JSON.stringify({
      name: "symlink-to-file-test",
      dependencies: { dep: "file:./dep" },
    }),
    "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    "dep/lib/real.js": "module.exports = 'real';",
  });
  const cache = join(String(dir), "cache");
  const dep = join(String(dir), "dep");
  symlinkSync(join("lib", "real.js"), join(dep, "index.js"));

  await install(String(dir), cache, ["--linker", "isolated"]);
  const installed = join(String(dir), "node_modules", "dep");
  expect(lstatSync(join(installed, "index.js")).isSymbolicLink()).toBe(true);
  expect(await Bun.file(join(installed, "index.js")).text()).toBe("module.exports = 'real';");

  rmSync(join(dep, "index.js"));
  writeFileSync(join(dep, "index.js"), "module.exports = 'file';");
  await install(String(dir), cache, ["--linker", "isolated"]);
  expect(lstatSync(join(installed, "index.js")).isSymbolicLink()).toBe(false);
  expect(await Bun.file(join(installed, "index.js")).text()).toBe("module.exports = 'file';");
  expect(await Bun.file(join(installed, "lib", "real.js")).text()).toBe("module.exports = 'real';");
});

test.skipIf(isWindows)(
  "isolated store follows a folder dependency whose dangling symlink becomes a directory",
  async () => {
    using dir = tempDir("symlink-to-dir", {
      "package.json": JSON.stringify({
        name: "symlink-to-dir-test",
        dependencies: { dep: "file:./dep" },
      }),
      "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
    });
    const cache = join(String(dir), "cache");
    const dep = join(String(dir), "dep");
    symlinkSync(join("build", "dist"), join(dep, "dist"));

    await install(String(dir), cache, ["--linker", "isolated"]);
    const installed = join(String(dir), "node_modules", "dep");
    expect(lstatSync(join(installed, "dist")).isSymbolicLink()).toBe(true);

    rmSync(join(dep, "dist"));
    mkdirSync(join(dep, "dist", "esm"), { recursive: true });
    writeFileSync(join(dep, "dist", "esm", "index.js"), "module.exports = 'esm';");
    await install(String(dir), cache, ["--linker", "isolated"]);
    expect(lstatSync(join(installed, "dist")).isDirectory()).toBe(true);
    expect(await Bun.file(join(installed, "dist", "esm", "index.js")).text()).toBe("module.exports = 'esm';");
  },
);
