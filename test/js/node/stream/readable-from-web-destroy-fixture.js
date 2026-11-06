// What a Readable.fromWeb() stream does when destroy() runs, one block per case. The test runs this file in Bun and in
// Node.js, and both must print the same text. It prints only what the releases of Node.js agree on: from v26.9.0 on
// Node.js pushes the EOF inside destroy(), which moves 'end' of a paused stream and 'finish' of a pipe() destination.
"use strict";
const { Readable, Writable, finished, pipeline } = require("node:stream");

const turn = () => new Promise(resolve => setImmediate(resolve));
const nameOf = value => (value == null ? String(value) : value.code || value.message);
const settled = promise =>
  promise.then(
    value => `resolves ${JSON.stringify(value)}`,
    error => `rejects ${nameOf(error)}`,
  );

// Where destroy() is called from.
const contexts = {
  "promise job": act => turn().then(act),
  "nextTick": act => new Promise(resolve => setImmediate(() => process.nextTick(() => resolve(act())))),
  "setImmediate": act => new Promise(resolve => setImmediate(() => resolve(act()))),
};

// A source that hands out `chunks` chunks, one per pull(), and then leaves every read waiting.
// `ctx.waits(n)` resolves once pull() ran n times, that is, once the n-th read of the Readable is in flight.
function source(type, ctx, chunks, chunk = new Uint8Array(3)) {
  let pulls = 0;
  const waiters = [];
  ctx.waits = n => new Promise(resolve => (pulls >= n ? resolve() : waiters.push([n, resolve])));
  return new ReadableStream(
    {
      type,
      start(controller) {
        ctx.controller = controller;
      },
      pull(controller) {
        if (pulls++ < chunks) controller.enqueue(chunk);
        for (const [n, resolve] of waiters) if (pulls >= n) resolve();
      },
      cancel(reason) {
        ctx.cancelled.push(nameOf(reason));
      },
    },
    { highWaterMark: 0 },
  );
}
const idle = (type, ctx) => source(type, ctx, 0);
const oneChunk = (type, ctx) => source(type, ctx, 1);
// The first byte of a character of two bytes, which the decoder of the Readable holds back.
const halfCharacter = (type, ctx) => source(type, ctx, 1, new Uint8Array([0xc3]));
// The chunk is in the queue of the web stream before the first read.
const queued = (type, ctx) =>
  new ReadableStream({
    type,
    start(controller) {
      controller.enqueue(new Uint8Array(3));
    },
    cancel(reason) {
      ctx.cancelled.push(nameOf(reason));
    },
  });
// destroy() runs inside reader.read(), before the Readable has the promise of that read.
const pullDestroys = (type, ctx) =>
  new ReadableStream(
    {
      type,
      pull() {
        ctx.r.destroy();
      },
      cancel(reason) {
        ctx.cancelled.push(nameOf(reason));
      },
    },
    { highWaterMark: 0 },
  );
const transformed = () => new TransformStream().readable;
// cancel() of one branch settles only when the other branch is cancelled too, so 'close' never comes.
const teeBranch = (type, ctx) => idle(type, ctx).tee()[0];

const lengthsOf = async r => {
  const lengths = [];
  for await (const chunk of r) lengths.push(chunk.length);
  return lengths;
};
const sink = ctx => (ctx.dest = new Writable({ write: (chunk, encoding, callback) => callback() }));
// Only a flowing stream reports 'end': a paused one emits it or not, by the release of Node.js.
const flow = (r, ctx) => {
  r.on("data", chunk => ctx.log.push(`data:${chunk.length}`));
  r.on("end", () => ctx.log.push("end"));
};

// What the consumer does before destroy() is called.
const readWaits = async (r, ctx) => {
  r.read();
  await ctx.waits(1);
};
const forAwaitWaits = async (r, ctx) => {
  ctx.iteration = settled(lengthsOf(r));
  await ctx.waits(1);
};
const forAwaitTookAChunk = async (r, ctx) => {
  ctx.iteration = settled(lengthsOf(r));
  await ctx.waits(2);
  await turn();
};
const toArrayWaits = async (r, ctx) => {
  ctx.iteration = settled(r.toArray());
  await ctx.waits(1);
};
const dataListenerWaits = async (r, ctx) => {
  flow(r, ctx);
  await ctx.waits(1);
};
const dataListenerTookAChunk = async (r, ctx) => {
  flow(r, ctx);
  await ctx.waits(2);
};
const pipeWaits = async (r, ctx) => {
  r.on("end", () => ctx.log.push("end"));
  r.pipe(sink(ctx));
  await ctx.waits(1);
};
const pipelineWaits = async (r, ctx) => {
  r.on("end", () => ctx.log.push("end"));
  pipeline(r, sink(ctx), error => (ctx.pipeline = error ? nameOf(error) : "ok"));
  await ctx.waits(1);
};
const chunkIsBuffered = async (r, ctx) => {
  r.read(0);
  await ctx.waits(2);
};
const closes = r => new Promise(resolve => r.once("close", () => resolve()));

