// The parent process of the `timeout` tests in child_process.test.ts, and the
// child it starts. The tests are about when the parent exits and what it did
// first, so each case runs in a process of its own and reports from 'exit'.
const { writeSync } = require("node:fs");

const mode = process.argv[2];

// What a fake-timers library puts in place of the globals: timers that never
// fire and have numbers for ids, and a clear that knows only its own.
const replaceTimers = () => {
  const { setTimeout, clearTimeout } = globalThis;
  let id = 0;
  globalThis.setTimeout = () => ++id;
  globalThis.clearTimeout = () => {};
  return () => Object.assign(globalThis, { setTimeout, clearTimeout });
};
const restoreTimers = mode === "timers replaced while the module loads, then restored" && replaceTimers();
const { spawn, fork, exec, execFile } = require("node:child_process");
if (restoreTimers) restoreTimers();

// A deadline the parent must reach, and one it must clear long before. The second is longer than the
// test timeout of every CI lane (scripts/runner.node.ts), so a parent that waits for it fails its test.
const soon = 200;
const never = 600_000;

if (mode === "idle") {
  // Long enough for every case to end it, and not for ever when a run fails to.
  setTimeout(() => {}, 30_000);
} else if (mode === "brief") {
  setTimeout(() => {}, 3 * soon);
} else if (mode === "leaves its pipes open") {
  // Exits at once. A process of its own holds stdout and stderr a little longer.
  spawn(process.execPath, [__filename, "brief"], { stdio: "inherit", detached: true }).unref();
} else if (mode !== "exit") {
  const idle = [__filename, "idle"];
  const brief = [__filename, "brief"];
  const exits = [__filename, "exit"];
  const events = [];
  let kills = 0;
  let callback;
  const done = error => {
    callback = error ? { killed: !!error.killed } : "no error";
  };
  const watch = child => {
    const kill = child.kill;
    child.kill = function (...args) {
      kills++;
      const sent = kill.apply(this, args);
      // The deadline is over. Staying to reap the child leaves no zombie for the test to take for alive.
      this.ref();
      return sent;
    };
    for (const event of ["error", "exit", "close"]) child.on(event, () => events.push(event));
    process.on("exit", () => {
      writeSync(1, JSON.stringify({ pid: child.pid, killed: child.killed, kills, events, callback }));
    });
    return child;
  };
  // Leaves the deadline as the only thing that can keep this process alive.
  const forget = child => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
  };

  switch (mode) {
    case "spawn":
    case "timers replaced while the module loads, then restored":
      forget(watch(spawn(process.execPath, idle, { stdio: "ignore", detached: true, timeout: soon })));
      break;
    case "fork": {
      const child = watch(fork(__filename, ["idle"], { stdio: "ignore", detached: true, timeout: soon }));
      forget(child);
      child.disconnect();
      break;
    }
    case "execFile":
      forget(watch(execFile(process.execPath, idle, { timeout: soon }, done)));
      break;
    case "exec": {
      // `exec` makes the shell become the child, so the pid reported is the one the signal has to reach.
      // cmd.exe has no `exec`. There the signal ends the shell only, so its child is one that ends by itself.
      const posix = process.platform !== "win32";
      const command = `"${process.execPath}" "${__filename}" ${posix ? "idle" : "brief"}`;
      forget(watch(exec(posix ? `exec ${command}` : command, { timeout: soon }, done)));
      break;
    }
    case "execFile, pipes open at the deadline":
      watch(execFile(process.execPath, idle, { timeout: soon }, done));
      break;
    case "execFile, 'error' before the deadline":
      watch(execFile(process.execPath, brief, { timeout: soon }, done)).emit("error", new Error("early"));
      break;
    case "spawn, child exits first":
      watch(spawn(process.execPath, exits, { timeout: never })).unref();
      break;
    case "fork, child exits first":
      watch(fork(__filename, ["exit"], { stdio: "ignore", timeout: never })).unref();
      break;
    case "execFile, child exits first":
      forget(watch(execFile(process.execPath, exits, { timeout: never }, done)));
      break;
    case "spawn, 'exit' listener pauses stdout": {
      const child = watch(spawn(process.execPath, exits, { timeout: never }));
      child.once("exit", () => child.stdout.pause());
      break;
    }
    case "execFile, 'exit' listener pauses the pipes": {
      const child = watch(execFile(process.execPath, [__filename, "leaves its pipes open"], { timeout: never }, done));
      child.once("exit", () => {
        child.stdout.pause();
        child.stderr.pause();
      });
      break;
    }
    case "spawn of a missing file":
      watch(spawn(__filename + ".does-not-exist", [], { timeout: never }));
      break;
    case "spawn, timers replaced after the module loaded":
      replaceTimers();
      watch(spawn(process.execPath, exits, { stdio: "ignore", timeout: never })).unref();
      break;
    case "execFile, timers replaced after the module loaded":
      replaceTimers();
      forget(watch(execFile(process.execPath, exits, { timeout: never }, done)));
      break;
    case "execFile of a missing file, timers replaced after the module loaded":
      replaceTimers();
      watch(execFile(__filename + ".does-not-exist", { timeout: never }, done));
      break;
    case "no timeout":
      forget(watch(spawn(process.execPath, idle, { stdio: "ignore", detached: true })));
      break;
    case "spawn in a Bun.ModuleGraph that is disposed": {
      // A disposed graph hears no 'close'. Its timers end with it.
      const graph = new Bun.ModuleGraph();
      watch(graph.run(() => spawn(process.execPath, idle, { stdio: "ignore", timeout: never })));
      graph.dispose();
      break;
    }
    default:
      throw new Error(`unknown mode: ${mode}`);
  }
}
