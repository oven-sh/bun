// Child of "a string source" in bun-write.test.js. It writes into its working directory.
import fs from "node:fs";
import path from "node:path";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const [mode, arg] = isMainThread ? process.argv.slice(2) : ["worker", workerData];
const out = path.join(process.cwd(), "out.txt");
const MiB = 1024 * 1024;

const wraps = {
  "a string": s => s,
  "a one-element array": s => [s],
  "a String object": s => new String(s),
  "a Response body": s => new Response(s),
  "a Request body": s => new Request("http://localhost/", { method: "POST", body: s }),
};

// A FIFO in the working directory. The fixture holds both ends of it and does not wait for the
// end of the pipe: kqueue does not report that for a FIFO on macOS.
function makeFifo() {
  const fifo = path.join(process.cwd(), "fifo");
  if (Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode !== 0) throw new Error("mkfifo failed");
  return fifo;
}

const openReader = fifo => fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);

// A write to this file waits on the io loop when the pipe is full.
function openWriter(fifo) {
  const pipe = Bun.file(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
  void pipe.size; // The write job now knows that this is not a regular file.
  return pipe;
}

// Takes `length` bytes out of the pipe, or fewer if the write settles before it wrote that many.
// When the pipe is empty, a write that is pending has more to write.
async function read(reader, length, written) {
  let settled = false;
  const settle = () => void (settled = true);
  written.then(settle, settle);
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    try {
      const count = fs.readSync(reader, bytes, offset, length - offset);
      if (count === 0) throw new Error("the pipe ended after " + offset + " bytes");
      offset += count;
    } catch (error) {
      if (error.code !== "EAGAIN") throw error;
      if (settled) break;
      await new Promise(setImmediate);
    }
  }
  return bytes.subarray(0, offset);
}

// Writes a string to the pipe and leaves the write as its only holder. The string is a property
// key by then, which makes it an atom of this thread: no other thread can release it.
function writeAndDrop(pipe) {
  const written = (() => {
    const str = Buffer.alloc(MiB, "abcd").toString();
    const written = Bun.write(pipe, str);
    ({})[str] = 1;
    return written;
  })();
  // JSC keeps the string that it made an atom last.
  ({})[Buffer.from("another key").toString()] = 1;
  Bun.gc(true);
  return written;
}

