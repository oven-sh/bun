import { Archive } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { rmSync, statSync } from "node:fs";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { join } from "path";

// Per-backend materialization correctness: the tree must match the package
// byte-for-byte, hardlink must actually link (nlink > 1), and a --force
// reinstall must restore tampered files. Guards the per-file install paths in
// src/install/PackageInstall.rs (install_with_hardlink / install_with_copyfile).

const BACKENDS = (["hardlink", "copyfile"] as const).concat(isMacOS ? (["clonefile"] as const) : []);

const PKG_FILES: Record<string, string> = {
  "package/package.json": JSON.stringify({ name: "backend-pkg", version: "1.0.0", main: "index.js" }),
  "package/index.js": `module.exports = require("./lib/a.js") + require("./lib/deep/b.js");\n`,
  "package/lib/a.js": `module.exports = "a".repeat(64);\n`,
  "package/lib/deep/b.js": `module.exports = "b".repeat(64);\n`,
  "package/README.md": `# backend-pkg\n`,
};

let tgz: string;

beforeAll(async () => {
  // Not `using`: the tarball must outlive beforeAll.
  const tgzDir = tempDir("install-backends-tgz", {});
  tgz = join(String(tgzDir), "backend-pkg.tgz");
  await Archive.write(tgz, PKG_FILES, { compress: "gzip" });
});

describe.concurrent("install --backend materializes the package", () => {
  for (const backend of BACKENDS) {
    test(`--backend=${backend}`, async () => {
      using projDir = tempDir(`install-backend-${backend}`, {
        "package.json": JSON.stringify({
          name: "consumer",
          version: "1.0.0",
          dependencies: { "backend-pkg": `file:${tgz.replaceAll("\\", "/")}` },
        }),
      });
      using cacheDir = tempDir(`install-backend-cache-${backend}`, {});
      const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: String(cacheDir) };

      async function install(extraArgs: string[]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--backend", backend, ...extraArgs],
          cwd: String(projDir),
          env,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode };
      }

      const first = await install([]);
      const pkgDir = join(String(projDir), "node_modules", "backend-pkg");

      // Every file materialized with identical contents.
      for (const [archivePath, contents] of Object.entries(PKG_FILES)) {
        const rel = archivePath.replace("package/", "");
        expect(await Bun.file(join(pkgDir, rel)).text()).toBe(contents);
      }

      // hardlink must share the inode with the cache copy; copy-based
      // backends must not.
      const nlink = statSync(join(pkgDir, "lib", "deep", "b.js")).nlink;
      if (backend === "hardlink") {
        expect(nlink).toBeGreaterThan(1);
      } else {
        expect(nlink).toBe(1);
      }

      expect(first.exitCode).toBe(0);

      // A forced reinstall must re-materialize deleted files through the same
      // backend. (Deletion, not tampering: with hardlink the node_modules name
      // shares the cache inode, so writes through it would corrupt the cache.)
      rmSync(join(pkgDir, "lib", "a.js"));
      const second = await install(["--force"]);
      expect(await Bun.file(join(pkgDir, "lib", "a.js")).text()).toBe(PKG_FILES["package/lib/a.js"]);
      expect(second.exitCode).toBe(0);
    });
  }
});
