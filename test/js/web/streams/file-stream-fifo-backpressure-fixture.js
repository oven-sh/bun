// Reads one chunk from Bun.file(fifo).stream(), then leaves the reader idle
// while a non-blocking writer in this same process feeds the FIFO in 16 KB
// pieces. Reports how many bytes the pipe accepted before it stayed full, then
// drains the stream while the writer finishes and checks that every byte
// arrives in order.
import fs from "node:fs";

const fifo = process.argv[2];
const CHUNK = 16 * 1024;
const TOTAL = 2 * 1024 * 1024;

const reader = Bun.file(fifo).stream().getReader();
// Opens the FIFO (O_RDONLY | O_NONBLOCK) and arms the poll, so the write end
// below can be opened without a blocking open.
const firstRead = reader.read();
const wfd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);

// Every 32-bit word of the payload holds its own index, so the reader can
// verify order from any chunk boundary.
let generated = 0;
let written = 0;
let piece = null;
function nextPiece() {
  const buf = Buffer.allocUnsafe(CHUNK);
  const words = new Uint32Array(buf.buffer, buf.byteOffset, CHUNK / 4);
  const base = generated / 4;
  for (let i = 0; i < words.length; i++) words[i] = base + i;
  generated += CHUNK;
  return buf;
}
// One non-blocking write. false means the pipe is full (EAGAIN).
function tryWrite() {
  piece ??= nextPiece();
  let n;
  try {
    n = fs.writeSync(wfd, piece);
  } catch (e) {
    if (e.code !== "EAGAIN") throw e;
    return false;
  }
  written += n;
  piece = n < piece.length ? piece.subarray(n) : null;
  return true;
}

tryWrite();
const first = await firstRead;

// The reader is idle from here on. Keep writing until either the whole payload
// went in (nothing pushed back) or the pipe stays full across many event-loop
// turns (the reader stopped at its highwater mark).
let eagainStreak = 0;
while (written < TOTAL && eagainStreak < 100) {
  if (tryWrite()) {
    eagainStreak = 0;
  } else {
    eagainStreak++;
    await Bun.sleep(2);
  }
}
const acceptedWhileIdle = written;
const blocked = eagainStreak >= 100;

// Resume reading while the writer finishes. The reader stops by count rather
// than at EOF: macOS kqueue does not report a FIFO writer's close.
let received = 0;
let inOrder = true;
function verify(value) {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const end = received + value.byteLength;
  let pos = (received + 3) & ~3;
  for (; pos + 4 <= end; pos += 4096) {
    if (view.getUint32(pos - received, true) !== pos / 4) inOrder = false;
  }
  const last = (end & ~3) - 4;
  if (last >= received && view.getUint32(last - received, true) !== last / 4) inOrder = false;
  received = end;
}
verify(first.value);

const writing = (async () => {
  while (written < TOTAL) {
    if (!tryWrite()) await Bun.sleep(1);
  }
  fs.closeSync(wfd);
})();
while (received < TOTAL) {
  const { value, done } = await reader.read();
  if (done) break;
  verify(value);
}
await writing;
await reader.cancel();

console.log(JSON.stringify({ first: first.value.length, acceptedWhileIdle, blocked, received, total: TOTAL, inOrder }));
