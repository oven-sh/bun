import { test, expect } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";

// When a raw file descriptor number is passed in the stdio array at an
// index > 2, Bun.spawn does not own that fd and must not close it when the
// Subprocess is finalized.
test.skipIf(!isPosix)(
  "Bun.spawn does not close user-provided extra stdio fds",
  async () => {
    using dir = tempDir("spawn-extra-fd", {
      "run.js": `
      const { openSync, fstatSync, readFileSync } = require("node:fs");
      const path = require("node:path");

      const file = path.join(process.argv[2], "out.txt");
      const fd = openSync(file, "w");

      async function once() {
        const proc = Bun.spawn({
          cmd: ["/bin/sh", "-c", "echo hi >&3"],
          stdio: ["ignore", "ignore", "ignore", fd],
        });
        await proc.exited;
      }

      for (let i = 0; i < 4; i++) {
        await once();
        Bun.gc(true);
        await Bun.sleep(1);
        Bun.gc(true);
      }

      // If Bun had closed fd during finalization of one of the subprocesses
      // above, the next fstat would fail with EBADF (or worse, the fd slot
      // could have been reused by an unrelated file).
      fstatSync(fd);

      // Also make sure the child was actually able to write through fd 3 so
      // we know the fd was wired up.
      const contents = readFileSync(file, "utf8");
      if (!contents.includes("hi")) {
        throw new Error("child did not write to fd 3: " + JSON.stringify(contents));
      }

      console.log("ok");
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", String(dir)],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const stderrLines = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderrLines).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
  20000,
);
