import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("Windows cross-compilation from POSIX should set executable permissions", async () => {
  const dir = tempDirWithFiles("windows-cross-compile-test", {
    "index.js": `console.log("Hello World");`,
  });

  // Test cross-compilation to Windows x64 baseline from POSIX host
  const outfile = join(dir, "app.exe");
  
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--target", "bun-windows-x64-baseline", "index.js", "--outfile", outfile],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);
  }
  
  expect(exitCode).toBe(0);
  
  // Check that the executable file was created
  expect(Bun.file(outfile).size).toBeGreaterThan(0);
  
  // On POSIX systems, check that the file has executable permissions
  if (process.platform !== "win32") {
    const stat = await Bun.file(outfile).stat();
    // Check that the file has execute permissions (at least for owner)
    // 0o100 is the owner execute bit
    expect(stat.mode & 0o100).toBeGreaterThan(0);
  }
});