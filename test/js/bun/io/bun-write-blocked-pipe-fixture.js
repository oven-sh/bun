// Spawned by bun-write.test.js ("Bun.write to a full pipe").
// Each mode holds both ends of a FIFO the test made, so a write to it meets a
// full pipe and goes on only when this process reads. Prints one JSON line:
// the mode's result.
//
// argv: <mode> <fifo path> [<more paths>]
import { closeSync, constants, openSync, readSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";

const { O_RDONLY, O_WRONLY, O_NONBLOCK } = constants;

// More than the room that `leaveRoom` leaves in a pipe.
const size = 100_000;

function open(path) {
  const rfd = openSync(path, O_RDONLY | O_NONBLOCK);
  const wfd = openSync(path, O_WRONLY | O_NONBLOCK);
  return { path, rfd, wfd };
}

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
};

const [mode, ...paths] = process.argv.slice(2);
const result = await modes[mode](...paths);
if (result) console.log(JSON.stringify(result));
