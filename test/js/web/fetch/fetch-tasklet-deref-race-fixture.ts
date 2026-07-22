// Stress test for the FetchTasklet HTTP-thread deref ordering race.
//
// The HTTP thread's result callback used to release the tasklet mutex before
// calling deref_from_thread. In the gap, the JS thread could run
// on_progress_update (which needs the mutex) and drop the JS-side ref first,
// so the HTTP-side deref became the 1->0 transition and enqueued a
// deinit_callback task. By the time that task ran the refcount could be
// nonzero (or the memory reused), tripping the assert_no_refs panic.
//
// The window is a handful of instructions, so this fixture runs many
// iterations under contention to give it a chance to fire.

const iterations = Number(process.env.ITERATIONS ?? "2000");
const concurrency = Number(process.env.CONCURRENCY ?? "64");

using server = Bun.serve({
  port: 0,
  fetch() {
    return new Response("x");
  },
});

const url = server.url.href;

let completed = 0;

async function one(shouldAbort: boolean) {
  // A mix of straight fetches and aborted fetches: the abort path feeds
  // schedule_shutdown to the HTTP thread which is where the final callback
  // with has_more=false (the is_done deref) originates, and the completion
  // path exercises the normal enqueue-then-deref order.
  const controller = new AbortController();
  if (shouldAbort) queueMicrotask(() => controller.abort());
  try {
    const res = await fetch(url, { signal: controller.signal });
    await res.arrayBuffer();
    if (!shouldAbort) completed++;
  } catch (error) {
    if (!shouldAbort) throw error;
  }
}

let done = 0;
async function worker() {
  while (true) {
    const i = done++;
    if (i >= iterations) break;
    await one((i & 1) === 0);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

if (completed === 0) {
  throw new Error("fixture never completed a non-aborted fetch");
}

// Force a collection so any queued deinit_callback tasks have a chance to
// run against memory that has been recycled.
Bun.gc(true);
await Bun.sleep(0);
Bun.gc(true);

console.log("ok");
