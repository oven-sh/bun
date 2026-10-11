// Runs one scenario on process.stdout or process.stderr. The fd table is full when the stream is first read, so
// Bun cannot dup the fd for a FileSink. Node has no such step: the same file runs under node for comparison.
// The report goes to the other stdio fd with fs.writeSync.
import fs from "node:fs";
import tty from "node:tty";

const [which, scenario] = process.argv.slice(2);
const fd = which === "stdout" ? 1 : 2;
const code = e => (e == null ? null : e.code);

// A debug build reads internal modules from disk on first use. Load the stream modules while an fd is free.
void fs.WriteStream;
void tty.WriteStream.prototype;
const held = [];
try {
  for (;;) held.push(fs.openSync("/dev/null", "r"));
} catch {}
const stream = process[which];
for (const h of held) fs.closeSync(h);

const sink = Object.getOwnPropertySymbols(stream).some(s => s.description === "kWriteStreamFastPath");
const report = extra => fs.writeSync(fd === 1 ? 2 : 1, JSON.stringify({ type: stream._type, sink, ...extra }) + "\n");
const callbacks = [];
const errors = [];
stream.on("error", e => errors.push(code(e)));

if (scenario === "failed-writes") {
  // The parent closes its end of the stream, then sends one byte on stdin.
  fs.readSync(0, Buffer.alloc(1));
  const write = chunk => stream.write(chunk, e => callbacks.push(code(e)));
  // Write again only after the stream has reported the first failure. A write made while the first one is
  // still in flight fails together with it, on every build.
  stream.once("error", () => {
    for (let i = 0; i < 5; i++) write("y");
  });
  write("x");
  process.on("exit", () => report({ callbacks, errors, writableLength: stream.writableLength }));
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
} else {
  throw new Error("unknown scenario " + scenario);
}
