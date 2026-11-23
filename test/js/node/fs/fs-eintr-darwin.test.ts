// Issue #41085: on macOS, the syscall wrappers behind node:fs issued a single
// $NOCANCEL call and surfaced raw EINTR to JS instead of retrying. Node
// (libuv) and Bun's Linux wrappers retry EINTR, so application code never
// expects it. This test only runs on macOS: the single-shot arms were gated
// #[cfg(target_os = "macos")], and other platforms already retried.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { join } from "node:path";

test.skipIf(!isMacOS)("fs.openSync retries EINTR instead of surfacing it", async () => {
  using dir = tempDir("fs-eintr", {});
  const fifo = join(String(dir), "fs-eintr.fifo");
  mkfifo(fifo);

  // The fixture blocks its main thread in open(2) on the fifo while a worker
  // thread pelts that thread with SIGUSR1 (handler installed without
  // SA_RESTART, so every delivery interrupts the syscall with EINTR). The
  // worker then opens the write end to let the open complete.
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "fs-eintr-open-fixture.ts"), fifo],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) {
    // Surface the fixture's stderr (the EINTR error) in the failure message.
    expect(stderr).toBe("");
  }
  expect(stdout).toBe("unblocked\n");
  expect(exitCode).toBe(0);
});
