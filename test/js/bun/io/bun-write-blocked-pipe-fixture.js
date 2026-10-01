// Spawned by bun-write.test.js ("Bun.write to a full pipe").
// Each mode holds both ends of a FIFO the test made, so a write to it meets a
// full pipe and goes on only when this process reads. Prints one JSON line:
// the mode's result, for each state of the destination if the mode has two.
//
// argv: <mode> <fifo path> [<more paths>]
import { once } from "node:events";
import { closeSync, constants, openSync, readSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isMainThread, Worker, workerData } from "node:worker_threads";

const { O_RDONLY, O_WRONLY, O_NONBLOCK } = constants;

// More than the room that `leaveRoom` leaves in a pipe.
const size = 100_000;

function open(path) {
  const rfd = openSync(path, O_RDONLY | O_NONBLOCK);
  const wfd = openSync(path, O_WRONLY | O_NONBLOCK);
  return { path, rfd, wfd };
}

// The destination of the writes. In the "sized" state `.size` is read first,
// which tells the file store that the fd is a pipe.
function destination(wfd, sized) {
  const file = Bun.file(wfd);
  if (sized) void file.size;
  return file;
}

// Resolves with the byte count of the write, or with how it failed. A Blob
// source goes to the work pool whatever its size.
const write = (file, bytes) =>
  Bun.write(file, new Blob([bytes])).then(
    n => n,
    e => `${e.code}/${e.syscall}`,
  );

// Fills the FIFO, one page at a time, until it takes no more. Returns how
// many bytes that was.
function fill(wfd) {
  const page = Buffer.alloc(4096, "f");
  let filled = 0;
  try {
    for (;;) filled += writeSync(wfd, page);
  } catch (e) {
    if (e.code !== "EAGAIN") throw e;
  }
  return filled;
}

// Blocks until a write to the FIFO has put its first bytes in, and returns one.
function firstByte(path) {
  const gate = openSync(path, O_RDONLY);
  const byte = Buffer.alloc(1);
  readSync(gate, byte, 0, 1, null);
  closeSync(gate);
  return byte;
}

