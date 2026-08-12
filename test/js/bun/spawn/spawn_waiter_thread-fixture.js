// Spawns a child that never exits, then reports how much CPU this process (every
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

const child = spawn(process.argv0, ["-e", "Bun.sleepSync(999999999)"]);

child.once("spawn", () => {
  // The stdio streams finish wiring themselves up in the tick that emits "spawn";
  // start the window once that tick is over.
  setImmediate(() => {
    const wall0 = process.hrtime.bigint();
    const cpu0 = process.cpuUsage();

    setTimeout(() => {
      const { user, system } = process.cpuUsage(cpu0);
      const wallUs = Number((process.hrtime.bigint() - wall0) / 1000n);
      const childAlive = child.exitCode === null && child.signalCode === null;
      console.log(JSON.stringify({ cpuUs: user + system, wallUs, childAlive }));
      child.kill();
    }, 500);
  });
});
