// Spawned by promises.test.js with a form and a directory that holds a named pipe ("pipe").
// One read of a FileHandle waits for the pipe. While it is pending, the form closes the
// handle, drops it, or ends a writer()/pullSync() that has autoClose. Then another file is
// opened (it takes the descriptor number if that number is free) and the pipe is fed and
// ended. Prints one JSON line: what the read gave, and what happened to the descriptor.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const [form, dir] = process.argv.slice(2);
const pipe = path.join(dir, "pipe");
const other = path.join(dir, "other");
fs.writeFileSync(other, "THE CONTENT OF ANOTHER FILE");
// Read and write: this open does not wait for a peer, and it gives the read below a writer.
const feeder = fs.openSync(pipe, fs.constants.O_RDWR);

// A FileHandle that is collected while it is open closes its descriptor and reports this.
let collected = 0;
process.on("uncaughtException", err => {
  if ((err as NodeJS.ErrnoException)?.code !== "ERR_INVALID_STATE") throw err;
  collected++;
});

function isOpen(fd: number) {
  try {
    fs.fstatSync(fd);
    return true;
  } catch {
    return false;
  }
}

let number!: number;
let read: Promise<string>;
// Settles when the handle has closed its descriptor. The dropped form has no handle to ask.
let closed: Promise<void> | undefined;

if (form === "readFile-dropped") {
  const { promise: started, resolve } = Promise.withResolvers<void>();
  read = (async () => {
    const handle = await fsp.open(pipe, "r");
    number = handle.fd;
    const pending = fsp.readFile(handle, "utf8");
    resolve();
    return pending;
  })();
  await started;
  // Only the pending read can reach the handle now.
  for (let i = 0; i < 8 && isOpen(number); i++) {
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));
  }
} else {
  const handle = await fsp.open(pipe, "r");
  number = handle.fd;
  if (form === "readFile-closed") {
    read = fsp.readFile(handle, "utf8");
    closed = handle.close();
    // A close() that did not wait for the read has already set fd to -1. Let it finish.
    if (handle.fd === -1) await closed;
  } else {
    // The method holds a ref on the handle until the read settles.
    read = handle.readFile("utf8");
    // writer() and pullSync() are not in the type declarations of FileHandle yet.
    const streams = handle as any;
    if (form === "writer-endSync") streams.writer({ autoClose: true }).endSync();
    else if (form === "writer-fail") streams.writer({ autoClose: true }).fail(new Error("stop"));
    else if (form === "writer-dispose") streams.writer({ autoClose: true })[Symbol.dispose]();
    else if (form === "pullSync-return") streams.pullSync({ autoClose: true })[Symbol.iterator]().return();
    else throw new Error(`unknown form: ${form}`);
    closed = handle.close();
  }
}

const openWhilePending = isOpen(number);
// Somebody else's file takes the descriptor number if the number is free.
const otherTookTheNumber = fs.openSync(other, "r") === number;
fs.writeSync(feeder, "bytes of the pipe;");
fs.closeSync(feeder); // the pipe ends

const result = await read.then(
  value => ({ fulfilled: value }),
  err => ({ rejected: err?.code ?? String(err) }),
);
let closedAfterTheRead: boolean | undefined;
if (closed && !otherTookTheNumber) {
  await closed;
  closedAfterTheRead = !isOpen(number);
}
console.log(JSON.stringify({ ...result, openWhilePending, otherTookTheNumber, collected, closedAfterTheRead }));
process.exit(0);
