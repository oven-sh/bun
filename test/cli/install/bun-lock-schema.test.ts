import { file } from "bun";
import { expect, test } from "bun:test";
import { copyFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import type { BunLockFile, BunLockFilePackageArray } from "bun";

const isInfo = (x: unknown): boolean => typeof x === "object" && x !== null && !Array.isArray(x);
const isStr = (x: unknown): boolean => typeof x === "string";

// Classify a `packages` tuple by the documented schema. Returns null if the
// tuple matches no documented shape — which would mean the schema is incomplete.
function classify(entry: BunLockFilePackageArray): string | null {
  if (!Array.isArray(entry) || !isStr(entry[0])) return null;
  const spec = entry[0].slice(entry[0].lastIndexOf("@") + 1);

  if (spec.startsWith("workspace:")) return entry.length === 1 ? "workspace" : null;
  if (spec.startsWith("root:")) return entry.length === 2 && isInfo(entry[1]) ? "root" : null;
  if (spec.startsWith("git+") || spec.startsWith("github:")) {
    const ok =
      (entry.length === 3 || entry.length === 4) &&
      isInfo(entry[1]) &&
      isStr(entry[2]) &&
      (entry.length === 3 || isStr(entry[3]));
    return ok ? "git" : null;
  }
  if (spec.startsWith("link:")) return entry.length === 2 && isInfo(entry[1]) ? "symlink" : null;
  if (spec.startsWith("file:")) return entry.length === 2 && isInfo(entry[1]) ? "folder" : null;
  // npm: [spec, registry, info, integrity]
  if (entry.length === 4 && isStr(entry[1]) && isInfo(entry[2]) && isStr(entry[3])) return "npm";
  // tarball: [spec, info] | [spec, info, integrity]
  if ((entry.length === 2 || entry.length === 3) && isInfo(entry[1]) && (entry.length === 2 || isStr(entry[2])))
    return "tarball";
  return null;
}

// Generates a real bun.lock over local resolution kinds (no registry needed) and
// checks every emitted tuple against the schema documented in docs/pm/lockfile.mdx.
// npm/git/github shapes are covered by the type fixture and the snapshot corpus.
test("bun.lock package entries all match the documented schema", async () => {
  using dir = tempDir("bun-lock-schema", {
    "package.json": JSON.stringify({
      name: "schema-fixture",
      version: "1.0.0",
      workspaces: ["packages/*"],
      dependencies: {
        "dummy-tarball": "file:./bar-0.0.2.tgz", // tarball
        "local-folder-dep": "file:./local-folder-dep", // folder
        "ws-pkg": "workspace:*", // workspace
      },
    }),
    "local-folder-dep/package.json": JSON.stringify({ name: "local-folder-dep", version: "1.0.0" }),
    "packages/ws-pkg/package.json": JSON.stringify({ name: "ws-pkg", version: "2.0.0" }),
  });
  const root = String(dir);
  copyFileSync(join(import.meta.dir, "bar-0.0.2.tgz"), join(root, "bar-0.0.2.tgz"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install", "--save-text-lockfile"],
    cwd: root,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });

  const lock = Bun.JSONC.parse(await file(join(root, "bun.lock")).text()) as BunLockFile;

  // Every generated package entry must match a documented shape.
  const unclassified: Record<string, BunLockFilePackageArray> = {};
  const kinds = new Map<string, string>();
  for (const [name, entry] of Object.entries(lock.packages)) {
    const kind = classify(entry);
    if (kind === null) unclassified[name] = entry;
    else kinds.set(name, kind);
  }
  expect(unclassified).toEqual({});

  // The generated lockfile covers these resolution shapes hermetically. npm,
  // git/github, symlink and root are covered by the type fixture and the
  // snapshot corpus (they need a registry, `bun link`, or a git remote).
  const observed = new Set(kinds.values());
  expect([...observed].sort()).toEqual(expect.arrayContaining(["folder", "tarball", "workspace"]));

  // The local tarball entry carries a trailing integrity (the 3-element form
  // that neither the docs nor the TypeScript type described before this change).
  const tarballName = [...kinds].find(([, kind]) => kind === "tarball")?.[0];
  expect(tarballName).toBeDefined();
  const tarball = lock.packages[tarballName!] as [string, unknown, string];
  expect(tarball).toHaveLength(3);
  expect(tarball[2]).toMatch(/^sha\d+-/);
});
