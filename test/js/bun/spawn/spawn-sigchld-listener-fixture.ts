// SIGCHLD has one disposition. process.on("SIGCHLD") needs it, and with
// BUN_FEATURE_FLAG_FORCE_WAITER_THREAD the waiter thread needs it too: SIGCHLD is what
// tells that thread to call wait4() again. Each one must keep working when the other one
// starts or stops.
//
// argv[2] is "before" or "after": when the listener is added, relative to the first spawn.
// The first spawn starts the waiter thread. Prints one line per child exit.
import { spawn } from "bun";

let signals = 0;
let waiting: { count: number; resolve: () => void } | undefined;

function onSIGCHLD() {
  signals++;
  if (waiting && signals >= waiting.count) waiting.resolve();
}

function signalCount(count: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  waiting = { count, resolve };
  if (signals >= count) resolve();
  return promise;
}

// One child changes state at a time, and the listener hears each change before the next
// one. So each change is one SIGCHLD.
let expectedSignals = 0;

async function childExit(child: string, listening: boolean, stopAndContinue = false) {
  const proc = spawn({ cmd: ["cat"], stdin: "pipe", stdout: "pipe", stderr: "inherit" });

  // The echo shows that the child runs. The waiter thread called wait4() for it when it was
  // spawned, and now sleeps. Only SIGCHLD wakes it for the exit.
  proc.stdin.write("x");
  await proc.stdin.flush();
  await proc.stdout.getReader().read();

  if (stopAndContinue) {
    // A listener also hears a child that stops and a child that continues.
    proc.kill("SIGSTOP");
    await signalCount(++expectedSignals);
    proc.kill("SIGCONT");
    await signalCount(++expectedSignals);
  }

  await proc.stdin.end();
  const exitCode = await proc.exited;
  if (listening) await signalCount(++expectedSignals);

  console.log(JSON.stringify({ child, exitCode, signals }));
}

const order = process.argv[2];

if (order === "before") process.on("SIGCHLD", onSIGCHLD);
await childExit("first spawn", order === "before");

if (order === "after") process.on("SIGCHLD", onSIGCHLD);
await childExit("second spawn", true, true);

process.off("SIGCHLD", onSIGCHLD);
await childExit("listener removed", false);
