// The same stale bookkeeping as bytestream-partial-read-fixture.ts, reached through the stream's
// own pull loop: a reader takes one pull view out of the buffered bytes, the producer fails, and
// the reader reads on. `append(Err)` dropped the buffer and kept the index, so the next pull's
// `drain()` aborted the process:
//
//   panic: range end index 262144 out of range for slice of length 0
//
// The producer is an HTMLRewriter whose handler throws on the second chunk, so every step runs on
// this thread, in order.
const VIEW = 256 * 1024; // nativeSourceDefaultChunkSize (BunStreamSource.cpp)
const tick = () => new Promise(resolve => setImmediate(resolve));
// The rewriter emits and fails across turns while nothing reads its output.
const turns = async () => {
  for (let i = 0; i < 8; i++) await tick();
};

let input!: ReadableStreamDefaultController;
const res = new HTMLRewriter()
  .on("p", {
    element() {
      throw new Error("boom");
    },
  })
  .transform(new Response(new ReadableStream({ start: c => void (input = c) })));

// Starts the stream: its first pull waits for output.
const reader = res.body!.getReader();
// The output of this chunk fills the pull view and leaves the rest behind the consumed prefix.
input.enqueue(new TextEncoder().encode(`<b>${Buffer.alloc(400_000, "x").toString()}</b>`));
await turns();
// The handler throws, so the output stream stores the failure while no pull is pending.
input.enqueue(new TextEncoder().encode("<p>x</p>"));
await turns();

// The view the pull took is queued on the stream. The bytes behind it went with the failed
// body, so the read after it has to report the failure.
const first = await reader.read();
if (first.done || first.value.length !== VIEW) {
  console.log(`BAD first read ${first.done ? "done" : first.value.length}, want ${VIEW}`);
  process.exit(0);
}
const outcome = await reader.read().then(
  r => `read returned ${r.done ? "done" : `${r.value.length} bytes`}`,
  (e: Error) => `rejected ${e.message}`,
);
console.log(outcome.startsWith("rejected ") ? "ok" : `BAD ${outcome}`);
