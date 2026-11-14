// Rows of calls on the stdin of a child, each with its own child. Prints { [row]: [what followed, in order] }:
// the callbacks, the events of child.stdin and the events of the child. Runs under Bun and under Node.js:
//   node stdin-exited-child-fixture.js <table> <scratch directory>
//
// A row is "<when>, <calls>[, <child>]". Its spawn() runs in a timer, as the main script of a program does: with no
// poll of the event loop behind it in that turn.
//   when "immediate", "promise", "fs" or "fs one hop": the child has exited, and the calls run one callback after
//     spawn(): the first setImmediate, what follows an awaited setImmediate, the callback of fs.readFile, or that of
//     fs.stat.
//   when "spawn turn": the same, but the calls run in the turn of spawn().
//   when "later": the child exits after the loop has polled, and the calls run in the callback that saw it exit.
//   when "closed": the child is alive and has closed its stdin. The calls run in the first setImmediate.
//   when "alive immediate" or "alive fs": the child takes 64 KiB from the callback, exits, and then the calls run.
//   when "parked fs": the same from the callback of fs.readFile, with 1 MiB: the child takes a part, and the rest waits.
//   when "fed immediate": the child takes 64 KiB in the turn of spawn() and exits. The calls run in the first
//     setImmediate.
//   child "output": it has written to its stdout and stderr. child "ipc": it has sent a message.
//   child "signal" and "execFile": it was made with an AbortSignal, by spawn() or by execFile().
const { execFile, fork, spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { finished } = require("node:stream");
const { setImmediate: immediate } = require("node:timers/promises");

const pause = new Int32Array(new SharedArrayBuffer(4));
// Blocks this thread between two looks, so the event loop reports nothing meanwhile.
function lookAgain(deadline, what) {
  if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`);
  Atomics.wait(pause, 0, 0, 1);
}

// A child that has exited is a zombie until its parent waits for it. The event loop of this process waits for the
// child, and it does not run while this function does. (Without a pidfd a thread of Bun waits for it: then the child
// is gone at once, and its exit is a task that the event loop has yet to run.)
function waitUntilExited(pid) {
  for (const deadline = Date.now() + 20_000; ; lookAgain(deadline, `pid ${pid} to exit`)) {
    if (process.platform === "linux" || process.platform === "android") {
      let stat;
      try {
        stat = fs.readFileSync(`/proc/${pid}/stat`, "latin1");
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
        return;
      }
      // The state of the process, and how many of its threads are left.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z" && fields[17] === "1") return;
    } else {
      const state = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim()[0];
      if (state === undefined || state === "Z") return;
    }
  }
}

function kill(child) {
  process.kill(child.pid, "SIGKILL");
  waitUntilExited(child.pid);
}

const large = Buffer.alloc(200_000, "a");
// More than the sink of a child's stdin holds back to send later, and no more than the socket of a live child takes.
const taken = Buffer.alloc(65_536, "a");
// More than that socket takes.
const parked = Buffer.alloc(1 << 20, "a");

// The calls of a row. `callback(name)` logs "<name> callback <error code, or ok>".
const calls = {
  "end": ({ stdin, callback }) => stdin.end("hello", callback("end")),
  "end large": ({ stdin, callback }) => stdin.end(large, callback("end")),
  "write large": ({ stdin, callback }) => stdin.write(large, callback("write")),
  "write large twice": ({ stdin, callback }) => {
    stdin.write(large, callback("write"));
    stdin.write(large, callback("write"));
  },
  "write large, end": ({ stdin, callback }) => {
    stdin.write(large, callback("write"));
    stdin.end(callback("end"));
  },
  "write, end": ({ stdin }) => {
    stdin.write("hello");
    stdin.end();
  },
  "write, end with callback": ({ stdin, callback }) => {
    stdin.write("hello", callback("write"));
    stdin.end(callback("end"));
  },
  "write, destroy": ({ stdin }) => {
    stdin.write("hello");
    stdin.destroy();
  },
  // One byte less than the sink holds back, and the first size that it sends in the call.
  "write 4095, end, finished": ({ stdin, log }) => {
    stdin.write(Buffer.alloc(4095, "a"));
    stdin.end();
    finished(stdin, error => log(`finished ${error ? error.code : "ok"}`));
  },
  "write 4096, end, finished": ({ stdin, log }) => {
    stdin.write(Buffer.alloc(4096, "a"));
    stdin.end();
    finished(stdin, error => log(`finished ${error ? error.code : "ok"}`));
  },
  "end large, finished": ({ stdin, log, callback }) => {
    stdin.end(large, callback("end"));
    finished(stdin, error => log(`finished ${error ? error.code : "ok"}`));
  },
  "pipe": ({ stdin, scratch }) => {
    const file = path.join(scratch, "input");
    fs.writeFileSync(file, large);
    // An open descriptor, so that the first chunk is one thread pool callback away.
    fs.createReadStream(null, { fd: fs.openSync(file, "r") }).pipe(stdin);
  },
  // A listener for 'close' of the child that is added after the stream has ended.
  "end, then listen for 'close' of the child": ({ stdin, child, log }) => {
    stdin.end("hello");
    finished(stdin, () => child.on("close", () => log("late close")));
  },
  "kill()": ({ child, log }) => {
    const sent = child.kill();
    log(`kill() ${sent}, killed ${child.killed}`);
  },
  "abort": ({ controller }) => controller.abort(),
};

let made = 0;
// The table "no listener" sets this to false: an 'error' of child.stdin then ends this process.
let listen = true;

// One child, and the calls of one row on it. Resolves with what followed.
function row(name, scratch) {
  const [when, route, kind = "sleep"] = splitRow(name);
  const events = [];
  const log = event => events.push(event);
  const callback = label => error => log(`${label} callback ${error ? error.code : "ok"}`);
  // What tells this process, with no poll of its event loop, that the child has done its part.
  const ready = path.join(scratch, `ready-${made++}`);
  const waitUntilReady = () => {
    for (const deadline = Date.now() + 20_000; !fs.existsSync(ready);)
      lookAgain(deadline, `the child to make ${ready}`);
  };

  return new Promise(resolve => {
    const controller = new AbortController();
    let child;
    if (when === "closed") {
      child = spawn("sh", ["-c", 'exec 0<&-; : > "$1"; exec sleep 30', "sh", ready], {
        stdio: ["pipe", "ignore", "ignore"],
      });
    } else if (kind === "output") {
      child = spawn("sh", ["-c", 'echo out; echo err >&2; : > "$1"; exec sleep 30', "sh", ready]);
      child.stdout.once("data", () => log("stdout data"));
      child.stderr.once("data", () => log("stderr data"));
    } else if (kind === "ipc") {
      child = fork(__filename, ["ipc-worker", ready], { silent: true });
      child.on("message", () => log("message"));
    } else if (kind === "execFile") {
      child = execFile("sleep", ["30"], { signal: controller.signal }, error =>
        log(`execFile callback ${error ? error.name : "ok"}`),
      );
    } else {
      child = spawn("sleep", ["30"], {
        stdio: ["pipe", "ignore", "ignore"],
        signal: kind === "signal" ? controller.signal : undefined,
      });
    }
    const stdin = child.stdin;

    let open = 2;
    const closed = () => {
      if (--open > 0) return;
      // Two turns of the loop, so that a callback that trails 'close' is in the log.
      setImmediate(() => setImmediate(() => resolve(events)));
    };
    child.on("exit", (code, signal) => log(`exit ${signal ?? code}`));
    child.on("error", error => log(`child error ${error.name}`));
    child.on("close", closed);
    stdin.on("finish", () => log("stdin finish"));
    stdin.on("drain", () => log("stdin drain"));
    if (listen) stdin.on("error", error => log(`stdin error ${error.code}`));
    stdin.on("close", () => {
      log(`stdin close, errored ${stdin.errored?.code ?? null}`);
      if (when === "closed") child.kill("SIGKILL");
      closed();
    });

    const run = () => calls[route]({ stdin, child, controller, log, callback, scratch });
    const exit = () => {
      if (kind === "output" || kind === "ipc") waitUntilReady();
      kill(child);
    };
    switch (when) {
      case "immediate":
        if (route === "pipe") {
          // pipe() starts the first read in a tick. The child is waited for behind it.
          process.kill(child.pid, "SIGKILL");
          run();
          process.nextTick(waitUntilExited, child.pid);
        } else {
          exit();
          setImmediate(run);
        }
        break;
      case "promise":
        exit();
        immediate().then(run);
        break;
      case "fs":
        fs.readFile(__filename, run);
        exit();
        break;
      case "fs one hop":
        fs.stat(__filename, run);
        exit();
        break;
      case "spawn turn":
        exit();
        run();
        break;
      case "later":
        setTimeout(() => {
          exit();
          run();
        }, 1);
        break;
      case "closed":
        waitUntilReady();
        setImmediate(run);
        break;
      case "fed immediate":
        stdin.write(taken);
        exit();
        setImmediate(run);
        break;
      case "alive immediate":
      case "alive fs":
      case "parked fs": {
        const takenThenExit = () => {
          stdin.write(when === "parked fs" ? parked : taken);
          exit();
          run();
        };
        if (when === "alive immediate") setImmediate(takenThenExit);
        else fs.readFile(__filename, takenThenExit);
        break;
      }
      default:
        throw new Error(`unknown start: ${when}`);
    }
  });
}

// "<when>, <calls>[, <child>]": the calls can hold ", " themselves.
function splitRow(name) {
  const parts = name.split(", ");
  const when = parts.shift();
  const kind = ["output", "ipc", "signal", "execFile"].includes(parts.at(-1)) ? parts.pop() : undefined;
  return [when, parts.join(", "), kind];
}

// One child for each cell: spawn() in `origin`, and end() when `schedule` says. The child has exited by then.
function origin(name) {
  const [from, schedule] = name.split(", ");
  return new Promise(resolve => {
    let write;
    const start = () => {
      const child = spawn("sleep", ["30"], { stdio: ["pipe", "ignore", "ignore"] });
      let result = "no 'error'";
      child.stdin.on("error", error => (result = error.code));
      child.on("close", () => resolve(result));
      write = () => child.stdin.end("hello");
      kill(child);
      if (schedule === "the same turn") write();
      else if (schedule === "the next immediate") setImmediate(write);
    };
    if (schedule === "the next fs callback") {
      // Two requests to the thread pool: the callback that comes first spawns, and the other one writes.
      const next = () => (write ? write() : start());
      fs.stat(__filename, next);
      fs.stat(__filename, next);
    } else if (from === "spawn() in a timer") setTimeout(start, 1);
    else if (from === "spawn() in an fs callback") fs.stat(__filename, start);
    else setImmediate(start);
    if (schedule === "an immediate of the same batch") setImmediate(() => write());
  });
}

const tables = {
  // The child exited before the callback that writes.
  "exited": [
    ...["immediate", "promise", "fs"].flatMap(when =>
      [
        "end",
        "end large",
        "write large",
        "write large twice",
        "write large, end",
        "write, end",
        "write, end with callback",
        "write, destroy",
      ].map(route => `${when}, ${route}`),
    ),
    "immediate, pipe",
    "fed immediate, end",
    "fed immediate, write large",
  ],
  "no listener": ["immediate, end", "promise, write large", "fs, end large"],
  // Rows of both kinds, for a second way to start the program.
  "both kinds": [
    "immediate, end",
    "immediate, write large",
    "promise, end",
    "fs, end",
    "spawn turn, end",
    "closed, end",
  ],
  // What the child sent before it exited still arrives, ahead of 'exit'.
  "order": [
    "immediate, end large, output",
    "immediate, end large, ipc",
    "fs, end large, ipc",
    "immediate, end, then listen for 'close' of the child, output",
  ],
  // No loop could have reported the exit to the callback that writes, or there is no exit.
  "not reported": [
    ...["spawn turn", "later", "closed"].flatMap(when =>
      ["end", "end large", "write large", "write large twice", "write, end", "write, end with callback"].map(
        route => `${when}, ${route}`,
      ),
    ),
    ...["alive immediate", "alive fs", "parked fs"].flatMap(when =>
      ["end", "write large", "write, end"].map(route => `${when}, ${route}`),
    ),
  ],
  "closed": ["end", "end large", "write large", "write large twice", "write, end", "write, end with callback"].map(
    route => `closed, ${route}`,
  ),
  "finished": [
    "immediate, write 4095, end, finished",
    "immediate, write 4096, end, finished",
    "immediate, end large, finished",
    "fs one hop, end",
    "fs one hop, write large",
  ],
  "kill": [
    "immediate, kill()",
    "promise, kill()",
    "fs, kill()",
    "spawn turn, kill()",
    "later, kill()",
    "immediate, abort, signal",
    "spawn turn, abort, signal",
    "immediate, abort, execFile",
    "spawn turn, abort, execFile",
  ],
  "origins": [
    "spawn() in a timer, the same turn",
    "spawn() in a timer, the next immediate",
    "spawn() in an fs callback, the same turn",
    "spawn() in an fs callback, the next immediate",
    "spawn() in an fs callback, the next fs callback",
    "spawn() in an immediate, the same turn",
    "spawn() in an immediate, the next immediate",
    "spawn() in an immediate, an immediate of the same batch",
  ],
};

// Resolves with { [row]: what followed }. One row at a time, each from a timer.
async function table(name, scratch) {
  listen = name !== "no listener";
  const rows = {};
  for (const each of tables[name]) {
    rows[each] = await new Promise(resolve =>
      setTimeout(() => resolve(name === "origins" ? origin(each) : row(each, scratch)), 0),
    );
  }
  return rows;
}

module.exports = { table, tables };

if (process.argv[2] === "ipc-worker") {
  process.send("result", () => setImmediate(() => fs.writeFileSync(process.argv[3], "")));
  setInterval(() => {}, 1 << 30);
} else if (require.main === module) {
  table(process.argv[2], process.argv[3]).then(rows => console.log(JSON.stringify(rows)));
}
