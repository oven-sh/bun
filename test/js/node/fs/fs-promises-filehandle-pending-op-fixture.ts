// Spawned by promises.test.js with a directory and a list of forms. The directory holds one
// named pipe for each form ("pipe-<form>"). Each form parks one read of a FileHandle on its
// pipe. While the read is pending, the form closes the handle, drops it, or ends a
// writer()/pullSync() that has autoClose. Then another file is opened (it takes the descriptor
// number if that number is free) and the pipe is fed and ended. Prints one JSON line: for each
// form, what the read gave and what happened to the descriptor.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const [dir, ...forms] = process.argv.slice(2);
const other = path.join(dir, "other");
fs.writeFileSync(other, "THE CONTENT OF ANOTHER FILE");

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

type ReadResult = { fulfilled: string } | { rejected: string };
// Takes the outcome when the read is created. A form waits for other things before it looks
// at the read, and a read that rejects meanwhile must not be an unhandled rejection.
function outcome(pending: Promise<string>): Promise<ReadResult> {
  return pending.then(
    value => ({ fulfilled: value }),
    err => ({ rejected: err?.code ?? String(err) }),
  );
}

async function run(form: string) {
  const pipe = path.join(dir, "pipe-" + form);
  const collectedBefore = collected;

  // A reading end that nothing reads from. It keeps a reader on the pipe for the whole form,
  // so the pipe can be fed even when the descriptor of the handle is gone. Without O_NONBLOCK
  // this open waits for a writer.
  const keepOpen = fs.openSync(pipe, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  // The writing end. The read of the handle waits for as long as this is open and has sent nothing.
  const feeder = fs.openSync(pipe, fs.constants.O_WRONLY);

  let number!: number;
  let read: Promise<ReadResult>;
  // Settles when the handle has closed its descriptor. The dropped form has no handle to ask.
  let closed: Promise<void> | undefined;

  if (form === "readFile-dropped") {
    const { promise: started, resolve } = Promise.withResolvers<void>();
    read = outcome(
      (async () => {
        const handle = await fsp.open(pipe, "r");
        number = handle.fd;
        const pending = fsp.readFile(handle, "utf8");
        resolve();
        return pending;
      })(),
    );
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
      read = outcome(fsp.readFile(handle, "utf8"));
      closed = handle.close();
      // A close() that did not wait for the read has already set fd to -1. Let it finish.
      if (handle.fd === -1) await closed;
    } else {
      // The method holds a ref on the handle until the read settles.
      read = outcome(handle.readFile("utf8"));
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
  // Another file takes the descriptor number if the number is free.
  const otherFd = fs.openSync(other, "r");
  const otherTookTheNumber = otherFd === number;
  fs.writeSync(feeder, "bytes of the pipe;");
  fs.closeSync(feeder); // the pipe ends

  const result = await read;
  let closedAfterTheRead: boolean | undefined;
  if (closed && !otherTookTheNumber) {
    await closed;
    closedAfterTheRead = !isOpen(number);
  }
  fs.closeSync(otherFd);
  fs.closeSync(keepOpen);
  return { ...result, openWhilePending, otherTookTheNumber, collected: collected - collectedBefore, closedAfterTheRead };
}

// The forms run one after the other. The dropped form leaves its handle open, so it is last.
const results: Record<string, unknown> = {};
for (const form of forms) results[form] = await run(form);
console.log(JSON.stringify(results));
process.exit(0);
