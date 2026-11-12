// Prints what child.stdin does around end() and destroy(), one entry for each case.
// `node stdin-end-order-fixture.js <an empty directory>` prints the report of Node.js.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

// Where the cases keep the files that a child and this process signal each other with.
const dir = process.argv[2];

const echo = process.platform === "win32" ? [process.execPath, "-e", "process.stdin.pipe(process.stdout)"] : ["cat"];
const spawnEcho = () => spawn(echo[0], echo.slice(1), { stdio: ["pipe", "pipe", "inherit"] });
// Two turns of the loop past the child's 'close', so that an event that trails it is in the report.
const settled = child => new Promise(resolve => child.on("close", () => setImmediate(() => setImmediate(resolve))));

function logOf(child) {
  const log = [];
  for (const event of ["prefinish", "finish", "close"]) child.stdin.on(event, () => log.push(event));
  child.stdin.on("error", err => log.push(`error ${err.code}`));
  return log;
}
const callback = (log, name) => err => log.push(`${name} callback ${err ? err.code : null}`);

const uncaught = [];
process.on("uncaughtException", err => uncaught.push(err.message));

// Blocks this process until `done()` holds: nothing of the event loop runs meanwhile.
function block(done, otherwise) {
  const deadline = Date.now() + 3000;
  while (!done()) if (Date.now() > deadline) throw new Error(otherwise);
}

const cases = {
  async 'end("abc", cb)'() {
    const child = spawnEcho();
    const log = logOf(child);
    let read = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
    setImmediate(() => log.push("immediate"));
    child.stdin.end("abc", callback(log, "end"));
    await settled(child);
    return { log, read };
  },

  async 'end("abc", cb); destroy()'() {
    const child = spawnEcho();
    const log = logOf(child);
    child.stdout.resume();
    setImmediate(() => log.push("immediate"));
    child.stdin.end("abc", callback(log, "end"));
    child.stdin.destroy();
    await settled(child);
    return log;
  },

  async "destroy(err)"() {
    const child = spawnEcho();
    const log = logOf(child);
    child.stdout.resume();
    setImmediate(() => log.push("immediate"));
    child.stdin.destroy(Object.assign(new Error("boom"), { code: "BOOM" }));
    await settled(child);
    return log;
  },

  // libuv keeps the handles that close on a stack: the stream that was destroyed last closes first.
  async "destroy() of two children in one turn"() {
    const children = [spawnEcho(), spawnEcho()];
    const log = [];
    children.forEach((child, index) => {
      child.stdout.resume();
      child.stdin.on("close", () => log.push(`stdin ${index}`));
    });
    setImmediate(() => log.push("immediate"));
    for (const child of children) child.stdin.destroy();
    await Promise.all(children.map(settled));
    return log;
  },
};

// On POSIX the reader gets end-of-file from end(), through shutdown(2), and the stream keeps its descriptor until
// destroy().
if (process.platform !== "win32") {
  cases["an ended stdin as the stdout of another child"] = async () => {
    const first = spawnEcho();
    first.stdout.resume();
    const firstClosed = once(first, "close");
    const second = new Promise(resolve => {
      first.stdin.on("finish", () => {
        spawn("true", { stdio: ["ignore", first.stdin, "inherit"] }).on("close", resolve);
      });
    });
    first.stdin.end("abc");
    return { second: await second, first: (await firstClosed)[0] };
  };

  // A listener of 'finish' that throws keeps the stream from its destroy().
  cases["a 'finish' listener that throws"] = async () => {
    const child = spawnEcho();
    let read = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
    child.stdin.on("finish", () => {
      throw new Error("from 'finish'");
    });
    child.stdin.end("abc");
    const [code] = await once(child, "close");
    return { read, code, uncaught };
  };
}