if (mode === "copies") {
  // How much memory the process gains inside each call. The Buffers the strings came from stay
  // alive and no write is awaited before the last call, so nothing of a string's size is freed
  // that a copy of a string could reuse.
  const size = Number(arg);
  const keep = [Buffer.alloc(size, "a"), Buffer.alloc(size, "k")];
  const str = keep[0].toString("latin1");
  const atom = keep[1].toString("latin1");
  ({})[atom] = 1;
  const sources = Object.fromEntries(Object.entries(wraps).map(([name, wrap]) => [name, wrap(str)]));
  let fd;
  // The name of the call, the bytes that the file must have, and the call.
  const calls = [
    ["Bun.write(path, string)", keep[0], path => Bun.write(path, str)],
    ["Bun.write(Bun.file(path), string)", keep[0], path => Bun.write(Bun.file(path), str)],
    ["Bun.write(fd, string)", keep[0], path => Bun.write((fd = fs.openSync(path, "w")), str)],
    ["Bun.file(path).write(string)", keep[0], path => Bun.file(path).write(str)],
    ["Bun.write(path, [string])", keep[0], path => Bun.write(path, sources["a one-element array"])],
    ["Bun.write(path, new String(string))", keep[0], path => Bun.write(path, sources["a String object"])],
    ["Bun.write(path, new Response(string))", keep[0], path => Bun.write(path, sources["a Response body"])],
    [
      "Bun.write(path, new Request(url, { body: string }))",
      keep[0],
      path => Bun.write(path, sources["a Request body"]),
    ],
    ["Bun.write(path, atom)", keep[1], path => Bun.write(path, atom)],
  ];
  // The first writes on the work pool start its threads.
  await Promise.all([1, 2, 3, 4].map(i => Bun.write(out + i, new Blob(["warm"]))));
  const started = calls.map(([name, bytes, call], i) => {
    const path = out + "-" + i;
    const before = process.memoryUsage.rss();
    const written = call(path);
    const grew = process.memoryUsage.rss() - before;
    return { name, bytes, path, grew, written };
  });
  const written = await Promise.all(started.map(call => call.written));
  fs.closeSync(fd);
  const results = {};
  started.forEach(({ name, bytes, path, grew }, i) => {
    results[name] = { copied: grew >= size / 2, written: written[i], same: fs.readFileSync(path).equals(bytes) };
  });
  console.log(JSON.stringify({ results, keep: keep.map(buffer => buffer.length) }));
} else if (mode === "strings") {
  // The write reads the first two where they are (the rope once it is flat). It copies an atom
  // and a substring, and it makes the UTF-8 form of the others.
  const strings = {
    "ASCII": () => Buffer.alloc(300_000, "a").toString(),
    "a rope": () => Buffer.alloc(150_000, "l").toString() + Buffer.alloc(150_000, "r").toString(),
    "an atom": () => {
      const key = Buffer.alloc(300_000, "k").toString();
      ({})[key] = 1;
      return key;
    },
    "a substring": () => Buffer.alloc(600_000, "s").toString().slice(7, 300_007),
    "Latin-1": () => Buffer.alloc(300_000, 0xe9).toString("latin1"),
    "one character above 0x7f": () => Buffer.alloc(300_000, "a").toString() + "\u00e9",
    "UTF-16": () => Buffer.alloc(600_000, "\u4e2d", "utf16le").toString("utf16le"),
    "a lone surrogate": () => Buffer.alloc(300_000, "a").toString() + "\ud800",
    "a short string": () => "h\u00e9llo",
  };
  const results = {};
  for (const [source, wrap] of Object.entries(wraps)) {
    const rows = (results[source] = {});
    // The caller makes each string a property key and drops it. The writes can still be pending.
    const started = Object.entries(strings).map(([name, make], i) => {
      const str = make();
      const path = out + "-" + i;
      const written = Bun.write(path, wrap(str));
      ({})[str] = 1;
      return { name, make, path, written };
    });
    Bun.gc(true);
    for (const { name, make, path, written } of started) {
      const size = await written;
      const bytes = fs.readFileSync(path);
      rows[name] = {
        written: size,
        same: bytes.equals(Buffer.from(make(), "utf8")),
        end: bytes.subarray(-3).toString("hex"),
      };
    }
    fs.writeFileSync(out, "previous");
    const written = Bun.write(out, wrap(""));
    rows["an empty string"] = {
      // The file is empty and the promise is fulfilled before the call returns.
      status: Bun.peek.status(written),
      content: fs.readFileSync(out, "utf8"),
      written: await written,
    };
  }
  console.log(JSON.stringify(results));
} else if (mode === "parked") {
  // Nobody reads the pipe before the string is dropped, so the write is pending then.
  const fifo = makeFifo();
  const reader = openReader(fifo);
  const written = writeAndDrop(openWriter(fifo));
  const piped = await read(reader, MiB, written);
  console.log(JSON.stringify({ written: await written, whole: piped.equals(Buffer.alloc(MiB, "abcd")) }));
} else if (mode === "parked-in-worker") {
  // Nobody reads the pipe, so the write of the worker is pending when the worker is terminated.
  const fifo = makeFifo();
  openReader(fifo);
  const worker = new Worker(import.meta.filename, { workerData: fifo });
  const { promise: started, resolve, reject } = Promise.withResolvers();
  worker.once("message", resolve);
  worker.once("error", reject);
  await started;
  console.log(JSON.stringify({ exitCode: await worker.terminate() }));
} else if (mode === "worker") {
  writeAndDrop(openWriter(arg));
  parentPort.postMessage("started");
} else if (mode === "substring") {
  // Writes a 2 MiB slice of a 64 MiB string, then drops both strings. The slice refers to the
  // buffer of the long string.
  const fifo = makeFifo();
  const reader = openReader(fifo);
  const pipe = openWriter(fifo);
  const before = process.memoryUsage.rss();
  let base = new Array(64).fill(Buffer.alloc(MiB, "a").toString()).join("");
  let slice = base.slice(1, 2 * MiB + 1);
  const written = Bun.write(pipe, slice);
  base = slice = undefined;
  let freed = false;
  for (let polls = 0; polls < 100 && !freed; polls++) {
    Bun.gc(true);
    await Bun.sleep(10);
    freed = process.memoryUsage.rss() < before + 32 * MiB;
  }
  const piped = await read(reader, 2 * MiB, written);
  console.log(JSON.stringify({ freed, written: await written, whole: piped.equals(Buffer.alloc(2 * MiB, "a")) }));
} else {
  throw new Error("unknown mode " + mode);
}
