// Spawns a child that stays alive, then reports how much CPU this process (every
// thread, so a waiter thread counts) burns over a window in which the only thing
// left to do is wait for that child. Measured in-process rather than through the
// parent's resourceUsage() so startup and module loading, which cost over a second
// of CPU on a debug build, stay out of the number.
import { readdirSync, readFileSync } from "fs";

if (!process.env.WITHOUT_WAITER_THREAD) {
  if (!process.env.BUN_GARBAGE_COLLECTOR_LEVEL || !process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD) {
    throw new Error("This test must be run with BUN_GARBAGE_COLLECTOR_LEVEL and BUN_FEATURE_FLAG_FORCE_WAITER_THREAD");
  }
}

// Alive until its stdin is closed, so it is being watched for the whole window.
const child = Bun.spawn({
  cmd: [process.execPath, "-e", "await Bun.stdin.text()"],
  stdin: "pipe",
  stdout: "ignore",
  stderr: "inherit",
});

// The waiter thread names itself "Waitpid". Linux exposes thread names, so there the
// report also proves which of the two modes was actually running.
function hasWaiterThread() {
  if (process.platform !== "linux") return null;
  return readdirSync("/proc/self/task").some(
    tid => readFileSync(`/proc/self/task/${tid}/comm`, "utf8").trim() === "Waitpid",
  );
}

// Start the window once the event loop has been around once, so the work that
// follows evaluating the entrypoint is not counted.
setImmediate(() => {
  const wall0 = process.hrtime.bigint();
  const cpu0 = process.cpuUsage();

  setTimeout(async () => {
    const { user, system } = process.cpuUsage(cpu0);
    const wallUs = Number((process.hrtime.bigint() - wall0) / 1000n);
    const waiterThread = hasWaiterThread();

    // The child exits only now, after whatever watches it has been idle for the whole
    // window, so its exit has to wake that watcher up.
    child.stdin.end();
    const exitCode = await child.exited;

    console.log(JSON.stringify({ cpuUs: user + system, wallUs, waiterThread, exitCode }));
  }, 500);
});
