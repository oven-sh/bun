// Runs one scenario on process.stdout or process.stderr. With "full" the fd table is full when the stream is first read,
// so its sink cannot duplicate the fd. The report goes to the other stdio fd with fs.writeSync.
import fs from "node:fs";
import { finished } from "node:stream";
import tty from "node:tty";

const [which, scenario, table] = process.argv.slice(2);
const fd = which === "stdout" ? 1 : 2;
const code = e => (e == null ? null : e.code);

// A debug build reads internal modules from disk on first use. Load the stream modules while an fd is free.
void fs.WriteStream;
void tty.WriteStream.prototype;
const held = [];
let writer = "not tried";
if (table === "full") {
  try {
    for (;;) held.push(fs.openSync("/dev/null", "r"));
  } catch {}
  // Proof of the state, and the public API keeps its contract: it throws.
  if (typeof Bun === "object") {
    try {
      Bun.file(fd).writer();
      writer = "opened";
    } catch (e) {
      writer = code(e);
    }
  }
}
const stream = process[which];
for (const h of held) fs.closeSync(h);

const fastPath = Object.getOwnPropertySymbols(stream).find(s => s.description === "kWriteStreamFastPath");
const sink = stream[fastPath]?.constructor?.name;
const report = extra =>
  fs.writeSync(fd === 1 ? 2 : 1, JSON.stringify({ type: stream._type, sink, writer, ...extra }) + "\n");
const callbacks = [];
const errors = [];
stream.on("error", e => errors.push(code(e)));

if (scenario === "failed-writes") {
  // The parent closes its end of the stream, then sends one byte on stdin.
  fs.readSync(0, Buffer.alloc(1));
  const write = chunk => stream.write(chunk, e => callbacks.push(code(e)));
  // Write again only after the stream has reported the first failure.
  stream.once("error", () => {
    for (let i = 0; i < 5; i++) write("y");
  });
  write("x");
  process.on("exit", () => report({ callbacks, errors, writableLength: stream.writableLength }));
} else if (scenario === "failed-writes-then-end") {
  // The parent closes its end of the stream, then sends one byte on stdin.
  fs.readSync(0, Buffer.alloc(1));
  const results = { end: "not called", finished: "not called" };
  const write = (chunk, then) =>
    stream.write(chunk, e => {
      callbacks.push(code(e));
      then?.();
    });
  // After the first failure: five more writes, then end() from the callback of the last one.
  stream.once("error", () => {
    for (let i = 0; i < 4; i++) write("y");
    write("y", () => {
      finished(stream, e => (results.finished = code(e)));
      stream.end(e => (results.end = code(e)));
    });
  });
  write("x");
  process.on("exit", () => report({ callbacks, errors, ...results, writableEnded: stream.writableEnded }));
} else if (scenario === "end-then-write") {
  stream.write("A", e => callbacks.push(code(e)));
  stream.end("B");
  stream.on("finish", () => {
    stream.write("C", e => {
      callbacks.push(code(e));
      stream.write("D", e => callbacks.push(code(e)));
    });
  });
  process.on("exit", () => report({ callbacks, errors, writableEnded: stream.writableEnded }));
} else if (scenario === "end-in-first-tick") {
  stream.end("E");
  stream.write("late", e => callbacks.push(code(e)));
  process.on("exit", () => report({ callbacks, errors }));
} else if (scenario === "write-then-exit") {
  stream.write("written before exit\n");
  report({});
  process.exit(0);
} else if (scenario === "big-write") {
  // More than a pipe or a socket holds. The parent reads the stream only after the first report.
  const ret = stream.write(Buffer.alloc(1 << 20, "x"));
  report({ ret });
  stream.once("drain", () => report({ drained: true }));
} else {
  throw new Error("unknown scenario " + scenario);
}
