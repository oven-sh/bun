// A write is parked on child.stdin when the child exits. In most cases a process that the child started (the holder)
// still holds the pipe, so the pipe is not broken.
// Prints one line per case: the events in the order they came. Runs under bun and under node.
// usage: <runtime> stdin-held-exit-fixture.js <case title>[ x<times>]...
const { execFileSync, spawn } = require("node:child_process");
const { once } = require("node:events");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Readable, finished, pipeline } = require("node:stream");

const MB = () => Buffer.alloc(1 << 20, 97);
const turn = () => new Promise(resolve => setImmediate(resolve));
const name = err => (err ? (err.syscall ? err.message : err.code) : "ok");
const boom = () => Object.assign(new Error("boom"), { code: "EBOOM" });

// Writes a chunk (1 MB) until the pipe does not take one whole. `callback` is that write's.
function park(stdin, callback, chunk = MB) {
  for (;;) {
    let insideWrite = true;
    let acknowledged = false;
    stdin.write(chunk(), err => {
      if (insideWrite) acknowledged = true;
      else callback(err);
    });
    insideWrite = false;
    if (!acknowledged) return;
  }
}

// sh gives a background job /dev/null as stdin, so the job takes the pipe from fd 3. The job outlives the child.
const withHolder = holder => `exec 3<&0; ${holder} <&3 3<&- >/dev/null 2>&1 & echo $!`;
// What the child runs under sh. Its first line of output is the pid of the holder, or 0 when there is none.
const scripts = {
  // The holder reads nothing. The child exits by itself.
  held: withHolder("sleep 30"),
  // The same, and the child waits for the kill.
  heldUntilKilled: withHolder("sleep 30") + "; wait",
  // No holder: the child is the one reader. It reads nothing and waits for the kill.
  alone: "echo 0; exec sleep 30",
};

// `held` with no shell, for Windows: the child is this runtime.
function spawnHeldWithNoShell() {
  // Bun.spawn where there is one: a debug build of bun needs a second to load node:child_process.
  const script = `
    const cmd = [process.execPath, "-e", "setTimeout(() => {}, 30000)"];
    const holder =
      typeof Bun === "object"
        ? Bun.spawn({ cmd, stdin: "inherit", stdout: "ignore", stderr: "ignore", detached: true })
        : require("node:child_process").spawn(cmd[0], cmd.slice(1), { stdio: ["inherit", "ignore", "ignore"], detached: true });
    holder.unref();
    require("node:fs").writeSync(1, holder.pid + "\\n");
    process.exit(0);
  `;
  // With this set, a bun child kills the holder when it exits.
  const env = { ...process.env, BUN_FEATURE_FLAG_NO_ORPHANS: undefined };
  return spawn(process.execPath, ["-e", script], { stdio: ["pipe", "pipe", "inherit"], env });
}

// Linux. Blocks until the child is a zombie or is gone: its exit is then there for the next turn of the event loop.
function waitForExitOf(pid) {
  for (;;) {
    let stat;
    try {
      stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    } catch {
      return;
    }
    if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return;
  }
}

// A child that has exited. The parent sees that exit first in the turn in which it sees the next one.
function exitedChild() {
  const other = spawn("true", { stdio: "ignore" });
  waitForExitOf(other.pid);
  return other;
}

