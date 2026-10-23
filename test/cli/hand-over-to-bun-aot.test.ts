import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `bun` is built without the ahead-of-time compiler and `bun-aot` with it. The API does not hand over, so it tells them apart.
async function hasCompiler(): Promise<boolean> {
  using dir = tempDir("has-compiler", { "empty.ts": "export {};\n" });
  const result = await Bun.build({
    entrypoints: [join(String(dir), "empty.ts")],
    compile: { outfile: join(String(dir), "empty"), aot: true },
    throw: false,
  } as never);
  return !result.logs.some(log => String(log.message ?? log).includes("isn't available in this build of Bun"));
}

test.skipIf(isWindows)("a Bun without the compiler runs an --aot command in the bun-aot beside it", async () => {
  if (await hasCompiler()) return;

  using dir = tempDir("hand-over", { "hello.ts": "console.log(1);\n" });
  const bun = join(String(dir), "bun");
  copyFileSync(bunExe(), bun);
  chmodSync(bun, 0o755);
  const bunWithCompiler = join(String(dir), "bun-aot");
  writeFileSync(bunWithCompiler, '#!/bin/sh\necho "bun-aot: $*"\nexit 7\n');
  chmodSync(bunWithCompiler, 0o755);

  for (const command of [
    ["build", "--compile", "--aot", "hello.ts"],
    ["compile", "hello.ts"],
  ]) {
    await using proc = Bun.spawn({
      cmd: [bun, ...command],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `bun-aot: ${command.join(" ")}\n`,
      stderr: "",
      exitCode: 7,
    });
  }
});
