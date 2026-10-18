// Runs unchanged under node: <runtime> stdin-end-eof-fixture.js <directory> <group>...
// Each cell ends the stdin of its own child, and a finish callback then does what the cell's
// name says. The parent survives a throw. The output is what the parent saw per cell.
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// An empty directory of the caller: the gates and the marker files of the children go here.
const [directory, ...selected] = process.argv.slice(2);

// Prints the byte count of its stdin when the pipe reaches end-of-file.
const reader =
  process.platform === "win32"
    ? [process.execPath, "-e", "console.log(require('fs').readFileSync(0).length)"]
    : ["wc", "-c"];
const chunk = Buffer.alloc(1024 * 1024, "x");

const results = {};
let open = 0;
process.on("uncaughtException", err => results[err.message].stdin.push("uncaughtException"));

function cell(name, command, arm) {
  const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
  const stdin = child.stdin;
  const result = (results[name] = { stdin: [] });
  for (const event of ["prefinish", "finish", "close"]) stdin.on(event, () => result.stdin.push(event));
  stdin.on("error", err => result.stdin.push("error " + err.code));
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", data => (stdout += data));

  // node does not count the 'close' of stdin toward the 'close' of the child.
  let pending = 2;
  const done = () => {
    if (--pending > 0 || --open > 0) return;
    console.log(JSON.stringify(results));
  };
  open++;
  stdin.on("close", done);
  const context = {
    child,
    stdin,
    result,
    boom() {
      throw new Error(name);
    },
  };
  child.on("close", (code, signal) => {
    // The size of a backlog depends on the pipe: a child that counted all of it says so.
    const counted = stdout.trim();
    Object.assign(result, { stdout: counted === String(context.backlog) ? "the backlog" : counted, code, signal });
    done();
  });
  arm(context);
}

// The child opens its gate before it runs its command, and that open waits until the parent
// opens the gate too. Until then nothing reads the stdin of the child, not even a read() that
// has already started.
function gated(name, command, arm) {
  const gate = path.join(directory, "gate-" + open);
  execFileSync("mkfifo", [gate]);
  cell(name, ["sh", "-c", ': <"$0"; exec "$@"', gate, ...command], context => arm(Object.assign(context, { gate })));
}

// Nothing reads yet, so the writes fill the pipe and end() finds a backlog. The gate opens two
// loop turns later: whatever calls back before that does so with the backlog unread.
function endAfterBacklog(context, cb) {
  const { stdin, result } = context;
  context.backlog = 0;
  do {
    result.backedUp = !stdin.write(chunk);
    context.backlog += chunk.length;
  } while (!result.backedUp && context.backlog < 64 * chunk.length);
  stdin.end(cb);
  setImmediate(() => setImmediate(() => fs.writeFileSync(context.gate, "")));
}

// Blocks this thread until the child has created the file, the way a callback that waits for
// the child does.
function childCreated(marker) {
  const deadline = Date.now() + 10_000;
  while (!fs.existsSync(marker) && Date.now() < deadline);
  return fs.existsSync(marker);
}

// The child creates a marker file when its stdin reaches end-of-file, and the end() callback
// waits for that file.
function waits(spawns, name, end) {
  const marker = path.join(directory, "marker-" + open);
  spawns(name, ["sh", "-c", 'cat >/dev/null; : >"$0"', marker], context => {
    end(context, () => {
      context.result.childReachedEndOfFile = childCreated(marker);
    });
  });
}

const groups = {
  // The stream is constructed by the time setImmediate runs.
  throws() {
    cell("end callback", reader, ({ stdin, boom }) => setImmediate(() => stdin.end("hello", boom)));
    cell("'finish' listener", reader, ({ stdin, boom }) => setImmediate(() => stdin.on("finish", boom).end("hello")));
    cell("'prefinish' listener", reader, ({ stdin, boom }) => setImmediate(() => stdin.on("prefinish", boom).end()));
    cell("end callback, in the spawn tick", reader, ({ stdin, boom }) => stdin.end("hello", boom));
  },
  backlog() {
    gated("'prefinish' listener, after a backlog", reader, context => {
      context.stdin.on("prefinish", context.boom);
      endAfterBacklog(context);
    });
  },
  // The child reads one byte and exits: the rest of the backlog fails with EPIPE.
  fails() {
    const readsOneByte = ["sh", "-c", "dd bs=1 count=1 >/dev/null 2>&1"];
    gated("end callback, after a backlog that fails", readsOneByte, context => endAfterBacklog(context, context.boom));
  },
  wait() {
    waits(cell, "end callback waits for the child", ({ stdin }, wait) => stdin.end("hello", wait));
    waits(gated, "end callback waits for the child, after a backlog", endAfterBacklog);
    // The sink has flushed the first write by the time the second callback of the loop turn runs.
    waits(gated, "end callback waits for the child, after a write and a backlog", (context, wait) => {
      setImmediate(() => context.stdin.write("a"));
      setImmediate(() => endAfterBacklog(context, wait));
    });
    // The child creates its marker file when it has read the line. It reads on to end-of-file.
    const marker = path.join(directory, "marker-line");
    const readsLine = ["sh", "-c", 'read line; : >"$0"; cat >/dev/null', marker];
    cell("the block of write(line) and end() waits for the child", readsLine, context =>
      setImmediate(() => {
        context.stdin.write("line\n");
        context.stdin.end();
        context.result.childReadTheLine = childCreated(marker);
      }),
    );
  },
  // destroy() in the turn of end(): _final has not called back, so no 'prefinish' and no 'finish' follow.
  destroys() {
    const ends = ({ stdin, result }, ...data) =>
      stdin.end(...data, err => result.stdin.push("end callback " + (err ? err.code : "ok")));
    const destroys = (name, arm) => cell(name, reader, context => setImmediate(() => arm(context)));
    destroys("end(cb), destroy()", context => {
      ends(context);
      context.stdin.destroy();
    });
    destroys("write(), end(cb), destroy()", context => {
      context.stdin.write("abc");
      ends(context);
      context.stdin.destroy();
    });
    destroys("end(chunk, cb), destroy()", context => {
      ends(context, "hello");
      context.stdin.destroy();
    });
    destroys("end(chunk, cb), destroy() on the next tick", context => {
      ends(context, "hello");
      process.nextTick(() => context.stdin.destroy());
    });
    destroys("end(chunk, cb), destroy() in a promise job", context => {
      ends(context, "hello");
      queueMicrotask(() => context.stdin.destroy());
    });
  },
};
for (const group of selected) groups[group]();
