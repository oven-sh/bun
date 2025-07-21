import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("import.meta properties are NOT inlined without bake framework", async () => {
  const dir = tempDirWithFiles("import-meta-no-inline", {
    "index.ts": `
      console.log("dir:", import.meta.dir);
      console.log("dirname:", import.meta.dirname);  
      console.log("file:", import.meta.file);
      console.log("path:", import.meta.path);
      console.log("url:", import.meta.url);
    `,
  });

  // Run without bundling - should show actual values
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // When not bundled, these properties should resolve to actual values
  expect(stdout).toContain("dir:");
  expect(stdout).toContain("dirname:");
  expect(stdout).toContain("file:");
  expect(stdout).toContain("path:");
  expect(stdout).toContain("url:");

  // The values should NOT be inlined - they should be the actual runtime values
  expect(stdout).not.toContain("undefined");
});
