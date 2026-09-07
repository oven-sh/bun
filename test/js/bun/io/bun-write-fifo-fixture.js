// Bun.write() into a FIFO that only this process drains. The synchronous fast
// path fills the pipe buffer, gets EAGAIN, and must hand the rest to the async
// path without blocking the thread: the reader below is the only thing that
// can make the fd writable again, and it runs on this event loop.
//
// The payload is a byte counter modulo a prime. If the async path re-sent the
// prefix the fast path already wrote, the sequence breaks where the prefix
// restarts, and a power-of-two pipe buffer cannot line up with the period.
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { mkfifo } from "../../../mkfifo";

// Progress markers on stderr. If the process hangs, the parent sees how far it got.
const mark = s => writeSync(2, s + "\n");

const path = process.argv.at(-2);
const size = Number(process.argv.at(-1));
mkfifo(path, 0o666);
const rfd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
const wfd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
mark(`opened rfd=${rfd} wfd=${wfd}`);

const big = Buffer.alloc(size);
for (let i = 0; i < size; i++) big[i] = i % 251;
const wrote = Bun.write(Bun.file(wfd), big);
mark("write returned");

let got = 0;
let firstBadByte = -1;
for await (const chunk of Bun.file(path).stream()) {
  for (let i = 0; i < chunk.length && firstBadByte < 0; i++) {
    if (chunk[i] !== (got + i) % 251) firstBadByte = got + i;
  }
  got += chunk.length;
  if (got >= size || firstBadByte >= 0) break;
}
mark(`read ${got} firstBadByte=${firstBadByte}`);

const n = await wrote;
mark(`resolved ${n}`);
closeSync(wfd);
closeSync(rfd);

console.log(JSON.stringify({ n, got, firstBadByte }));
