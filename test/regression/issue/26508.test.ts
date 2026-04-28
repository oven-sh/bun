import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/26508
// When multiple setTimeout timers are ready to fire at the same time, Bun should
// execute all ready timer callbacks before any setImmediate callbacks that were
// scheduled by those timer callbacks. This matches Node.js behavior.
test("setImmediate scheduled by timer should run after all ready timers fire", async () => {
  // Run multiple times to catch the intermittent nature of the bug
  for (let i = 0; i < 20; i++) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          let immediateRan = false;
          let t2Ran = false;

          const t1 = setTimeout(() => {
            setImmediate(() => {
              immediateRan = true;
              // Check after both timer and immediate have run
              if (!t2Ran) {
                console.log("FAIL: immediate ran before t2");
                process.exit(1);
              }
            });
          });

          const t2 = setTimeout(() => {
            t2Ran = true;
            if (immediateRan) {
              console.log("FAIL: immediate ran before second timeout");
              process.exit(1);
            }
          });

          // Force both timers to be scheduled at the same millisecond
          // by setting them to have the same _idleStart value
          t2._idleStart = t1._idleStart;
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      console.error(`Iteration ${i} failed:`);
      console.error("stdout:", stdout);
      console.error("stderr:", stderr);
    }
    expect(exitCode).toBe(0);
  }
}, 60000); // 60 second timeout for spawning 20 subprocesses