// Each case parks a write before it returns. Then the child exits: by itself, or on a kill() from the listener of
// its first output (`kill: "listener"`) or from a timer (`kill: "timer"`).
const cases = {
  "write(chunk, callback)": {
    run: (stdin, say) => park(stdin, err => say(`callback ${name(err)}`)),
  },
  "no 'error' listener": {
    listener: false,
    run: (stdin, say) => park(stdin, err => say(`callback ${name(err)}`)),
  },
  "no 'error' listener, a child with no shell": {
    noShell: true,
    listener: false,
    run: (stdin, say) => park(stdin, err => say(`callback ${name(err)}`)),
  },
  "two writes": {
    run: (stdin, say) => {
      let first;
      park(stdin, err => say(`first ${name((first = err))}`));
      stdin.write("y", err => say(`second ${err === first ? "the same error" : name(err)}`));
    },
  },
  "end(chunk, callback)": {
    run: (stdin, say) => void stdin.end(MB(), err => say(`end callback ${name(err)}`)),
  },
  "end(chunk), no 'error' listener": {
    listener: false,
    run: stdin => void stdin.end(MB()),
  },
  "end(chunk, callback) behind a write": {
    run: (stdin, say) => {
      park(stdin, err => say(`callback ${name(err)}`));
      stdin.end("tail", err => say(`end callback ${name(err)}`));
    },
  },
  "end(callback) behind a write": {
    run: (stdin, say) => {
      park(stdin, err => say(`callback ${name(err)}`));
      stdin.end(err => say(`end callback ${name(err)}`));
    },
  },
  "end(callback) behind a write with no callback": {
    run: (stdin, say) => {
      stdin.write(MB());
      stdin.end(err => say(`end callback ${name(err)}`));
    },
  },
  "end(callback) behind two writes": {
    run: (stdin, say) => {
      park(stdin, err => say(`first ${name(err)}`));
      stdin.write("y", err => say(`second ${name(err)}`));
      stdin.end(err => say(`end callback ${name(err)}`));
    },
  },
  "end(callback) in 'exit'": {
    run: (stdin, say, child) => {
      park(stdin, err => say(`callback ${name(err)}`));
      child.on("exit", () => stdin.end(err => say(`end callback ${name(err)}`)));
    },
  },
  "end(callback) in 'exit' that throws": {
    run: (stdin, say, child) => {
      park(stdin, err => say(`callback ${name(err)}`));
      child.on("exit", () =>
        stdin.end(err => {
          say(`end callback ${name(err)}`);
          throw boom();
        }),
      );
    },
  },
  "finished(stdin)": {
    run: (stdin, say) => {
      finished(stdin, err => say(`finished ${name(err)}`));
      park(stdin, err => say(`callback ${name(err)}`));
    },
  },
  "kill()": {
    script: scripts.heldUntilKilled,
    kill: "listener",
    run: (stdin, say) => park(stdin, err => say(`callback ${name(err)}`)),
  },
  "pipeline(source, stdin)": {
    script: scripts.heldUntilKilled,
    kill: "listener",
    run: (stdin, say) => {
      const source = new Readable({ read() {} });
      const paused = new Promise(resolve => source.once("pause", resolve));
      pipeline(source, stdin, err => say(`pipeline ${name(err)}`));
      for (let i = 0; i < 4; i++) source.push(MB());
      return paused;
    },
  },
  // A canceled write emits no 'error' and no 'drain': what waits for one of them with events.once() waits for ever.
  "once(stdin, 'drain')": {
    run: (stdin, say, child, extra) => {
      park(stdin, err => say(`callback ${name(err)}`));
      extra.waiter = "is pending";
      once(stdin, "drain").then(
        () => (extra.waiter = "resolved"),
        err => (extra.waiter = `rejected with ${name(err)}`),
      );
    },
  },
  "once(stdin, 'finish')": {
    run: (stdin, say, child, extra) => {
      stdin.end(MB());
      extra.waiter = "is pending";
      once(stdin, "finish").then(
        () => (extra.waiter = "resolved"),
        err => (extra.waiter = `rejected with ${name(err)}`),
      );
    },
  },
  // Linux (/proc). Another child has exited before this one, and its 'exit' listener destroys this stdin. The parent
  // sees the two exits in one turn of the event loop: the destroy() comes between them.
  "destroy() in the turn of the exit": {
    before: () => ({ other: exitedChild() }),
    run: (stdin, say, child, { other }) => {
      park(stdin, err => say(`callback ${name(err)}`));
      other.on("exit", () => stdin.destroy());
      waitForExitOf(child.pid);
    },
  },
  // Linux (/proc). Only bun: it sends what a parked sink holds at each microtask checkpoint, node leaves that to the
  // poll of the pipe. In the 'exit' listener of another child the parent lets the holder read, and waits for that. The
  // checkpoint after the listener then sends the rest of the parked write. The exit of this child comes next, in the
  // same turn and before the task that calls the write back.
  "the pipe takes the rest of the write in the turn of the exit": {
    before: () => {
      const dir = mkdtempSync(join(tmpdir(), "stdin-held-exit-"));
      const go = join(dir, "go");
      const done = join(dir, "done");
      execFileSync("mkfifo", [go, done]);
      return { other: exitedChild(), dir, go, done };
    },
    // The holder waits for the parent, reads 128 KB, says so, and keeps the pipe.
    script: ({ go, done }) => withHolder(`{ read line <'${go}'; head -c 131072; echo >'${done}'; exec sleep 30; }`),
    run: (stdin, say, child, { other, dir, go, done }) => {
      // 64 KB chunks: less than the holder reads is left of the one that parks.
      park(
        stdin,
        err => say(`callback ${name(err)}`),
        () => Buffer.alloc(64 << 10, 97),
      );
      stdin.on("drain", () => say("drain"));
      other.on("exit", () => {
        writeFileSync(go, "\n");
        readFileSync(done);
        rmSync(dir, { recursive: true });
      });
      waitForExitOf(child.pid);
    },
  },
  // No holder: the kill breaks the pipe. Whichever the parent sees first, the exit or the failed write, the stream
  // reports a broken pipe.
  "a broken pipe, kill() from a listener": {
    script: scripts.alone,
    kill: "listener",
    run: (stdin, say) => park(stdin, err => say(`callback ${name(err)}`)),
  },
  "a broken pipe, kill() from a timer": {
    script: scripts.alone,
    kill: "timer",
    run: (stdin, say) => park(stdin, err => say(`callback ${name(err)}`)),
  },
};

