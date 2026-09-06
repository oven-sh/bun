// Bun.write() into a FIFO that only this process drains. The synchronous fast
// path fills the pipe buffer, gets EAGAIN, and must hand the rest to the async
// path without blocking the thread: the reader below is the only thing that
// can make the fd writable again, and it runs on this event loop.
import { closeSync, constants, openSync } from "node:fs";
import { mkfifo } from "../../../mkfifo";

const path = process.argv.at(-1);
mkfifo(path, 0o666);
const rfd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
const wfd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);

// Below the 256 KiB fast-path cutoff, above any FIFO buffer size.
const big = Buffer.alloc(200 * 1024, 65);
const wrote = Bun.write(Bun.file(wfd), big);

let got = 0;
const drained = (async () => {
  for await (const chunk of Bun.file(path).stream()) got += chunk.byteLength;
})();

const n = await wrote;
// No writers left: the reader sees EOF once the FIFO is empty.
closeSync(wfd);
closeSync(rfd);
await drained;

console.log(JSON.stringify({ n, got }));
