"use strict";
// Call orders of fs.Utf8Stream over a stand-in for node:fs. A row delivers each completion itself, so a
// call order has one trace. `expected` is the trace of Node.js v26.12.1: `node <this file>` checks that,
// and `node <this file> --print` prints the traces. fs.test.ts checks the same traces on Bun.
const assert = require("node:assert");
const fs = require("node:fs");

const turn = () => new Promise(resolve => setImmediate(resolve));
const textOf = data =>
  typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1");
const bytesOf = data => (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength);
const errno = code => Object.assign(new Error(code), { code });
const codeOf = err => (err == null ? "ok" : err.code || err.name);

// `answers.write(i)` and `answers.writeSync(i)` give the answer of the i-th call: a byte count for a
// short write, an error code to fail, nothing to write all of it.
function world(answers = {}) {
  const trace = [];
  const completions = [];
  let nextFd = 100;
  let writes = 0;
  let syncWrites = 0;
  const standIn = {
    open(file, flags, mode, callback) {
      trace.push("open");
      completions.push(() => {
        trace.push(`  open -> ${nextFd}`);
        callback(null, nextFd++);
      });
    },
    write(fd, data, ...rest) {
      const callback = rest[rest.length - 1];
      const answer = answers.write?.(writes++);
      trace.push(`write(${fd}, ${JSON.stringify(textOf(data))})`);
      completions.push(() => {
        if (typeof answer === "string") {
          trace.push(`  write -> ${answer}`);
          callback(errno(answer));
        } else {
          const written = answer ?? bytesOf(data);
          trace.push(`  write -> ${written}`);
          callback(null, written);
        }
      });
    },
    writeSync(fd, data) {
      const answer = answers.writeSync?.(syncWrites++);
      if (typeof answer === "string") {
        trace.push(`writeSync(${fd}, ${JSON.stringify(textOf(data))}) throws ${answer}`);
        throw errno(answer);
      }
      const written = answer ?? bytesOf(data);
      trace.push(`writeSync(${fd}, ${JSON.stringify(textOf(data))}) -> ${written}`);
      return written;
    },
    fsync(fd, callback) {
      trace.push(`fsync(${fd})`);
      completions.push(() => {
        trace.push("  fsync -> ok");
        callback(null);
      });
    },
    fsyncSync(fd) {
      trace.push(`fsyncSync(${fd})`);
    },
    close(fd, callback) {
      trace.push(`close(${fd})`);
      completions.push(() => {
        trace.push("  close -> ok");
        callback(null);
      });
    },
  };
  return {
    trace,
    note: text => trace.push(text),
    flushed: name => err => trace.push(`${name}(${codeOf(err)})`),
    stream(options) {
      const stream = new fs.Utf8Stream({ fs: standIn, ...options });
      for (const event of ["ready", "write", "drain", "finish", "close"]) {
        stream.on(event, (...args) => trace.push([`'${event}'`, ...args].join(" ")));
      }
      stream.on("error", err => trace.push(`'error' ${codeOf(err)}`));
      return stream;
    },
    // Delivers one completion per turn of the event loop until none is left.
    async settle() {
      for (let delivered = 0; ; delivered++) {
        await turn();
        if (completions.length === 0) return;
        if (delivered === 100) throw new Error("the stream did not settle");
        completions.shift()();
      }
    },
    // Delivers the oldest completion only.
    async step() {
      await turn();
      completions.shift()();
    },
  };
}

