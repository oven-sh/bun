import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

// Bun.build({ compile }) inside a compiled executable takes that executable as its template, and so may --compile-executable-path.
test("a compiled executable is the template of a program that is smaller than its own", async () => {
  using dir = tempDir("compile-onto-a-compiled-executable", {
    "large.ts": `console.log("${Buffer.alloc(200_000, "x").toString()}".length);`,
    "small.ts": `console.log("small");`,
  });
  const folder = String(dir);
  const large = await run([bunExe(), "build", "--compile", "large.ts", "--outfile", "large"], folder);
  expect({ stderr: large.exitCode ? large.stderr : "", exitCode: large.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const small = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--compile-executable-path",
      join(folder, isWindows ? "large.exe" : "large"),
      "small.ts",
      "--outfile",
      "small",
    ],
    folder,
  );
  expect({ stderr: small.exitCode ? small.stderr : "", exitCode: small.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([join(folder, "small")], folder)).toEqual({ stdout: "small\n", stderr: "", exitCode: 0 });
  expect(await run([join(folder, "large")], folder)).toEqual({ stdout: "200000\n", stderr: "", exitCode: 0 });
});