// The pipe holds a part of the large chunk, and the child reads nothing until a line comes on its descriptor 3.
// 'finish' waits for the rest, and the child gets every byte. The small chunk, one callback earlier, leaves a flush
// behind that settles ahead of the large one.
if (process.platform !== "win32") {
  cases["a large chunk behind a small one, to a reader that starts late"] = async () => {
    const child = spawn("sh", ["-c", "read -r go <&3; wc -c"], { stdio: ["pipe", "pipe", "inherit", "pipe"] });
    const log = logOf(child);
    let read = "";
    child.stdout.setEncoding("utf8").on("data", chunk => (read += chunk));
    const ended = new Promise(resolve => {
      setImmediate(() => child.stdin.write("small"));
      setImmediate(() => {
        child.stdin.write(Buffer.alloc(1024 * 1024, "x"));
        child.stdin.end();
        resolve();
      });
    });
    await ended;
    for (let turns = 0; turns < 4; turns++) await new Promise(resolve => setImmediate(resolve));
    const before = log.slice();
    child.stdio[3].end("go\n");
    await settled(child);
    return { before, log, bytes: Number(read) };
  };
}

// The child closes its stdin while this process is busy, with a chunk that the pipe did not take. The flush behind
// the busy callback fails, and end() comes before the loop runs a task: the error of the chunk is reported, and no
// 'finish'.
if (process.platform !== "win32") {
  cases["end() behind a chunk whose flush failed while the script was busy"] = async () => {
    const go = path.join(dir, "go");
    const closed = path.join(dir, "closed");
    const script = 'while [ ! -e "$0" ]; do :; done; exec 0<&-; : > "$1"; while [ -e "$0" ]; do :; done';
    const child = spawn("sh", ["-c", script, go, closed], { stdio: ["pipe", "ignore", "inherit"] });
    const log = logOf(child);
    child.stdin.write(Buffer.alloc(1024 * 1024, "x"));
    await new Promise(resolve => {
      setImmediate(() => {
        fs.writeFileSync(go, "");
        block(() => fs.existsSync(closed), "the child did not close its stdin");
      });
      setImmediate(() => {
        child.stdin.end();
        resolve();
      });
    });
    for (let turns = 0; turns < 4; turns++) await new Promise(resolve => setImmediate(resolve));
    fs.rmSync(go);
    await settled(child);
    return log;
  };
}

// The child exits and leaves the pipe to a grandchild that reads nothing. The stdin of the child still closes,
// with the bytes that the pipe did not take.
if (process.platform !== "win32") {
  cases["a chunk that the pipe did not take, when the child exits and a grandchild keeps the pipe"] = async () => {
    const child = spawn("sh", ["-c", "exec 3<&0; sleep 1 <&3 3<&- >/dev/null 2>&1 & exit 0"], {
      stdio: ["pipe", "ignore", "inherit"],
    });
    const heard = [];
    child.stdin.on("error", () => {});
    child.stdin.on("close", () => heard.push("close"));
    child.stdin.write(Buffer.alloc(1024 * 1024, "x"));
    await settled(child);
    return heard;
  };
}

// end() from an immediate, while the exit of the child waits in the next poll: 'finish' comes first.
if (process.platform === "linux") {
  cases["end(cb) from an immediate, with the exit of the child due in the next poll"] = async () => {
    const child = spawn("cat", { stdio: ["pipe", "ignore", "inherit"] });
    const log = logOf(child);
    child.on("exit", () => log.push("exit"));
    await once(child, "spawn");
    await new Promise(resolve => setImmediate(resolve));
    process.kill(child.pid, "SIGKILL");
    // The child is a zombie until this process reaps it, and this loop has not polled since the kill. Where a
    // thread of Bun reaps it (no pidfd), its entry in /proc goes away: the exit is then a task of the next turn.
    block(() => {
      try {
        return /^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${child.pid}/stat`, "utf8"));
      } catch {
        return true;
      }
    }, "the killed child did not exit");
    setImmediate(() => log.push("immediate"));
    child.stdin.end(callback(log, "end"));
    await settled(child);
    return log;
  };
}

// Each case starts from a timer of its own: the cases log where the immediates of their turn come. A case that
// throws or does not finish says so in its place, and the report still prints.
const unfinished = "did not finish";
const report = {};
const pending = [];
for (const name in cases) {
  report[name] = undefined;
  pending.push(
    new Promise(resolve => {
      const deadline = setTimeout(() => resolve(unfinished), 15_000);
      const done = result => (clearTimeout(deadline), resolve(result));
      setTimeout(() => cases[name]().then(done, error => done(`threw: ${error.message}`)), 1);
    }).then(result => (report[name] = result)),
  );
}
Promise.all(pending).then(() => {
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report).includes(unfinished)) process.exit(1);
});
