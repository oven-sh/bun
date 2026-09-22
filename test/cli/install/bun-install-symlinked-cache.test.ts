// A symlink in the package cache must still reach node_modules. Every backend
// recreates it as a symlink, the way the macOS clonefile backend already does.
// The hardlink backend in proot's link2symlink (Termux proot-distro) leaves
// the cache full of such entries after the first install.
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
import { join } from "node:path";

// Replace every regular file under `dir` with a symlink to a copy of it in `store`.
function symlinkFiles(dir: string, store: string) {
  let n = 0;
  const walk = (cur: string) => {
    for (const name of readdirSync(cur)) {
      const p = join(cur, name);
      const st = lstatSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (st.isFile()) {
        const backing = join(store, `${n++}`);
        renameSync(p, backing);
        symlinkSync(backing, p);
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
        const store = join(String(dir), "store");
        mkdirSync(store);

        // Populate the cache, then turn every cached file into a symlink.
        await install(String(dir), cache, ["--backend", "copyfile"]);
        const cached = readdirSync(cache).filter(name => name.startsWith("@T@"));
        expect(cached).toHaveLength(1);
        expect(symlinkFiles(join(cache, cached[0]), store)).toBeGreaterThan(0);
        // A symlink that points outside the package must stay a symlink in
        // node_modules. The installer never copies its target.
        writeFileSync(join(cache, "outside.js"), "module.exports = 1;");
        symlinkSync(join(cache, "outside.js"), join(cache, cached[0], "outside.js"));
        rmSync(join(String(dir), "node_modules"), { recursive: true });

        await install(String(dir), cache, ["--backend", backend, "--linker", linker]);
        const installed = join(String(dir), "node_modules", "bar");
        expect(await Bun.file(join(installed, "package.json")).json()).toMatchObject({
          name: "bar",
          version: "0.0.2",
        });
        expect(lstatSync(join(installed, "outside.js")).isSymbolicLink()).toBe(true);
        expect(realpathSync(join(installed, "outside.js"))).toBe(realpathSync(join(cache, "outside.js")));
      });
    });
  });
});
