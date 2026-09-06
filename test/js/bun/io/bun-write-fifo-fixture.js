// Bun.write() into a FIFO that only this process drains. The synchronous fast
// path fills the pipe buffer, gets EAGAIN, and must hand the rest to the async
// path without blocking the thread: the reader below is the only thing that
// can make the fd writable again, and it runs on this event loop.
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { mkfifo } from "../../../mkfifo";

// Progress markers on stderr. If the process hangs, the parent sees how far it got.
const mark = s => writeSync(2, s + "\n");

const path = process.argv.at(-1);
mkfifo(path, 0o666);
const rfd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
const wfd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
mark(`opened rfd=${rfd} wfd=${wfd}`);

// Below the 256 KiB fast-path cutoff, above any FIFO buffer size.
const big = Buffer.alloc(200 * 1024, 65);
const wrote = Bun.write(Bun.file(wfd), big);
mark("write returned");

let got = 0;
const drained = (async () => {
  for await (const chunk of Bun.file(path).stream()) {
    got += chunk.byteLength;
    mark(`read ${got}`);
  }
  mark("eof");
})();

const n = await wrote;
mark(`resolved ${n}`);
// No writers left: the reader sees EOF once the FIFO is empty.
closeSync(wfd);
closeSync(rfd);
mark("closed");
await drained;

console.log(JSON.stringify({ n, got }));
