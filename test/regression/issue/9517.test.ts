import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/9517
// Intermittent errors with Bun.build and Bun.FileSystemRouter when importing
// absolute paths. Same root cause as #26075: non-owning resolvers borrow
// cached FDs from the singleton FileSystem cache.

test("FileSystemRouter + Bun.build should not cause intermittent file reading errors", async () => {
  const dir = tempDirWithFiles("issue-9517", {
    "pages/index.ts": `export default function home() {
  return "Home Page";
}`,
    // Placeholder - will be overwritten with absolute path
    "pages/_entry.ts": `PLACEHOLDER`,
    "server.ts": `const router = new Bun.FileSystemRouter({
  style: "nextjs",
  dir: "./pages",
});

async function doBuild() {
  const result = await Bun.build({
    entrypoints: ['./pages/_entry.ts'],
  });

  if (!result.success) {
    const errors = result.logs.map(k => Bun.inspect(k)).join("\\n");
    throw new Error("Build failed: " + errors);
  }

  return result.outputs.find(k => k.kind === 'entry-point');
}

// Multiple builds to trigger the stale FD race condition.
await doBuild();
console.log("Build 1 success");

await doBuild();
console.log("Build 2 success");

console.log("SUCCESS: All builds completed");`,
  });

  // Write the _entry.ts file with absolute path to trigger the bug
  // (issue #9517 specifically mentions that absolute paths trigger it)
  const indexPath = join(dir, "pages/index.ts");
  await Bun.write(
    join(dir, "pages/_entry.ts"),
    `import PageComponent from "${indexPath.replace(/\\/g, "/")}";
console.log("Loaded:", PageComponent.name);
export { PageComponent };`,
  );

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: dir,
    env: bunEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should not have file reading errors characteristic of the bug
  expect(stderr).not.toContain("Unexpected reading file");
  expect(stderr).not.toContain("NotOpenForReading");
  expect(stderr).not.toContain("EBADF");
  expect(stderr).not.toContain("bad file descriptor");

  // All builds should succeed
  expect(stdout).toContain("Build 1 success");
  expect(stdout).toContain("Build 2 success");
  expect(stdout).toContain("SUCCESS: All builds completed");

  expect(exitCode).toBe(0);
});
