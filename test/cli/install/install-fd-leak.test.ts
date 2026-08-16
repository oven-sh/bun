import { Archive, spawn, write } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { rm } from "fs/promises";
import { bunEnv, bunExe, isMacOS, isWindows, readdirSorted, tempDir } from "harness";
import { join } from "path";

// Installing a package with many files must not exhaust the file-descriptor
// table. Runs the linker × backend matrix from a local tarball (no registry),
// then re-installs after invalidating the existing copy to cover the
// uninstall-then-reinstall path.

const NUM_FILES = 1500;
const FD_LIMIT = 1024;

const LINKERS = ["isolated", "hoisted"] as const;
const BACKENDS = (["copyfile", "hardlink"] as const).concat(isMacOS ? (["clonefile"] as const) : []);

// `ulimit` isn't available on Windows; skip the matrix there.
describe.skipIf(isWindows)("install does not leak file descriptors", () => {
  let tgz: string;

  beforeAll(async () => {
    const pkgFiles: Record<string, string> = {
      "package/package.json": JSON.stringify({ name: "many-files-pkg", version: "1.0.0" }),
    };
    for (let i = 0; i < NUM_FILES; i++) {
      pkgFiles[`package/f${i}.js`] = `module.exports=${i};`;
    }

    // Don't `using` here: the tarball must outlive beforeAll.
    const tgzDir = tempDir("fd-leak-tgz", {});
    tgz = join(String(tgzDir), "many-files.tgz");
    await Archive.write(tgz, pkgFiles, { compress: "gzip" });
  });

  for (const linker of LINKERS) {
    for (const backend of BACKENDS) {
      test.concurrent(`--linker=${linker} --backend=${backend}`, async () => {
        using projDir = tempDir(`fd-leak-${linker}-${backend}`, {
          "package.json": JSON.stringify({
            name: "fd-leak-proj",
            dependencies: { "many-files-pkg": `file:${tgz}` },
          }),
        });
        // Per-test cache so cache state can't leak between matrix entries, and
        // so cache → node_modules stays on the same filesystem (otherwise
        // hardlink/clonefile silently fall back to copyfile and the matrix
        // doesn't actually vary).
        using cacheDir = tempDir(`fd-leak-cache-${linker}-${backend}`, {});

        const installed =
          linker === "isolated"
            ? async () => {
                const storeDir = (await readdirSorted(join(String(projDir), "node_modules", ".bun"))).find(d =>
                  d.startsWith("many-files-pkg@"),
                );
                expect(storeDir).toBeDefined();
                return join(String(projDir), "node_modules", ".bun", storeDir!, "node_modules", "many-files-pkg");
              }
            : async () => join(String(projDir), "node_modules", "many-files-pkg");

        const install = async () => {
          // Run with a low hard NOFILE limit. Bun raises the soft limit up to
          // the hard limit at startup, so the hard limit is what bounds us.
          // Without per-file fd cleanup, ~750 copyfile copies (2 fds each)
          // exceed it.
          await using proc = spawn({
            cmd: [
              "bash",
              "-c",
              `ulimit -Sn ${FD_LIMIT} && ulimit -Hn ${FD_LIMIT} && exec "$1" install --linker="$2" --backend="$3"`,
              "bash",
              bunExe(),
              linker,
              backend,
            ],
            cwd: String(projDir),
            env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
          expect(stderr).not.toContain("EMFILE");
          expect(exitCode).toBe(0);
          // Confirm the copy actually happened — every file must land.
          const files = await readdirSorted(await installed());
          expect(files.length).toBe(NUM_FILES + 1); // + package.json
        };

        // Cold install: extract tarball → cache → node_modules.
        await install();

        // Invalidate the existing install so the next install must delete and
        // re-copy from the warm cache. The verifier looks at different things
        // per linker.
        if (linker === "isolated") {
          await rm(join(String(projDir), "node_modules", ".bun"), { recursive: true, force: true });
        } else {
          await write(
            join(await installed(), "package.json"),
            JSON.stringify({ name: "many-files-pkg", version: "0.0.0-stale" }),
          );
        }

        // Warm reinstall: cache → uninstall → node_modules.
        await install();
      });
    }
  }
});
