// Runs unchanged under node: <runtime> stdin-end-eof-fixture.js <group>...
// Each cell ends the stdin of its own child, and a finish callback then does what the cell's
// name says. The parent survives a throw. The output is what the parent saw per cell.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Prints the byte count of its stdin when the pipe reaches end-of-file.
const reader =
  process.platform === "win32"
    ? [process.execPath, "-e", "console.log(require('fs').readFileSync(0).length)"]
    : ["wc", "-c"];
// More than a socket buffer holds while the child is stopped.
const backlog = Buffer.alloc(1024 * 1024, "x");

const results = {};
let open = 0;
let markers;
process.on("uncaughtException", err => results[err.message].stdin.push("uncaughtException"));

function cell(name, command, arm) {
  // Its own process group, so that endAfterBacklog() can stop a shell together with its command.
  const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "pipe", "inherit"], detached: true });
  const stdin = child.stdin;
  const result = (results[name] = { stdin: [] });
  for (const event of ["prefinish", "finish", "close"]) stdin.on(event, () => result.stdin.push(event));
  stdin.on("error", err => result.stdin.push("error " + err.code));
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));

  // node does not count the 'close' of stdin toward the 'close' of the child.
  let pending = 2;
  const done = () => {
    if (--pending > 0 || --open > 0) return;
    if (markers) fs.rmSync(markers, { recursive: true, force: true });
    console.log(JSON.stringify(results));
  };
  open++;
  stdin.on("close", done);
  child.on("close", (code, signal) => {
    Object.assign(result, { stdout: stdout.trim(), code, signal });
    done();
  });

  const boom = () => {
    throw new Error(name);
  };
  arm({ child, stdin, result, boom });
}

// The child is stopped while the parent writes, so the write cannot drain: end() finds a backlog.
function endAfterBacklog({ child, stdin, result }, cb) {
  process.kill(-child.pid, "SIGSTOP");
  result.backedUp = !stdin.write(backlog);
  stdin.end(cb);
  process.kill(-child.pid, "SIGCONT");
}

// The child creates a marker file when its stdin reaches end-of-file. The end() callback then
// blocks this thread until the file exists, the way a callback that waits for the child does.
function waits(name, file, end) {
  const marker = path.join(markers, file);
  cell(name, ["sh", "-c", 'cat >/dev/null; : >"$0"', marker], c => {
    end(c, () => {
      const deadline = Date.now() + 10_000;
      while (!fs.existsSync(marker) && Date.now() < deadline);
      c.result.childReachedEndOfFile = fs.existsSync(marker);
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
    cell("'prefinish' listener, after a backlog", reader, c => {
      c.stdin.on("prefinish", c.boom);
      endAfterBacklog(c);
    });
  },
  // The child reads one byte and exits: the rest of the backlog fails with EPIPE.
  fails() {
    const readsOneByte = ["sh", "-c", "dd bs=1 count=1 >/dev/null 2>&1"];
    cell("end callback, after a backlog that fails", readsOneByte, c => endAfterBacklog(c, c.boom));
  },
  wait() {
    markers = fs.mkdtempSync(path.join(os.tmpdir(), "stdin-end-eof-"));
    waits("end callback waits for the child", "no-backlog", ({ stdin }, wait) => stdin.end("hello", wait));
    waits("end callback waits for the child, after a backlog", "backlog", endAfterBacklog);
  },
};
for (const group of process.argv.slice(2)) groups[group]();
