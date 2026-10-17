// Logs what child.stdin does for calls made in the tick that creates the stream.
// `node stdin-call-orders-fixture.js` prints the same table for Node.js.
const { spawn } = require("node:child_process");

const destroy = stdin => () => stdin.destroy();
// `cb(name)` is a callback that logs "<name> cb <error code, or null>".
const rows = [
  [`end("hello"); destroy()`, s => (s.end("hello"), s.destroy())],
  [`end("hello"); destroy(new Error("boom"))`, s => (s.end("hello"), s.destroy(new Error("boom")))],
  [`end("hello"); end("x")`, s => (s.end("hello"), s.end("x"))],
  [`end("hello"); write("x")`, s => (s.end("hello"), s.write("x"))],
  [`cork(); write("he"); end("llo"); destroy()`, s => (s.cork(), s.write("he"), s.end("llo"), s.destroy())],
  [`end("68656c6c6f", "hex"); destroy()`, s => (s.end("68656c6c6f", "hex"), s.destroy())],
  [
    `end(buffer); buffer.fill(0)`,
    s => {
      const buffer = Buffer.from("hello");
      s.end(buffer);
      buffer.fill(0);
    },
  ],
  [`end("hello", cb); destroy()`, (s, cb) => (s.end("hello", cb("end")), s.destroy())],
  [
    `end("hello", cb); destroy(new Error("boom"))`,
    (s, cb) => (s.end("hello", cb("end")), s.destroy(new Error("boom"))),
  ],
  [`end(cb); destroy()`, (s, cb) => (s.end(cb("end")), s.destroy())],
  [`end("hello", cb); nextTick(destroy)`, (s, cb) => (s.end("hello", cb("end")), process.nextTick(destroy(s)))],
  [`end("hello", cb); queueMicrotask(destroy)`, (s, cb) => (s.end("hello", cb("end")), queueMicrotask(destroy(s)))],
  [`write("hello", cb); end(); destroy()`, (s, cb) => (s.write("hello", cb("write")), s.end(), s.destroy())],
  [`cork(); write("hello", cb); destroy()`, (s, cb) => (s.cork(), s.write("hello", cb("write")), s.destroy())],
  [`end("hello", cb)`, (s, cb) => s.end("hello", cb("end"))],
  [`write("he", cb); end("llo", cb)`, (s, cb) => (s.write("he", cb("write")), s.end("llo", cb("end")))],
  [
    `write("he", cb); end("llo", cb); destroy()`,
    (s, cb) => (s.write("he", cb("write")), s.end("llo", cb("end")), s.destroy()),
  ],
  [`destroy(); end("hello", cb)`, (s, cb) => (s.destroy(), s.end("hello", cb("end")))],
];

// The child is `cat` with its stdout piped back. Resolves with what the child
// read, and the stream's events and callbacks in order.
function run([name, calls]) {
  return new Promise(resolve => {
    const child = spawn("cat", [], { stdio: ["pipe", "pipe", "inherit"] });
    const stdin = child.stdin;
    const log = [];
    for (const event of ["open", "ready", "prefinish", "finish", "close"]) stdin.on(event, () => log.push(event));
    stdin.on("error", err => log.push(`error ${err.code || err.message}`));
    const cb = label => err => log.push(`${label} cb ${err ? err.code || err.message : null}`);
    let bytes = "";
    child.stdout.setEncoding("latin1").on("data", chunk => (bytes += chunk));
    let open = 2;
    const closed = () => {
      if (--open > 0) return;
      // Two turns of the loop, so that a callback that trails 'close' is in the log.
      setImmediate(() => setImmediate(() => resolve([name, { bytes, log }])));
    };
    stdin.on("close", closed);
    child.on("close", closed);
    calls(stdin, cb);
  });
}

// Resolves with { [row]: { bytes, log } }. Call it from a macrotask, as the main
// script of a program is: in a promise job, process.nextTick callbacks run after
// the queued microtasks.
async function stdinCallOrders() {
  return Object.fromEntries(await Promise.all(rows.map(run)));
}

module.exports = { stdinCallOrders };

if (require.main === module) stdinCallOrders().then(table => console.log(JSON.stringify(table, null, 2)));
