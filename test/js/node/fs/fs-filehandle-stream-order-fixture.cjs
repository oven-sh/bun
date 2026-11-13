// Prints, for each kind of file stream, the order of a stream callback, a microtask that it queues and a
// process.nextTick that it queues. Node and Bun both run this file: fs.test.ts holds the two to one list.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-filehandle-stream-order-"));
const file = path.join(dir, "in.txt");
const out = path.join(dir, "out.txt");
fs.writeFileSync(file, "one\ntwo\n");

const reader = () => fs.promises.open(file, "r");
const writer = () => fs.promises.open(out, "w");

function written(stream, callback, chunks = 1) {
  for (let i = 1; i < chunks; i++) stream.write("a");
  stream.write("b", callback);
  stream.end();
  return stream;
}
// The 'readable' that has the data comes from a process.nextTick. The one at the end of the file comes from the read callback.
function readableAtEnd(stream, callback) {
  return stream.on("readable", () => {
    if (stream.read() === null) callback();
  });
}
function replaced(handle, name) {
  const original = handle[name];
  handle[name] = function (...args) {
    return original.apply(this, args);
  };
  return handle;
}

// Each row makes a stream, hands `callback` to the place it names, and answers what emits 'close' when the row is over.
const rows = {
  // Node calls these back from the reaction of a promise of the handle.
  "handle.createReadStream(): 'data'": async callback => (await reader()).createReadStream().once("data", callback),
  "fs.createReadStream(null, { fd: handle }): 'data'": async callback =>
    fs.createReadStream(null, { fd: await reader() }).once("data", callback),
  "new fs.ReadStream(null, { fd: handle }): 'data'": async callback =>
    new fs.ReadStream(null, { fd: await reader() }).once("data", callback),
  "handle.createReadStream(): 'readable' at the end of the file": async callback =>
    readableAtEnd((await reader()).createReadStream(), callback),
  "handle.readLines(): 'line'": async callback => (await reader()).readLines().once("line", callback),
  "handle.createWriteStream(): the callback of write()": async callback =>
    written((await writer()).createWriteStream(), callback),
  "fs.createWriteStream(null, { fd: handle }): the callback of write()": async callback =>
    written(fs.createWriteStream(null, { fd: await writer() }), callback),
  "new fs.WriteStream(null, { fd: handle }): the callback of write()": async callback =>
    written(new fs.WriteStream(null, { fd: await writer() }), callback),
  "handle.createWriteStream(): the callback of a write() that fails": async callback =>
    written((await reader()).createWriteStream(), callback).on("error", () => {}),
  "handle.createWriteStream(): 'drain'": async callback => {
    const stream = (await writer()).createWriteStream({ highWaterMark: 1 });
    stream.once("drain", callback).once("drain", () => stream.end());
    stream.write("ab");
    return stream;
  },
  // Chunks that wait for the stream to be constructed go to the handle in one writev.
  "handle.createWriteStream(): the callback of the last of two chunks": async callback =>
    written((await writer()).createWriteStream(), callback, 2),
  "a handle whose writev() the program replaced: the callback of the last of two chunks": async callback =>
    written(replaced(await writer(), "writev").createWriteStream(), callback, 2),
  "a handle whose read() the program replaced: 'data'": async callback =>
    replaced(await reader(), "read")
      .createReadStream()
      .once("data", callback),
  "a handle whose write() the program replaced: the callback of write()": async callback =>
    written(replaced(await writer(), "write").createWriteStream(), callback),

  // The stream emits these from a process.nextTick of its own, on a handle too.
  "handle.createReadStream(): 'end'": async callback =>
    (await reader()).createReadStream().on("end", callback).resume(),
  "handle.createWriteStream(): 'finish'": async callback => {
    const stream = (await writer()).createWriteStream().on("finish", callback);
    stream.end("a");
    return stream;
  },
  "handle.createWriteStream(): the callback of end()": async callback => {
    const stream = (await writer()).createWriteStream();
    stream.end("a", callback);
    return stream;
  },

  // A stream on a path or on a descriptor uses the callbacks of node:fs.
  "fs.createReadStream(path): 'data'": async callback => fs.createReadStream(file).once("data", callback),
  "fs.createReadStream(null, { fd }): 'data'": async callback =>
    fs.createReadStream(null, { fd: fs.openSync(file, "r") }).once("data", callback),
  "fs.createReadStream(path): 'readable' at the end of the file": async callback =>
    readableAtEnd(fs.createReadStream(file), callback),
  "fs.createWriteStream(path): the callback of write()": async callback => written(fs.createWriteStream(out), callback),
  "fs.createWriteStream(null, { fd }): the callback of write()": async callback =>
    written(fs.createWriteStream(null, { fd: fs.openSync(out, "w") }), callback),
  "fs.createWriteStream(path): the callback of the last of two chunks": async callback =>
    written(fs.createWriteStream(out), callback, 2),
};

(async () => {
  // After process.nextTick is first read on a thread, Bun runs the tick queue once behind the next microtask that
  // ends, whichever it is. This one ends first.
  await new Promise(resolve => process.nextTick(resolve));
  const orders = {};
  for (const name in rows) {
    const order = [];
    const stream = await rows[name](() => {
      if (order.length > 0) return;
      order.push("callback");
      process.nextTick(() => order.push("nextTick"));
      queueMicrotask(() => order.push("microtask"));
    });
    await new Promise(resolve => stream.on("close", resolve));
    orders[name] = order.join(" ");
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify(orders, null, 2));
})();
