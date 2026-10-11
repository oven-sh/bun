// Linux only. Makes the read at child exit the one that delivers a terminal's bytes, every round: the child writes
// nothing, this script blocks until the child is a zombie (its exit is then queued in epoll and not yet dispatched),
// and only then writes to the pty slave itself. Each round has its own terminal, so no earlier read has left the pty
// master on epoll's ready list ahead of the exit. Prints one JSON line with the counts per mode.
import { closeSync, constants, openSync, readdirSync, readFileSync, readlinkSync, writeSync } from "node:fs";

const rounds = 10;

let uncaught = 0;
process.on("uncaughtException", error => {
  if (error?.message === "thrown by data") {
    uncaught++;
    return;
  }
  console.error(error);
  process.exit(1);
});

const ptySlaves = () =>
  readdirSync("/proc/self/fd")
    .map(fd => {
      try {
        return readlinkSync("/proc/self/fd/" + fd);
      } catch {
        return "";
      }
    })
    .filter(path => path.startsWith("/dev/pts/"));

function waitUntilZombie(pid: number) {
  for (;;) {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    if (stat.slice(stat.lastIndexOf(")") + 2)[0] === "Z") return;
  }
}

async function run(mode: "plain" | "close" | "throw") {
  const counts = { late: 0, inExitRead: 0, closedAtExited: 0, exitCallbacks: 0, reportedAtExited: 0 };
  for (let i = 0; i < rounds; i++) {
    const marker = `marker-${i}-end`;
    let output = "";
    let proc: Bun.Subprocess | undefined;
    let inExitRead = false;
    const uncaughtBefore = uncaught;
    const exitCallbacksBefore = counts.exitCallbacks;
    // The terminal keeps its slave open in this process, so the slave's path is the one new /dev/pts link.
    const before = ptySlaves();
    const terminal = new Bun.Terminal({
      data(term, chunk) {
        output += Buffer.from(chunk).toString();
        if (!output.includes(marker)) return;
        // The status is stored before the exit handler runs, so a reaped child means the exit read is the caller.
        if (proc?.exitCode !== null) inExitRead = true;
        if (mode === "close") term.close();
        if (mode === "throw") throw new Error("thrown by data");
      },
      exit() {
        counts.exitCallbacks++;
      },
    });
    const slavePath = ptySlaves().find(path => !before.includes(path));
    if (slavePath === undefined) {
      terminal.close();
      throw new Error("no pty slave for the new terminal");
    }
    const slave = openSync(slavePath, constants.O_WRONLY | constants.O_NOCTTY);
    try {
      proc = Bun.spawn(["true"], { terminal });
      waitUntilZombie(proc.pid);
      writeSync(slave, marker + "\n");
      await proc.exited;
      if (!output.includes(marker)) counts.late++;
      if (inExitRead) counts.inExitRead++;
      if (terminal.closed && counts.exitCallbacks === exitCallbacksBefore + 1) counts.closedAtExited++;
      if (uncaught > uncaughtBefore) counts.reportedAtExited++;
    } finally {
      closeSync(slave);
      terminal.close();
    }
  }
  return counts;
}

const report = { rounds, plain: await run("plain"), close: await run("close"), throw: await run("throw") };
console.log(JSON.stringify(report));
