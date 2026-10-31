// A small write, then in the next callback of the same loop turn a large write and end(). The
// child reads its stdin only once the gate is opened: until then the large write is still owed,
// and nothing calls back. This file gives the same output in bun and in node.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const dir = process.argv.at(-1);
const gate = path.join(dir, "gate");
const count = path.join(dir, "count");
execFileSync("mkfifo", [gate]);
// The child opens the gate before it reads its stdin. Then it counts the bytes.
const child = spawn("sh", ["-c", ': <"$0"; wc -c >"$1"', gate, count], { stdio: ["pipe", "ignore", "inherit"] });

const events = [];
child.stdin.on("drain", () => events.push("drain"));
child.stdin.on("finish", () => events.push("finish"));
child.stdin.on("error", error => events.push("error " + error.code));
setImmediate(() => child.stdin.write("small"));
setImmediate(() => {
  child.stdin.write(Buffer.alloc(1024 * 1024, 120), () => events.push("write callback"));
  child.stdin.end(() => events.push("end callback"));
  let turns = 4;
  (function next() {
    if (turns-- > 0) return setImmediate(next);
    const before = events.slice();
    // Opening the gate for writing lets the child go on to read.
    fs.writeFileSync(gate, "");
    child.on("close", () => {
      console.log(JSON.stringify({ before, bytes: Number(fs.readFileSync(count, "utf8")) }));
    });
  })();
});