const rows = {
  "fsync option: write(), flush(cb), end() closes once": {
    expected: [
      "'ready'",
      'write(99, "abc")',
      "  write -> 3",
      "'write' 3",
      "fsyncSync(99)",
      "cb(ok)",
      "fsync(99)",
      "  fsync -> ok",
      "close(99)",
      "  close -> ok",
      "'finish'",
      "'close'",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ fd: 99, fsync: true, minLength: 10 });
      await w.settle();
      stream.write("abc");
      stream.flush(w.flushed("cb"));
      stream.end();
      await w.settle();
      return w.trace;
    },
  },
  "a write() made while a flush waits is written before the callback": {
    expected: [
      "'ready'",
      'write(99, "a")',
      "  write -> 1",
      "'write' 1",
      'write(99, "b")',
      "  write -> 1",
      "'write' 1",
      "fsync(99)",
      "'drain'",
      "  fsync -> ok",
      "cb(ok)",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ fd: 99, minLength: 10 });
      await w.settle();
      stream.write("a");
      stream.flush(w.flushed("cb"));
      stream.write("b");
      await w.settle();
      return w.trace;
    },
  },
  "flushSync() with a write in flight writes the queue only": {
    expected: [
      "'ready'",
      'write(99, "in flight")',
      'writeSync(99, "queued") -> 6',
      "fsyncSync(99)",
      "flushSync() returned",
      "  write -> 9",
      "'write' 9",
      "'drain'",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ fd: 99 });
      await w.settle();
      stream.write("in flight");
      stream.write("queued");
      stream.flushSync();
      w.note("flushSync() returned");
      await w.settle();
      return w.trace;
    },
  },
  "flushSync() in a 'write' listener writes the rest of a short write first": {
    expected: [
      "'ready'",
      'write(99, "abcdef")',
      "  write -> 2",
      "'write' 2",
      'writeSync(99, "cdef") -> 4',
      'writeSync(99, "ghi") -> 3',
      "fsyncSync(99)",
      "flushSync() returned",
      "'drain'",
    ],
    async run() {
      const w = world({ write: i => (i === 0 ? 2 : undefined) });
      const stream = w.stream({ fd: 99 });
      await w.settle();
      stream.once("write", () => {
        stream.flushSync();
        w.note("flushSync() returned");
      });
      stream.write("abcdef");
      stream.write("ghi");
      await w.settle();
      return w.trace;
    },
  },
  "buffer mode: flushSync() in a 'write' listener keeps the lengths of the queued groups": {
    expected: [
      "'ready'",
      'write(99, "abcdef")',
      "  write -> 2",
      "'write' 2",
      'writeSync(99, "cdef") -> 4',
      'writeSync(99, "ghij") -> 1',
      'writeSync(99, "hij") -> 3',
      "flushSync() returned",
      "'drain'",
    ],
    async run() {
      const w = world({ write: i => (i === 0 ? 2 : undefined), writeSync: i => (i === 1 ? 1 : undefined) });
      const stream = w.stream({ fd: 99, contentMode: "buffer", maxWrite: 8 });
      await w.settle();
      stream.once("write", () => {
        stream.flushSync();
        w.note("flushSync() returned");
      });
      stream.write(Buffer.from("abcdef"));
      stream.write(Buffer.from("gh"));
      stream.write(Buffer.from("ij"));
      await w.settle();
      return w.trace;
    },
  },
  "flushSync() while a write waits to be tried again takes that write over": {
    expected: [
      "'ready'",
      'write(99, "abc")',
      "  write -> EAGAIN",
      'writeSync(99, "abc") -> 3',
      'writeSync(99, "def") -> 3',
      "fsyncSync(99)",
      "flushSync() returned",
      "'drain'",
    ],
    async run() {
      const w = world({ write: i => (i === 0 ? "EAGAIN" : undefined) });
      const stream = w.stream({ fd: 99 });
      await w.settle();
      stream.write("abc");
      await w.step();
      stream.write("def");
      stream.flushSync();
      w.note("flushSync() returned");
      await w.settle();
      return w.trace;
    },
  },
  "reopen(), then flushSync() while a write waits to be tried again, opens the new file": {
    expected: [
      "open",
      "  open -> 100",
      "'ready'",
      'write(100, "abc")',
      "  write -> EAGAIN",
      'writeSync(100, "abc") -> 3',
      "fsyncSync(100)",
      "flushSync() returned",
      "open",
      "  open -> 101",
      "'ready'",
      "close(100)",
      "'drain'",
      "  close -> ok",
    ],
    async run() {
      const w = world({ write: i => (i === 0 ? "EAGAIN" : undefined) });
      const stream = w.stream({ dest: "a.log" });
      await w.settle();
      stream.write("abc");
      await w.step();
      stream.reopen();
      stream.flushSync();
      w.note("flushSync() returned");
      await w.settle();
      return w.trace;
    },
  },
  "flushSync() throws a writeSync error that is not EAGAIN or EBUSY": {
    expected: ["'ready'", 'writeSync(99, "abc") throws EIO', "flushSync() threw EIO"],
    async run() {
      const w = world({ writeSync: i => (i === 0 ? "EIO" : undefined) });
      const stream = w.stream({ fd: 99, minLength: 10 });
      await w.settle();
      stream.write("abc");
      try {
        stream.flushSync();
        w.note("flushSync() returned");
      } catch (err) {
        w.note(`flushSync() threw ${codeOf(err)}`);
      }
      return w.trace;
    },
  },
  "buffer mode: flushSync() throws a writeSync error that is not EAGAIN or EBUSY": {
    expected: ["'ready'", 'writeSync(99, "abc") throws EIO', "flushSync() threw EIO"],
    async run() {
      const w = world({ writeSync: i => (i === 0 ? "EIO" : undefined) });
      const stream = w.stream({ fd: 99, minLength: 10, contentMode: "buffer" });
      await w.settle();
      stream.write(Buffer.from("abc"));
      try {
        stream.flushSync();
        w.note("flushSync() returned");
      } catch (err) {
        w.note(`flushSync() threw ${codeOf(err)}`);
      }
      return w.trace;
    },
  },
  "reopen() and destroy() while the file opens: the file is closed and not opened again": {
    expected: [
      "open",
      "  open -> 100",
      "'ready'",
      "fsync(100)",
      "  fsync -> ok",
      "close(100)",
      "  close -> ok",
      "'close'",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ dest: "a.log" });
      stream.reopen();
      stream.destroy();
      await w.settle();
      return w.trace;
    },
  },
  "destroy() while the file opens tells a pending flush": {
    expected: [
      "open",
      "'error' ERR_INVALID_STATE",
      "cb(ERR_INVALID_STATE)",
      "  open -> 100",
      "'ready'",
      "fsync(100)",
      "  fsync -> ok",
      "close(100)",
      "  close -> ok",
      "'close'",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ dest: "a.log" });
      stream.write("abc");
      stream.flush(w.flushed("cb"));
      stream.destroy();
      await w.settle();
      return w.trace;
    },
  },
  "destroy() with a write in flight and a flush pending: the flush is answered": {
    expected: [
      "'ready'",
      'write(99, "abc")',
      "fsync(99)",
      "  write -> 3",
      "'write' 3",
      "cb(ok)",
      "  fsync -> ok",
      "close(99)",
      "  close -> ok",
      "'close'",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ fd: 99 });
      await w.settle();
      stream.write("abc");
      stream.flush(w.flushed("cb"));
      stream.destroy();
      await w.settle();
      return w.trace;
    },
  },
  "destroy() with a write in flight, text queued and a flush pending: the flush gets the error": {
    expected: [
      "'ready'",
      'write(99, "abc")',
      "  write -> 1",
      "'write' 1",
      'write(99, "bc")',
      "fsync(99)",
      "  write -> 2",
      "'write' 2",
      "'error' ERR_INVALID_STATE",
      "cb(ERR_INVALID_STATE)",
      "  fsync -> ok",
      "close(99)",
      "  close -> ok",
      "'close'",
    ],
    async run() {
      const w = world({ write: i => (i === 0 ? 1 : undefined) });
      const stream = w.stream({ fd: 99, sync: false });
      await w.settle();
      stream.write("abc");
      stream.write("def");
      stream.flush(w.flushed("cb"));
      await w.step();
      stream.destroy();
      await w.settle();
      return w.trace;
    },
  },
  "a flush that a write error answers, then end()": {
    expected: [
      "'ready'",
      'write(99, "abc")',
      "  write -> EIO",
      "'error' EIO",
      "cb(EIO)",
      'write(99, "abc")',
      "  write -> 3",
      "'write' 3",
      "fsync(99)",
      "  fsync -> ok",
      "close(99)",
      "  close -> ok",
      "'finish'",
      "'close'",
    ],
    async run() {
      const w = world({ write: i => (i === 0 ? "EIO" : undefined) });
      const stream = w.stream({ fd: 99 });
      await w.settle();
      stream.write("abc");
      stream.flush(w.flushed("cb"));
      await w.settle();
      stream.end();
      await w.settle();
      return w.trace;
    },
  },
  "sync stream: each flush(cb) is answered, with no 'drain' listener": {
    expected: [
      "'ready'",
      'writeSync(99, "abc") -> 3',
      "'write' 3",
      "fsync(99)",
      "  fsync -> ok",
      "cb1(ok)",
      'writeSync(99, "def") -> 3',
      "'write' 3",
      "fsync(99)",
      "  fsync -> ok",
      "cb2(ok)",
    ],
    async run() {
      const w = world();
      const stream = w.stream({ fd: 99, sync: true, minLength: 10 });
      stream.removeAllListeners("drain");
      await w.settle();
      stream.write("abc");
      stream.flush(w.flushed("cb1"));
      await w.settle();
      stream.write("def");
      stream.flush(w.flushed("cb2"));
      await w.settle();
      return w.trace;
    },
  },
};

module.exports = { rows };

if (require.main === module) {
  (async () => {
    const print = process.argv.includes("--print");
    const traces = {};
    for (const [name, row] of Object.entries(rows)) {
      traces[name] = await row.run();
      if (!print) assert.deepStrictEqual(traces[name], row.expected, name);
    }
    console.log(print ? JSON.stringify(traces, null, 2) : `${Object.keys(rows).length} rows equal their traces`);
    process.exit(0);
  })();
}
