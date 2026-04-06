import { readTarball } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Helper to normalize path separators for cross-platform tarball entry lookup
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

test("bun pm pack respects changes to package.json from prepack scripts", async () => {
  using dir = tempDir("pack-prepack", {
    "package.json": JSON.stringify(
      {
        name: "test-prepack",
        version: "1.0.0",
        scripts: {
          prepack: "node prepack.js",
        },
        description: "ORIGINAL DESCRIPTION",
      },
      null,
      2,
    ),
    "prepack.js": `
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.description = 'MODIFIED BY PREPACK';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Check stdout/stderr first to provide context on failure
  expect(stderr).not.toContain("error");
  expect(stdout).toContain("test-prepack-1.0.0.tgz");
  expect(exitCode).toBe(0);

  // Read the tarball and check the package.json inside
  const tarballPath = path.join(String(dir), "test-prepack-1.0.0.tgz");
  const tarball = readTarball(tarballPath);

  // Find the package.json entry (normalize path separators for Windows)
  const pkgJsonEntry = tarball.entries.find(
    (e: { pathname: string }) => normalizePath(e.pathname) === "package/package.json",
  );
  expect(pkgJsonEntry).toBeDefined();

  const extractedPkg = JSON.parse(pkgJsonEntry.contents);

  // The description should be modified by the prepack script
  expect(extractedPkg.description).toBe("MODIFIED BY PREPACK");
});

test("bun pm pack respects changes to package.json from prepare scripts", async () => {
  using dir = tempDir("pack-prepare", {
    "package.json": JSON.stringify(
      {
        name: "test-prepare",
        version: "1.0.0",
        scripts: {
          prepare: "node prepare.js",
        },
        keywords: ["original"],
      },
      null,
      2,
    ),
    "prepare.js": `
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.keywords = ['modified', 'by', 'prepare'];
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "pm", "pack"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Check stdout/stderr first to provide context on failure
  expect(stderr).not.toContain("error");
  expect(stdout).toContain("test-prepare-1.0.0.tgz");
  expect(exitCode).toBe(0);

  // Read the tarball and check the package.json inside
  const tarballPath = path.join(String(dir), "test-prepare-1.0.0.tgz");
  const tarball = readTarball(tarballPath);

  // Find the package.json entry (normalize path separators for Windows)
  const pkgJsonEntry = tarball.entries.find(
    (e: { pathname: string }) => normalizePath(e.pathname) === "package/package.json",
  );
  expect(pkgJsonEntry).toBeDefined();

  const extractedPkg = JSON.parse(pkgJsonEntry.contents);

  // The keywords should be modified by the prepare script
  expect(extractedPkg.keywords).toEqual(["modified", "by", "prepare"]);
});
