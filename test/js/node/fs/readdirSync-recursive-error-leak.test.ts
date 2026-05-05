import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "path";

// Windows: self-referential symlinks behave differently and the recursive
// walker takes a different open path there; this leak is posix-specific.
test.skipIf(isWindows)(
  "readdirSync({recursive:true, withFileTypes:true}) error path does not leak Dirent.path",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "readdirSync-recursive-error-leak-fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("RSS delta");
    expect(exitCode).toBe(0);
  },
  90_000,
);
