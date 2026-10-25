// A consumer starts a native body stream and takes one pull view out of it, then hands the
// stream to node:stream, which drives the native source directly. The source used to report the
// bytes a reader had already taken as still buffered, so `drain()` read them out of a buffer that
// was no longer there and the process aborted:
//
//   panic: range end index 262144 out of range for slice of length 0
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

// The native source still holds the end of the body. Whatever it hands over has to be that
// tail: never a byte a reader already took, and never nothing at all.
if (got.length > 0 && got.equals(payload.subarray(SIZE - got.length))) {
  console.log("ok");
} else {
  console.log(`BAD ${got.length} of ${SIZE} bytes, not the tail`);
}
