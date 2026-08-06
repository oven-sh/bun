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
      env: {
        ...bunEnv,
        // The fixture distinguishes the leak (~5 KB/call retained) from
        // allocator/redzone noise by an RSS delta. ASAN's quarantine holds
        // every *freed* allocation poisoned-but-resident until it exceeds
        // quarantine_size_mb (default 256 MB); 20 000 readdirSync error paths
        // free ~100 MB of Dirent.path strings, all of which sit in the
        // quarantine and inflate RSS by exactly the amount the test is trying
        // to detect — even when nothing leaks. Disable the quarantine for
        // this measurement subprocess only; the test still flags the original
        // ~5 KB/call leak.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0"].filter(Boolean).join(":"),
      },
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
