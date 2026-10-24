// A consumer starts a native body stream, so one pull view of the body sits in the stream's queue
// and the rest stays in the native source, behind the count of bytes already taken. Then it hands
// the stream to node:stream. node:stream used to drive the native source itself from there, and
// the source reported the taken bytes as still buffered, so `drain()` read them out of a buffer
// that was no longer there and the process aborted:
//
//   panic: range end index 262144 out of range for slice of length 0
//
// After that fix node:stream got the tail alone: the view in the queue never reached it. It now
// reads a started stream through a reader.
//
// The producer is an HTMLRewriter because it emits the output of one input chunk in one piece, so
// the split between the pull view and the bytes left behind is the same on every run.
import { Readable } from "node:stream";

const SIZE = 400_000;
const tick = () => new Promise(resolve => setImmediate(resolve));
// The rewriter emits and ends across turns while nothing reads its output.
const turns = async () => {
  for (let i = 0; i < 8; i++) await tick();
};

// A pattern whose period (a prime) does not divide the pull view, so bytes handed over from
// the wrong offset cannot pass the tail check below.
const period = Buffer.alloc(4093);
for (let i = 0; i < period.length; i++) period[i] = 97 + (i % 26);
const payload = Buffer.alloc(SIZE, period);

let input!: ReadableStreamDefaultController;
const res = new HTMLRewriter()
  .on("nothing", { element() {} })
  .transform(new Response(new ReadableStream({ start: c => void (input = c) })));

res.body!.getReader().releaseLock(); // starts the stream, reads nothing
input.enqueue(payload);
await turns();
input.close();
await turns();

const chunks: Buffer[] = [];
for await (const chunk of Readable.fromWeb(res.body!)) chunks.push(Buffer.from(chunk));
const got = Buffer.concat(chunks);

// The view in the queue comes first, then the tail the native source still holds, from the right
// offset.
console.log(got.equals(payload) ? "ok" : `BAD ${got.length} of ${SIZE} bytes, or not in order`);
