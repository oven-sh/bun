// Spawns a child that stays blocked, then reports how much CPU this process (every
// thread, so the waiter thread counts) burns over a window spent doing nothing but
// waiting on that child. Measured in-process rather than via the parent's
// resourceUsage() so startup and module loading, which cost over a second of CPU
// on a debug build, stay out of the number.
const { spawn } = require("child_process");

if (!process.env.WITHOUT_WAITER_THREAD) {
  if (!process.env.BUN_GARBAGE_COLLECTOR_LEVEL || !process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD) {
    throw new Error("This test must be run with BUN_GARBAGE_COLLECTOR_LEVEL and BUN_FEATURE_FLAG_FORCE_WAITER_THREAD");
  }
}

// Outlives any per-test timeout, so the child is still alive for the whole window,
// but bounded: a run that dies before the kill() below must not leave it behind.
const child = spawn(process.argv0, ["-e", "Bun.sleepSync(10 * 60 * 1000)"]);

child.once("spawn", () => {
  // "spawn" is emitted while the entrypoint's microtasks drain. The GC bun runs after
  // evaluating the entrypoint and the first turn of the event loop both come after it,
  // so start the window once the loop has been around once.
  setImmediate(() => {
    const wall0 = process.hrtime.bigint();
    const cpu0 = process.cpuUsage();

    setTimeout(() => {
      const { user, system } = process.cpuUsage(cpu0);
      const wallUs = Number((process.hrtime.bigint() - wall0) / 1000n);
      const childAlive = child.exitCode === null && child.signalCode === null;
      child.kill();
      console.log(JSON.stringify({ cpuUs: user + system, wallUs, childAlive }));
    }, 500);
  });
});
