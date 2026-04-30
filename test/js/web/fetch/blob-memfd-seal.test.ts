import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// On Linux, large Blob payloads are backed by a memfd that is mmap'd
// MAP_SHARED. If that memfd's size is reduced from under the mapping
// (e.g. a user passes the descriptor number to Bun.file(fd).write() or
// fs.ftruncateSync), the finalizer's safety memset would touch unbacked
// pages during GC and SIGBUS the process.
describe.skipIf(process.platform !== "linux")("Blob memfd backing", () => {
  test("is sealed against shrinking", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const fs = require("node:fs");
          // > 8 MiB so the memfd path is taken.
          let blob = new Blob([new Uint8Array(16 * 1024 * 1024)]);
          if (blob.size !== 16 * 1024 * 1024) process.exit(2);

          for (let fd = 3; fd < 64; fd++) {
            try {
              if (fs.readlinkSync(\`/proc/self/fd/\${fd}\`).includes("memfd")) {
                try {
                  fs.ftruncateSync(fd, 0);
                  console.error("ftruncate unexpectedly succeeded on memfd", fd);
                  process.exit(3);
                } catch {}
                break;
              }
            } catch {}
          }

          blob = null;
          Bun.gc(true);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  test("finalizer survives writes to the backing fd", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const fs = require("node:fs");
          let held = [];
          let fd;
          for (let i = 0; i < 4; i++) {
            held.push(new Blob([new Uint8Array(16 * 1024 * 1024)]));
            if (fd === undefined) {
              for (let f = 3; f < 64; f++) {
                try {
                  if (fs.readlinkSync(\`/proc/self/fd/\${f}\`).includes("memfd")) { fd = f; break; }
                } catch {}
              }
            }
          }

          if (fd !== undefined) {
            // Previously truncated the memfd, then SIGBUS'd in the finalizer.
            await Bun.file(fd).write(Bun.file(fd)).catch(() => {});
          }

          held = null;
          Bun.gc(true);
          Bun.gc(true);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});
