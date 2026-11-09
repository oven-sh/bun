// A program puts its own read, write, writev and fsync on node:fs, as a file system held in memory does: each counts
// the call, reports success and touches no file. A stream over a FileHandle does its I/O through the handle
// (FileHandleOperations in Node's lib/internal/fs/streams.js), so it calls none of them and still reaches the file.
// Only a stream over a path or a raw descriptor calls what node:fs exports. Node.js prints the same for this file.
//
// argv[2]: when the program puts its functions there. The working directory holds lines.txt and nothing else.
"use strict";
const when = process.argv[2];

// node:fs keeps the functions for these streams in an object of its own. A program's accessor on Object.prototype
// must not see that: node:fs loads, and the setter is handed nothing.
let setterCalls = 0;
if (when === "under an accessor named fs on Object.prototype") {
  Object.defineProperty(Object.prototype, "fs", {
    get() {
      return undefined;
    },
    set() {
      setterCalls++;
    },
    configurable: true,
  });
}
if (when === "after process.stdout") void process.stdout;
const fs = require("node:fs");
const { once } = require("node:events");
if (when === "after the stream classes") {
  void fs.ReadStream;
  void fs.WriteStream;
}

const calls = { read: 0, write: 0, writev: 0, fsync: 0 };
fs.read = (fd, buffer, offset, length, position, callback) => {
  calls.read++;
  process.nextTick(callback, null, 0, buffer);
};
fs.write = (fd, buffer, offset, length, position, callback) => {
  calls.write++;
  process.nextTick(callback, null, length, buffer);
};
fs.writev = (fd, buffers, position, callback) => {
  calls.writev++;
  process.nextTick(callback, null, Buffer.concat(buffers).length, buffers);
};
fs.fsync = (fd, callback) => {
  calls.fsync++;
  process.nextTick(callback, null);
};

// What the stream leaves in the file.
async function written(file, stream, write = () => stream.end("abc")) {
  write();
  await once(stream, "close");
  return fs.readFileSync(file, "utf8");
}

// What the stream reads.
async function read(stream) {
  let text = "";
  stream.on("data", chunk => (text += chunk));
  await once(stream, "close");
  return text;
}

(async () => {
  const open = (file, flags) => fs.promises.open(file, flags);
  const corked = (await open("3.txt", "w")).createWriteStream();
  const overHandle = {
    "handle.createWriteStream()": await written("1.txt", (await open("1.txt", "w")).createWriteStream()),
    "fs.createWriteStream(null, { fd })": await written(
      "2.txt",
      fs.createWriteStream(null, { fd: await open("2.txt", "w") }),
    ),
    "a corked batch": await written("3.txt", corked, () => {
      corked.cork();
      corked.write("a");
      corked.write("b");
      corked.write("c");
      corked.uncork();
      corked.end();
    }),
    "flush": await written("4.txt", (await open("4.txt", "w")).createWriteStream({ flush: true })),
    "handle.createReadStream()": await read((await open("lines.txt")).createReadStream()),
    "fs.createReadStream(null, { fd })": await read(fs.createReadStream(null, { fd: await open("lines.txt") })),
    calls: { ...calls },
  };
  // The controls: a stream over a path or a raw descriptor calls the program's functions, which write nothing and
  // read nothing.
  let before = { ...calls };
  const overPath = {
    "fs.createWriteStream(path)": await written("5.txt", fs.createWriteStream("5.txt")),
    "fs.createReadStream(path)": await read(fs.createReadStream("lines.txt")),
    calls: { read: calls.read - before.read, write: calls.write - before.write },
  };
  before = { ...calls };
  const overDescriptor = {
    "fs.createWriteStream(null, { fd: number })": await written(
      "6.txt",
      fs.createWriteStream(null, { fd: fs.openSync("6.txt", "w") }),
    ),
    "fs.createReadStream(null, { fd: number })": await read(
      fs.createReadStream(null, { fd: fs.openSync("lines.txt") }),
    ),
    calls: { read: calls.read - before.read, write: calls.write - before.write },
  };
  console.log(JSON.stringify({ overHandle, overPath, overDescriptor, setterCalls }));
})();
