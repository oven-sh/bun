// Prints what child.stdin does around end() and destroy(), one entry for each case.
// `node stdin-end-order-fixture.js` prints the report of Node.js.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");

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

  // Between end() and destroy() the stream still has its descriptor.
  async "an ended stdin as the stdout of another child"() {
    const first = spawnEcho();
    first.stdout.resume();
    const firstClosed = once(first, "close");
    const second = new Promise(resolve => {
      first.stdin.on("finish", () => {
        const args = process.platform === "win32" ? [process.execPath, "-e", ""] : ["true"];
        spawn(args[0], args.slice(1), { stdio: ["ignore", first.stdin, "inherit"] }).on("close", resolve);
      });
    });
    first.stdin.end("abc");
    return { second: await second, first: (await firstClosed)[0] };
  },
};

// On POSIX the reader gets end-of-file from end(), through shutdown(2). A listener of 'finish' that throws keeps the
// stream from its destroy().
if (process.platform !== "win32") {
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
    // The child is a zombie until this process reaps it, and this loop has not polled since the kill.
    const deadline = Date.now() + 3000;
    while (!/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${child.pid}/stat`, "utf8"))) {
      if (Date.now() > deadline) throw new Error("the killed child did not become a zombie");
    }
    setImmediate(() => log.push("immediate"));
    child.stdin.end(callback(log, "end"));
    await settled(child);
    return log;
  };
}

// Each case starts from a timer of its own: the cases log where the immediates of their turn come.
const report = {};
const pending = [];
for (const name in cases) {
  report[name] = undefined;
  pending.push(
    new Promise(resolve => setTimeout(() => resolve(cases[name]()), 1)).then(result => (report[name] = result)),
  );
}
Promise.all(pending).then(() => console.log(JSON.stringify(report, null, 2)));
