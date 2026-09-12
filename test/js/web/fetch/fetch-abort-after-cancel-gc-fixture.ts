// #36624 downgraded `Body.Locked.readable` from a `bun_jsc::Strong` to a raw
// JSValue once the Response wrapper's traced `m_stream` slot owns the stream.
// After reader.cancel() drops every other root and the wrapper becomes
// unreachable, an eden GC (Bun.gc(false)) reaps weak handles and sweeps
// PreciseAllocations synchronously (freeing the `Box<NewSource<_>>` via the
// source cell's destructor) but leaves the MarkedBlock Response wrapper for
// lazy sweep, so the BodyAbortListener is still registered when abort fires.
// on_abort then dereferences the freed box through that raw JSValue.
//
// Bun.gc(true) does NOT reproduce: the full synchronous sweep runs the
// wrapper's destructor first, which drops the listener.

using server = Bun.serve({
  port: 0,
  fetch: () => new Response(Buffer.alloc(20000, "x")),
});
const url = `http://127.0.0.1:${server.port}/`;

async function one(signal: AbortSignal) {
  const resp = await fetch(url, { signal });
  const rd = resp.body!.getReader();
  await rd.read();
  await rd.cancel();
  // resp + rd are garbage once this returns
}

const ITER = Number(process.env.ITER ?? 60);
for (let i = 0; i < ITER; i++) {
  const ac = new AbortController();
  await Promise.all([one(ac.signal), one(ac.signal), one(ac.signal)]);
  Bun.gc(false);
  await Bun.sleep(5);
  ac.abort();
  await Bun.sleep(5);
}
process.stdout.write(`done ${ITER}\n`);
