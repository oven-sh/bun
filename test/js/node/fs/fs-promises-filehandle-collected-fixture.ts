// Spawned by promises.test.js with a directory that holds "x.txt" and "script.mjs". Each part
// asks for the close of a FileHandle while an operation that never ends holds the handle, and
// then lets the collector take the handle. No part leaves a task with the thread pool: such a
// task keeps its handle alive until it ends. The first part is the opposite: its close has run.
// Prints one JSON line: for each part, whether the descriptor was open at each point.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2];
const file = path.join(dir, "x.txt");

// A FileHandle that is collected while it is open, with no close asked of it, is reported.
let reported = 0;
process.on("uncaughtException", err => {
  if ((err as NodeJS.ErrnoException)?.code !== "ERR_INVALID_STATE") throw err;
  reported++;
});

function isOpen(fd: number) {
  try {
    fs.fstatSync(fd);
    return true;
  } catch {
    return false;
  }
}

// Runs the collector until the descriptor is closed, and `rounds` times at most. The collector
// runs from a macrotask. Under the continuation of an `await`, the frame of the microtask loop
// of the engine is on the stack, and a dead slot of it can still hold the last async call that a
// native task resumed: here fsPromises.open(), and with it the handle that it returned.
async function openAfterCollection(fd: number, rounds: number) {
  for (let i = 0; i < rounds && isOpen(fd); i++) {
    await new Promise<void>(resolve => {
      setImmediate(() => {
        Bun.gc(true);
        resolve();
      });
    });
    // the finalizer of a collected handle runs in a task of its own
    await new Promise(resolve => setImmediate(resolve));
  }
  return isOpen(fd);
}

// The close waited for a read and then ran. The collection of the handle has nothing left to close.
async function closeThatRan() {
  let number!: number;
  await (async () => {
    const handle = await fsp.open(file, "r");
    number = handle.fd;
    const read = handle.read(Buffer.alloc(1), 0, 1, 0);
    const closed = handle.close();
    await read;
    await closed;
  })();
  // Opens until an open takes the number that the handle had, and 64 times at most.
  const opened: number[] = [];
  while (opened.at(-1) !== number && opened.length < 64) opened.push(fs.openSync(file, "r"));
  const result = {
    numberTakenAgain: opened.at(-1) === number,
    openAfterCollection: await openAfterCollection(number, 3),
  };
  for (const fd of opened) if (isOpen(fd)) fs.closeSync(fd);
  return result;
}

// A started iterator of pullSync() keeps its ref until it ends. This one is abandoned.
async function abandonedIterator(askForTheClose: (handle: any, source: Iterable<Uint8Array[]>) => void) {
  let number!: number;
  await (async () => {
    // pullSync() is not in the type declarations of FileHandle yet.
    const handle = (await fsp.open(file, "r")) as any;
    number = handle.fd;
    const source = handle.pullSync({ autoClose: true });
    source[Symbol.iterator]().next();
    askForTheClose(handle, source);
  })();
  return { openAfterTheRequest: isOpen(number), openAfterCollection: await openAfterCollection(number, 12) };
}

// The handle belongs to a Bun.ModuleGraph that is disposed while a writeFile() of the handle waits for its source.
async function disposedGraph(how: "function" | "method") {
  const graph = new (Bun as any).ModuleGraph();
  const script = await graph.import(path.join(dir, "script.mjs"));
  // script.mjs starts the writeFile(), asks for the close, and returns the descriptor number
  const number: number = await graph.run(() => script.start(file, how));
  graph.dispose();
  return { openAfterTheRequest: isOpen(number), openAfterCollection: await openAfterCollection(number, 12) };
}

const results = {
  closeThatRan: await closeThatRan(),
  // the second iterator reads to the end, and its autoClose close waits for the first one
  autoCloseBehindAnIterator: await abandonedIterator((_handle, source) => {
    for (const _chunks of source);
  }),
  closeBehindAnIterator: await abandonedIterator(handle => void handle.close()),
  closeBehindWriteFileOfADisposedGraph: await disposedGraph("function"),
  closeBehindAMethodOfADisposedGraph: await disposedGraph("method"),
};
console.log(JSON.stringify({ ...results, reported }));
