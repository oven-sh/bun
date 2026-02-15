import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/18242
// NotOpenForReading for subsequent builds. Same root cause as #9517 and #26075:
// FileSystemRouter caches FDs, BundleThread (store_fd=false) borrows and closes
// them, subsequent builds get NotOpenForReading errors.

test("Multiple Bun.build calls with FileSystemRouter entrypoints should not fail", async () => {
  const dir = tempDirWithFiles("issue-18242", {
    "pages/index.ts": `console.log("Hello via Bun!");`,
    "build.ts": `import path from 'path';

const PROJECT_ROOT = process.cwd();
const PAGES_DIR = path.resolve(PROJECT_ROOT, 'pages');

const srcRouter = new Bun.FileSystemRouter({
  dir: PAGES_DIR,
  style: 'nextjs',
});

const entrypoints = Object.values(srcRouter.routes);

async function build() {
  console.log("Starting first build...");
  const first = await Bun.build({
    entrypoints: entrypoints,
    outdir: "dist/browser",
  });
  if (!first.success) {
    const errors = first.logs.map(k => Bun.inspect(k)).join("\\n");
    throw new Error("First build failed: " + errors);
  }
  console.log("First build complete");

  console.log("Starting second build...");
  const second = await Bun.build({
    entrypoints: entrypoints,
    outdir: "dist/bun",
    target: "bun",
  });
  if (!second.success) {
    const errors = second.logs.map(k => Bun.inspect(k)).join("\\n");
    throw new Error("Second build failed: " + errors);
  }
  console.log("Second build complete");
}

await build();
console.log("SUCCESS: Both builds completed");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should not have the characteristic error from #18242
  expect(stderr).not.toContain("NotOpenForReading");
  expect(stderr).not.toContain("Unexpected reading file");
  expect(stderr).not.toContain("EBADF");

  // Both builds should complete successfully
  expect(stdout).toContain("First build complete");
  expect(stdout).toContain("Second build complete");
  expect(stdout).toContain("SUCCESS: Both builds completed");

  expect(exitCode).toBe(0);
});
