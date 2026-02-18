import { file, spawn, write } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "fs";
import { readdir } from "fs/promises";
import { VerdaccioRegistry, bunEnv, bunExe } from "harness";
import { join } from "path";

// Issue #27095: bun install silently skips files when linking packages from
// cache to node_modules on NFS/FUSE/bind-mount filesystems that return
// DT_UNKNOWN for d_type.
//
// The fix adds resolve_unknown_entry_types to the walker so it falls back to
// fstatat() for unknown entries.  This test verifies that all backends
// (clonefile, hardlink, copyfile) correctly install every file from a package
// with a deeply nested directory structure.

const registry = new VerdaccioRegistry();

beforeAll(async () => {
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

/** Recursively count all files and directories under `dir`. */
async function countEntriesRecursive(dir: string): Promise<number> {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    count++;
    if (entry.isDirectory()) {
      count += await countEntriesRecursive(join(dir, entry.name));
    }
  }
  return count;
}

for (const backend of ["clonefile", "hardlink", "copyfile"]) {
  test(`all files installed with backend: ${backend} (#27095)`, async () => {
    const { packageJson, packageDir } = await registry.createTestDir({
      bunfigOpts: { linker: "isolated" },
    });

    // Create a file dependency with a nested directory tree.
    // This mimics what happens with packages like typescript that have
    // many files in deeply nested directories - the exact scenario
    // where DT_UNKNOWN would cause silent skipping.
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "nested-pkg", version: "1.0.0" }),
      "index.js": "module.exports = 'root';",
      "lib/a.js": "module.exports = 'a';",
      "lib/b.js": "module.exports = 'b';",
      "lib/types/a.d.ts": "export declare const a: string;",
      "lib/types/b.d.ts": "export declare const b: string;",
      "lib/types/nested/c.d.ts": "export declare const c: string;",
      "lib/types/nested/d.d.ts": "export declare const d: string;",
      "lib/types/nested/deep/e.d.ts": "export declare const e: string;",
    };

    // Write the nested package files
    await Promise.all(
      Object.entries(files).map(([path, content]) => write(join(packageDir, "nested-pkg", path), content)),
    );

    await write(
      packageJson,
      JSON.stringify({
        name: "test-27095",
        dependencies: {
          "nested-pkg": "file:./nested-pkg",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--backend", backend],
      cwd: packageDir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const err = await stderr.text();
    const out = await stdout.text();

    expect(err).not.toContain("error");

    // Verify every single file was installed
    const installedBase = join(
      packageDir,
      "node_modules",
      ".bun",
      "nested-pkg@file+nested-pkg",
      "node_modules",
      "nested-pkg",
    );

    // Check each expected file exists and has correct content
    for (const [path, expectedContent] of Object.entries(files)) {
      const fullPath = join(installedBase, path);
      expect(existsSync(fullPath)).toBe(true);
      if (path.endsWith(".json")) {
        expect(await file(fullPath).json()).toEqual(JSON.parse(expectedContent));
      } else {
        expect(await file(fullPath).text()).toBe(expectedContent);
      }
    }

    // Verify the nested directories exist
    expect(existsSync(join(installedBase, "lib"))).toBe(true);
    expect(existsSync(join(installedBase, "lib", "types"))).toBe(true);
    expect(existsSync(join(installedBase, "lib", "types", "nested"))).toBe(true);
    expect(existsSync(join(installedBase, "lib", "types", "nested", "deep"))).toBe(true);

    // Verify total count matches (9 files + 4 directories = 13 entries)
    const totalEntries = await countEntriesRecursive(installedBase);
    expect(totalEntries).toBe(13);

    expect(await exited).toBe(0);
  });
}
