// Self-verifying node:stream + Web-stream pipelines under backpressure. A
// fast producer feeds slow/transforming consumers through pipes with small
// highWaterMarks so the runtime's queuing, drain and cork paths all engage.
// Every payload is a numbered sequence with a running hash: the sink checks
// order, count and hash. A chunk dropped, duplicated, reordered or torn by
// the stream machinery (e.g. under a partial write or a paused drain) is a
// WSF-CORRUPTION - a silent wrong answer, never a crash.
import { PassThrough, Readable, Transform, Writable, pipeline } from "node:stream";
import { promisify } from "node:util";
const pipe = promisify(pipeline);
console.log("STAGE: setup");
let corrupt = 0;
const fail = msg => {
  corrupt++;
  console.log(`WSF-CORRUPTION: ${msg}`);
};

// Chunk N is 8 bytes of "N" as u32 + running total; verifiers re-derive it.
const CHUNKS = 4000;
function* gen() {
  let total = 0;
  for (let i = 0; i < CHUNKS; i++) {
    total = (total + i) >>> 0;
    const b = Buffer.allocUnsafe(8);
    b.writeUInt32LE(i, 0);
    b.writeUInt32LE(total, 4);
    yield b;
  }
}
// A verifying sink: reassembles the byte stream (chunks may be re-cut by
// the pipeline!) into 8-byte records and checks sequence + total.
const makeVerifier = label => {
  let pending = Buffer.alloc(0);
  let next = 0;
  let total = 0;
  return {
    write(chunk) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 8) {
        const i = pending.readUInt32LE(0);
        const t = pending.readUInt32LE(4);
        total = (total + i) >>> 0;
        if (i !== next || t !== total) {
          fail(`${label}: record ${next} bad (got seq ${i}, total ${t}, want total ${total})`);
          next = i + 1; // resync so one break isn't reported 4000 times
        } else next++;
        pending = pending.subarray(8);
      }
    },
    done() {
      if (pending.length) fail(`${label}: torn tail (${pending.length} bytes)`);
      if (next !== CHUNKS) fail(`${label}: got ${next} records, want ${CHUNKS}`);
    },
  };
};

// --- 1. Readable -> Transform -> slow Writable, tiny highWaterMarks -------
console.log("STAGE: pipeline-slow-sink");
{
  const v = makeVerifier("slow-sink");
  let n = 0;
  await pipe(
    Readable.from(gen(), { highWaterMark: 512, objectMode: false }),
    new Transform({
      highWaterMark: 256,
      transform(c, _e, cb) {
        cb(null, c); // pass through, but at a lower watermark
      },
    }),
    new Writable({
      highWaterMark: 128,
      write(c, _e, cb) {
        v.write(c);
        // every 50th write yields, forcing the producer to buffer/drain
        if (++n % 50 === 0) setImmediate(cb);
        else cb();
      },
    }),
  );
  v.done();
}

// --- 2. cork/uncork bursts through a PassThrough --------------------------
console.log("STAGE: cork-uncork");
{
  const v = makeVerifier("cork");
  const pt = new PassThrough({ highWaterMark: 1024 });
  const sink = new Writable({
    highWaterMark: 64,
    write(c, _e, cb) {
      v.write(c);
      cb();
    },
  });
  const done = new Promise((res, rej) => {
    sink.on("finish", res);
    sink.on("error", rej);
    pt.on("error", rej);
  });
  pt.pipe(sink);
  let i = 0;
  for (const chunk of gen()) {
    if (i % 200 === 0) pt.cork();
    pt.write(chunk);
    if (i % 200 === 199) process.nextTick(() => pt.uncork());
    i++;
  }
  pt.uncork();
  pt.end();
  await done;
  v.done();
}

// --- 3. Web streams: ReadableStream -> TransformStream -> reader loop ---
console.log("STAGE: web-streams");
{
  const v = makeVerifier("web");
  const it = gen();
  const rs = new ReadableStream(
    {
      pull(ctrl) {
        const { value, done } = it.next();
        if (done) ctrl.close();
        else ctrl.enqueue(new Uint8Array(value));
      },
    },
    { highWaterMark: 8 },
  );
  const ts = new TransformStream({
    transform(chunk, ctrl) {
      // re-cut every chunk into 3-byte slivers to stress reassembly
      for (let o = 0; o < chunk.length; o += 3) ctrl.enqueue(chunk.subarray(o, o + 3));
    },
  });
  const reader = rs.pipeThrough(ts).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    v.write(Buffer.from(value));
  }
  v.done();
}

// --- 4. round-trip through Bun.spawn stdin -> child cat -> stdout ---------
console.log("STAGE: spawn-roundtrip");
{
  const v = makeVerifier("spawn");
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = (async () => {
    for await (const c of child.stdout) v.write(Buffer.from(c));
  })();
  for (const chunk of gen()) child.stdin.write(chunk);
  await child.stdin.end();
  await reader;
  await child.exited;
  v.done();
}

console.log(`stream-backpressure ok chunks=${CHUNKS} corrupt=${corrupt}`);