const runs = process.argv.slice(2).flatMap(arg => {
  const [, title, times = "1"] = /^(.*?)(?: x(\d+))?$/.exec(arg);
  return Array.from({ length: Number(times) }, () => ({ title, seen: [] }));
});
const holders = [];
// An 'error' that no listener takes, and a callback that throws, go to the output and do not end the run.
const uncaught = [];
process.on("uncaughtException", err => uncaught.push(name(err)));
const unhandled = [];
process.on("unhandledRejection", err => unhandled.push(name(err)));

async function events({ title, seen }) {
  const { before, run, script = scripts.held, noShell = false, kill, listener = true } = cases[title];
  // What `before` made, and what the case keeps.
  const extra = before ? before() : {};
  const child = noShell
    ? spawnHeldWithNoShell()
    : spawn("sh", ["-c", typeof script === "function" ? script(extra) : script], {
        stdio: ["pipe", "pipe", "inherit"],
      });
  const { stdin, stdout } = child;
  const say = event => seen.push(event);
  if (listener) stdin.on("error", err => say(`error ${name(err)}`));
  const stdinClosed = new Promise(resolve => {
    stdin.on("close", () => {
      say("close");
      say(`errored ${name(stdin.errored)}`);
      resolve();
    });
  });
  child.on("exit", (code, signal) => say(`exit ${signal ?? code}`));
  const childClosed = new Promise(resolve => child.on("close", resolve));
  let output = "";
  const started = new Promise(resolve => {
    stdout.setEncoding("utf8").on("data", chunk => {
      const hadLine = output.includes("\n");
      output += chunk;
      if (hadLine || !output.includes("\n")) return;
      const pid = Number(/^\d+(?=\r?\n)/.exec(output)?.[0] ?? NaN);
      if (pid > 0 && script !== scripts.alone) holders.push({ title, pid });
      else if (pid !== 0 || script !== scripts.alone) say(`the child printed ${JSON.stringify(output)}`);
      resolve();
    });
  });
  // Still in the turn of the spawn: the write is parked before the parent can see the exit.
  await run(stdin, say, child, extra);
  await started;
  if (kill === "listener") child.kill();
  else if (kill === "timer") setTimeout(() => child.kill(), 1);
  await Promise.all([stdinClosed, childClosed]);
  if (extra.waiter !== undefined) {
    await turn();
    say(`the waiter ${extra.waiter}`);
  }
}

// Also runs when a stream never closes: the event loop is then empty with that case open.
let reported = false;
function report() {
  if (reported) return;
  reported = true;
  // A holder that is gone held nothing: its case did not test a held pipe.
  const gone = [];
  for (const { title, pid } of holders) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      gone.push(title);
    }
  }
  for (const { title, seen } of runs) console.log(`${title}: ${seen.join(", ")}`);
  console.log(`uncaught: ${uncaught.join(", ") || "none"}`);
  console.log(`unhandled rejections: ${unhandled.join(", ") || "none"}`);
  console.log(`holders gone early: ${gone.join(", ") || "none"}`);
}
process.on("beforeExit", report);
// One child at a time: what one case does in a turn of the event loop does not reach the sink of another.
(async () => {
  for (const run of runs) await events(run);
  report();
})();
