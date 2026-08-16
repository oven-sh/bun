import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/25609
test("empty object in spread with DCE does not produce invalid syntax", async () => {
  using dir = tempDir("25609", {
    "chunk.js": `module.exports=()=>{var a,b=({...a,x:{}},0)};`,
    "index.js": `require('./chunk.js');`,
  });

  // This should not throw a syntax error when requiring the module
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