// [title, source, what the consumer does first, the call under test, options of fromWeb()]
const cases = [
  // A read of the web stream waits. reader.cancel() closes it, and that ends the Readable.
  [
    "read() waits, destroy()",
    idle,
    readWaits,
    (r, ctx) => (r.destroy(), closes(r).then(() => `locked=${ctx.stream.locked}`)),
  ],
  ["for await waits, destroy()", idle, forAwaitWaits, (r, ctx) => (r.destroy(), ctx.iteration)],
  [
    "for await took a chunk and waits, destroy()",
    oneChunk,
    forAwaitTookAChunk,
    (r, ctx) => (r.destroy(), ctx.iteration),
  ],
  [
    "for await and destroy() in one tick",
    idle,
    null,
    r => {
      const iteration = settled(lengthsOf(r));
      r.destroy();
      return iteration;
    },
  ],
  ["toArray() waits, destroy()", idle, toArrayWaits, (r, ctx) => (r.destroy(), ctx.iteration)],
  ["'data' listener, a read waits, destroy()", idle, dataListenerWaits, r => void r.destroy()],
  ["'data' listener took a chunk, a read waits, destroy()", oneChunk, dataListenerTookAChunk, r => void r.destroy()],
  [
    "'data' listener, encoding utf8, half a character is held, a read waits, destroy()",
    halfCharacter,
    dataListenerTookAChunk,
    r => void r.destroy(),
    { encoding: "utf8" },
  ],
  ["pipe(dest), a read waits, destroy()", idle, pipeWaits, r => void r.destroy()],
  ["pipeline(r, dest), a read waits, destroy()", idle, pipelineWaits, r => void r.destroy()],
  ["read() waits, destroy(error)", idle, readWaits, r => void r.destroy(new Error("boom"))],
  ["for await waits, destroy(error)", idle, forAwaitWaits, (r, ctx) => (r.destroy(new Error("boom")), ctx.iteration)],
  [
    "read() waits, the source closes, destroy()",
    idle,
    readWaits,
    (r, ctx) => (ctx.controller.close(), void r.destroy()),
  ],
  ["TransformStream: read() waits, destroy()", transformed, r => void r.read(), r => void r.destroy()],
  ["tee() branch: 'data' listener, a read waits, destroy()", teeBranch, dataListenerWaits, r => void r.destroy()],
  ["'data' listener, pull() of the source calls destroy()", pullDestroys, null, (r, ctx) => (flow(r, ctx), closes(r))],
  // The stream ends, but a chunk of it was never read.
  [
    "a chunk is buffered, the next read waits, destroy()",
    oneChunk,
    chunkIsBuffered,
    r => (r.destroy(), `buffered=${r.readableLength}`),
  ],
  // No read waits. The premature close stays.
  ["destroy() before the first read", idle, null, r => void r.destroy()],
  ["resume() and destroy() in one tick", idle, null, r => (r.resume(), void r.destroy())],
  [
    "destroy() in a 'data' listener",
    oneChunk,
    null,
    (r, ctx) => {
      flow(r, ctx);
      r.on("data", () => r.destroy());
      return closes(r);
    },
  ],
  ["a chunk is queued, read() and destroy() in one tick", queued, null, r => (r.read(), void r.destroy())],
  [
    "read() waits, the source has a chunk, destroy()",
    idle,
    readWaits,
    (r, ctx) => (ctx.controller.enqueue(new Uint8Array(3)), void r.destroy()),
  ],
];

async function run(context, type, [, makeSource, before, act, options]) {
  const ctx = { log: [], cancelled: [], finished: "never" };
  ctx.stream = makeSource(type, ctx);
  const r = (ctx.r = Readable.fromWeb(ctx.stream, options));
  r.on("close", () => ctx.log.push("close"));
  r.on("error", error => ctx.log.push(`error:${nameOf(error)}`));
  finished(r, error => (ctx.finished = error ? nameOf(error) : "ok"));
  if (before) await before(r, ctx);
  const result = await contexts[context](() => act(r, ctx));
  for (let i = 0; i < 3; i++) await turn();
  // What holds once everything has settled. When these happen is left out, see the top of the file.
  const state = [`finished=${ctx.finished}`, `source.cancel(${ctx.cancelled})`, `ended=${r._readableState.ended}`];
  if (ctx.dest) state.push(`dest.finished=${ctx.dest.writableFinished}`);
  if ("pipeline" in ctx) state.push(`pipeline=${ctx.pipeline}`);
  return [result, ctx.log.join(" "), state.join(" ")].filter(Boolean).join(" | ");
}

(async () => {
  // Each case runs from each context, over a default source and over a bytes source. One line per outcome.
  for (const testCase of cases) {
    const outcomes = new Map();
    const add = (outcome, where) => outcomes.set(outcome, [...(outcomes.get(outcome) ?? []), where]);
    for (const context of Object.keys(contexts)) {
      const outcome = await run(context, undefined, testCase);
      const overBytes = await run(context, "bytes", testCase);
      add(outcome, context);
      if (overBytes !== outcome) add(overBytes, `${context} over a bytes source`);
    }
    console.log(testCase[0]);
    for (const [outcome, where] of outcomes) {
      console.log(`  ${outcomes.size === 1 ? "always" : where.join(", ")}: ${outcome}`);
    }
  }
})();
