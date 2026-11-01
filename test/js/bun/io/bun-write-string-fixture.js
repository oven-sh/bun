// Child of "a string source" in bun-write.test.js. It writes into its working directory, or to
// a pipe that the test made and does not read yet.
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

// A write to this file waits on the io loop when the pipe is full.
function openPipe(fifo) {
  const pipe = Bun.file(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
  void pipe.size; // The write job now knows that this is not a regular file.
  return pipe;
}

// Writes a string to the pipe and leaves the write as its only holder. The string is a property
// key by then, which makes it an atom of this thread: no other thread can release it.
function writeToPipeAndDrop(fifo) {
  const pipe = openPipe(fifo);
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
  // How much memory the process gains inside each call. The Buffer the string came from stays
  // alive and no write is awaited before the last call, so nothing of the string's size is
  // freed that a copy of the string could reuse.
  const size = Number(arg);
  const keep = Buffer.alloc(size, "a");
  const str = keep.toString("latin1");
  const atom = Buffer.alloc(size, "k").toString("latin1");
  ({})[atom] = 1;
  const fd = fs.openSync(out + "-fd", "w");
  const sources = Object.fromEntries(Object.entries(wraps).map(([name, wrap]) => [name, wrap(str)]));
  const calls = {
    "Bun.write(path, string)": path => Bun.write(path, str),
    "Bun.write(Bun.file(path), string)": path => Bun.write(Bun.file(path), str),
    "Bun.write(fd, string)": () => Bun.write(fd, str),
    "Bun.file(path).write(string)": path => Bun.file(path).write(str),
    "Bun.write(path, [string])": path => Bun.write(path, sources["a one-element array"]),
    "Bun.write(path, new String(string))": path => Bun.write(path, sources["a String object"]),
    "Bun.write(path, new Response(string))": path => Bun.write(path, sources["a Response body"]),
    "Bun.write(path, new Request(url, { body: string }))": path => Bun.write(path, sources["a Request body"]),
    "Bun.write(path, atom)": path => Bun.write(path, atom),
  };
  // The first writes on the work pool start its threads.
  await Promise.all([1, 2, 3, 4].map(i => Bun.write(out + i, new Blob(["warm"]))));
  const started = Object.entries(calls).map(([name, call], i) => {
    const before = process.memoryUsage.rss();
    const written = call(out + "-" + i);
    const grew = process.memoryUsage.rss() - before;
    return [name, grew, written];
  });
  const results = {};
  for (const [name, grew, written] of started) {
    results[name] = { copied: grew >= size / 2, written: await written };
  }
  fs.closeSync(fd);
  console.log(JSON.stringify({ results, keep: keep.length }));
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
    for (const [name, make] of Object.entries(strings)) {
      let str = make();
      const written = Bun.write(out, wrap(str));
      // The caller makes the string a property key and drops it. The write can still be pending.
      ({})[str] = 1;
      str = undefined;
      Bun.gc(true);
      const size = await written;
      const bytes = fs.readFileSync(out);
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
  const written = writeToPipeAndDrop(arg);
  console.error("parked");
  console.error(await written);
} else if (mode === "parked-in-worker") {
  const worker = new Worker(import.meta.filename, { workerData: arg });
  const { promise: started, resolve, reject } = Promise.withResolvers();
  worker.once("message", resolve);
  worker.once("error", reject);
  await started;
  console.error("exit code " + (await worker.terminate()));
} else if (mode === "worker") {
  writeToPipeAndDrop(arg);
  parentPort.postMessage("started");
} else if (mode === "substring") {
  // Writes a 2 MiB slice of a 64 MiB string, then drops both strings. The slice refers to the
  // buffer of the long string.
  const pipe = openPipe(arg);
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
  console.error(JSON.stringify({ freed }));
  console.error(await written);
} else {
  throw new Error("unknown mode " + mode);
}