// Everything in the FIFO right now.
function readAvailable(rfd) {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = readSync(rfd, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === "EAGAIN") break;
      throw e;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

// Leaves the FIFO with room for at most 64 KiB, however much it can hold: a
// write of more than that stops in the middle. Returns the room, and how many
// bytes of `fill` are still in the pipe in front of what is written next.
function leaveRoom(end, atMost = 65536) {
  const filled = fill(end.wfd);
  const room = Math.min(filled, atMost);
  const taken = Buffer.alloc(room);
  for (let got = 0; got < room; ) got += readSync(end.rfd, taken, got, room - got, null);
  return { room, left: filled - room };
}

// `cat` reads the FIFO to its end through `fd`, a read end that blocks. Its
// read(2) waits in the kernel, which sees the end on every platform: a kqueue
// on macOS does not report it for a FIFO.
function readToEnd(fd) {
  const cat = Bun.spawn({ cmd: ["cat"], stdin: fd, stdout: "pipe", stderr: "inherit" });
  closeSync(fd);
  return cat.stdout.bytes();
}

// Reads the FIFO to its end while `writes` settle. The end comes when every
// write end is closed: this process's, and any that a write kept for itself.
async function drain(end, writes) {
  const rest = readToEnd(openSync(end.path, O_RDONLY));
  const resolved = await Promise.all(writes);
  closeSync(end.wfd);
  const received = Buffer.from(await rest);
  closeSync(end.rfd);
  return { resolved, received };
}

function count(buf, byte) {
  let n = 0;
  for (let i = 0; i < buf.length; i++) n += buf[i] === byte;
  return n;
}

// Keeps one thread of the work pool in a read of the FIFO at `path`, until
// the returned function is called. fs.promises.readFile opens the FIFO on a
// pool thread, which waits there for a writer, and then reads to the end.
async function holdPoolThread(path) {
  const done = readFile(path);
  let wfd;
  for (;;) {
    try {
      wfd = openSync(path, O_WRONLY | O_NONBLOCK);
      break;
    } catch (e) {
      // No reader yet: the pool thread has not opened the FIFO.
      if (e.code !== "ENXIO") throw e;
      await new Promise(setImmediate);
    }
  }
  return () => (closeSync(wfd), done);
}

function workerPayload() {
  const payload = Buffer.alloc(size);
  for (let i = 0; i < size; i++) payload[i] = i % 251;
  return payload;
}

// `length` bytes of `fill` with the offset written in every 4096 bytes: a
// byte that arrives twice, or not at all, moves every offset after it.
function stamped(length, fill = "a") {
  const bytes = Buffer.alloc(length, fill);
  for (let i = 0; i < length; i += 4096) bytes.write(String(i).padStart(10, "0").slice(0, length - i), i);
  return bytes;
}

// "exact", or how `received` and the resolved count differ from `expected`.
// `left` bytes of `fill` were in the pipe in front of the write.
function compare(expected, received, resolved, left = 0) {
  if (count(received.subarray(0, left), 0x66) !== left) return "the bytes that were in the pipe changed";
  received = received.subarray(left);
  if (resolved === expected.length && received.equals(expected)) return "exact";
  let at = 0;
  while (at < received.length && at < expected.length && received[at] === expected[at]) at++;
  return `resolved ${resolved}, received ${received.length} of ${expected.length} bytes, first difference at ${at}`;
}

// Every way to give Bun.write a destination that it tries to write to at
// once, before the work pool.
const destinations = {
  "Bun.write(fd)": (end, data) => Bun.write(end.wfd, data),
  "Bun.write(Bun.file(fd))": (end, data) => Bun.write(Bun.file(end.wfd), data),
  "Bun.file(fd).write()": (end, data) => Bun.file(end.wfd).write(data),
  "Bun.write(path)": (end, data) => Bun.write(end.path, data),
  "Bun.write(Bun.file(path))": (end, data) => Bun.write(Bun.file(end.path), data),
  "Bun.file(path).write()": (end, data) => Bun.file(end.path).write(data),
};

// The payloads that get that attempt (under 256 KiB), as [data, its bytes].
const payloads = {
  Buffer: length => [stamped(length), stamped(length)],
  string: length => [stamped(length).toString("latin1"), stamped(length)],
  // Two bytes a character in UTF-8, so the pipe can fill in the middle of one.
  "two-byte string": length => [stamped(length, "\u00e9").toString(), stamped(length, "\u00e9")],
};

// Modes about a write that waits. Each runs once for each state of the
// destination: the file store knows that the fd is a pipe ("sized"), or not.
const byState = {
  // Two writes wait with a two-thread work pool (UV_THREADPOOL_SIZE=2). The
  // unrelated read needs a pool thread, and nothing drains the FIFOs before
  // it resolves.
  async pool(sized, fifoA, fifoB, smallFile) {
    const ends = [open(fifoA), open(fifoB)];
    const payloads = [Buffer.alloc(size, "a"), Buffer.alloc(size, "b")];
    const writes = ends.map((end, i) => write(destination(end.wfd, sized), payloads[i]));
    const first = ends.map(end => firstByte(end.path));

    const text = await Bun.file(smallFile).text();
    const statusAfterRead = writes.map(pending => Bun.peek.status(pending));

    const drained = await Promise.all(ends.map((end, i) => drain(end, [writes[i]])));
    return {
      text,
      statusAfterRead,
      resolved: drained.map(({ resolved }) => resolved[0]),
      delivered: drained.map(({ received }, i) => Buffer.concat([first[i], received]).equals(payloads[i])),
    };
  },

  // A Worker's write waits. terminate() has to resolve while the FIFO is
  // still full: nothing drains it before.
  async terminate(sized, fifo) {
    const { path, rfd, wfd } = open(fifo);
    const worker = new Worker(new URL(import.meta.url), { workerData: { wfd, sized } });
    const failed = Promise.withResolvers();
    worker.once("error", failed.reject);
    const first = firstByte(path);

    const exitCode = await Promise.race([worker.terminate(), failed.promise]);

    const got = Buffer.concat([first, readAvailable(rfd)]);
    closeSync(rfd), closeSync(wfd);
    return {
      terminated: typeof exitCode === "number",
      partial: got.length > 1 && got.length < size,
      prefixExact: got.equals(workerPayload().subarray(0, got.length)),
    };
  },

  // The only reader of each FIFO goes away while a write waits. The pool has
  // two threads (UV_THREADPOOL_SIZE=2) and each is in a write, so the
  // unrelated read resolves only once a write waits.
  async epipe(sized, fifoA, fifoB, smallFile) {
    const ends = [open(fifoA), open(fifoB)];
    const pending = ends.map(end => write(destination(end.wfd, sized), Buffer.alloc(size, "a")));
    for (const end of ends) firstByte(end.path);
    await Bun.file(smallFile).text();
    for (const end of ends) closeSync(end.rfd);
    const results = await Promise.all(pending);
    for (const end of ends) closeSync(end.wfd);
    return { results };
  },

  // Two writes wait on one fd at the same time: the pipe is full before they
  // start, and the unrelated read gives both the time to find that out. Each
  // has to finish, and neither may keep a fd of its own on the FIFO: the
  // drain would not end.
  async sameFd(sized, fifo, smallFile) {
    const end = open(fifo);
    fill(end.wfd);
    const file = destination(end.wfd, sized);
    const writes = [write(file, Buffer.alloc(size, "a")), write(file, Buffer.alloc(size, "b"))];
    await Bun.file(smallFile).text();
    const { resolved, received } = await drain(end, writes);
    return { resolved, a: count(received, 0x61), b: count(received, 0x62) };
  },

  // The write's last byte fills the pipe again. It has to resolve with the
  // pipe full: nothing reads after that byte.
  async lastByte(sized, fifo) {
    const { rfd, wfd } = open(fifo);
    fill(wfd);
    const page = Buffer.alloc(4096);
    const pending = write(destination(wfd, sized), Buffer.alloc(page.length, "b"));
    readSync(rfd, page, 0, page.length, null);
    const resolved = await pending;
    closeSync(rfd), closeSync(wfd);
    return { resolved };
  },
};

const modes = {
  // One write for each row of `cases`. Nothing reads the FIFO before the
  // write is under way, so the pipe fills in the middle of the payload, or
  // is full before the first byte where the row says so.
  async destinations(fifo) {
    // More than the room in the pipe.
    const more = 70_000;
    const cases = [];
    for (const name of Object.keys(destinations)) cases.push([name, "Buffer", more, "room"]);
    for (const name of ["Bun.write(fd)", "Bun.write(path)"]) {
      cases.push([name, "string", more, "room"], [name, "two-byte string", more, "room"]);
      cases.push([name, "Buffer", more, "no room"], [name, "string", more, "no room"]);
      // The largest payload that gets the attempt, and one that leaves a
      // single byte for later.
      cases.push([name, "Buffer", 256 * 1024 - 1, "room"], [name, "Buffer", "room + 1", "room"]);
    }

    const result = {};
    for (const [name, kind, length, pipe] of cases) {
      const end = open(fifo);
      const { room, left } = leaveRoom(end, pipe === "room" ? undefined : 0);
      const [data, expected] = payloads[kind](length === "room + 1" ? room + 1 : length);
      const write = destinations[name](end, data);
      const atOnce = Bun.peek.status(write);
      const { resolved, received } = await drain(end, [write.catch(e => `${e.code}/${e.syscall}`)]);
      result[`${name}, ${kind} of ${length} bytes, ${pipe} in the pipe`] =
        atOnce === "pending" ? compare(expected, received, resolved[0], left) : `${atOnce} before a read`;
    }
    return result;
  },

  // Bun.write is the only writer of the FIFO, and it opens the path itself.
  // Both threads of the work pool (UV_THREADPOOL_SIZE=2) wait in a read of
  // another FIFO, so what is left of the write cannot start. Once this thread
  // has read what the first try wrote, the pipe is empty, and its write end
  // has to be open still: a reader would see the end of the data otherwise.
  async soleWriter(fifo, blockerA, blockerB) {
    const end = open(fifo);
    const { left } = leaveRoom(end);
    closeSync(end.wfd);
    const release = [await holdPoolThread(blockerA), await holdPoolThread(blockerB)];

    const payload = stamped(size);
    const write = Bun.write(fifo, payload).catch(e => `${e.code}/${e.syscall}`);
    const chunks = [];
    const buf = Buffer.alloc(65536);
    let writeEnd;
    while (!writeEnd) {
      try {
        const n = readSync(end.rfd, buf, 0, buf.length, null);
        if (n === 0) writeEnd = "closed";
        else chunks.push(Buffer.from(buf.subarray(0, n)));
      } catch (e) {
        if (e.code !== "EAGAIN") throw e;
        writeEnd = "open";
      }
    }

    // With no write end, a reader that opens the FIFO now would wait for one.
    const rest = writeEnd === "open" ? readToEnd(openSync(fifo, O_RDONLY)) : undefined;
    closeSync(end.rfd);
    await Promise.all(release.map(letGo => letGo()));
    if (!rest) return { writeEnd };
    const received = Buffer.concat([...chunks, await rest]);
    return { writeEnd, write: compare(payload, received, await write, left) };
  },

  // The headline case: a child whose stdout is a pipe uses process.stdout,
  // which puts the pipe in non-blocking mode, and then writes to Bun.stdout.
  // The child says on stderr when the write is under way, and nothing reads
  // the pipe before that.
  async stdout(fifo) {
    const end = open(fifo);
    const { left } = leaveRoom(end);
    const child = Bun.spawn({
      cmd: [process.execPath, import.meta.path, "stdoutWriter"],
      env: process.env,
      stdin: "ignore",
      stdout: end.wfd,
      stderr: "pipe",
    });
    const reader = openSync(end.path, O_RDONLY);
    closeSync(end.wfd);
    const decoder = new TextDecoder();
    let stderr = "";
    let rest;
    for await (const chunk of child.stderr) {
      stderr += decoder.decode(chunk, { stream: true });
      // To the end of the pipe: the child's exit closes the last write end.
      if (stderr.includes("under way\n")) rest ??= readToEnd(reader);
    }
    const received = Buffer.from(await rest);
    closeSync(end.rfd);
    return {
      stderr: stderr.replace(/resolved (\d+)\n/, ""),
      write: compare(stamped(size), received, Number(/resolved (\d+)\n/.exec(stderr)?.[1]), left),
      exitCode: await child.exited,
    };
  },
  async stdoutWriter() {
    void process.stdout.isTTY;
    const write = Bun.write(Bun.stdout, stamped(size));
    process.stderr.write(`${Bun.peek.status(write)}, under way\n`);
    process.stderr.write(`resolved ${await write}\n`);
  },

  // A Worker starts a write to the FIFO's path and exits at once, so the
  // rest of the write is cancelled, or never runs. Either way the fd that
  // the write opened has to be closed by then.
  async workerExit(fifo) {
    const end = open(fifo);
    await once(new Worker(new URL(import.meta.url), { workerData: { exitAfterWriteTo: end.path } }), "exit");
    closeSync(end.wfd);
    // What the write left in the pipe, then its end. A read returns 0 there
    // only if no write end is open: with one left it fails with EAGAIN.
    const buf = Buffer.alloc(65536);
    let left = 0;
    for (;;) {
      let n;
      try {
        n = readSync(end.rfd, buf, 0, buf.length, null);
      } catch (e) {
        if (e.code !== "EAGAIN") throw e;
        return { left: left > 0, writeEnds: "open" };
      }
      if (n === 0) return { left: left > 0, writeEnds: "closed" };
      left += n;
    }
  },
};

if (!isMainThread) {
  if (workerData.exitAfterWriteTo) {
    Bun.write(workerData.exitAfterWriteTo, stamped(size));
    process.exit(0);
  }
  write(destination(workerData.wfd, workerData.sized), workerPayload());
} else {
  const [mode, ...paths] = process.argv.slice(2);
  if (mode in modes) {
    const result = await modes[mode](...paths);
    if (result) console.log(JSON.stringify(result));
  } else {
    // How a write starts to wait does not change what these two modes check,
    // so one state is enough for them.
    const states = mode === "pool" || mode === "terminate" ? ["plain"] : ["plain", "sized"];
    const result = {};
    for (const state of states) result[state] = await byState[mode](state === "sized", ...paths);
    console.log(JSON.stringify(result));
  }
}
