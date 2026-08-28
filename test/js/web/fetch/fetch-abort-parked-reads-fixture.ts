// Regression fixture: aborting an in-flight fetch whose streaming response
// body has a parked consumer (reader.read() or a native body.text() buffering
// action) delivers Err to ByteStream::on_data. on_data used to call
// signal_drained() while buffer_action was still in its cell; signal_drained
// dispatches to the producer, which can re-enter on_data/on_cancel and consume
// the action, so the later buffer_action.replace(None).unwrap() panicked and
// aborted the process. The re-entrant timing is not deterministically
// reachable from JS, so this fixture stress-drives the abort paths and
// asserts every parked consumer settles with the process alive.

const ITERATIONS = 12;

const chunk = new TextEncoder().encode("data: " + Buffer.alloc(512, "x").toString() + "\n\n");

using server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch() {
    // One event, then hold the connection open silently so client-side
    // consumers are still parked when the aborts land.
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(chunk);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  },
});

async function setup(i: number): Promise<{ parked: Promise<unknown>; abort: () => void }> {
  const ac = new AbortController();
  const res = await fetch(server.url, { signal: ac.signal });

  let parked: Promise<unknown>;
  switch (i % 3) {
    case 0: {
      const reader = res.body!.getReader();
      await reader.read();
      parked = reader.read();
      break;
    }
    case 1: {
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      await reader.read();
      parked = reader.read();
      break;
    }
    default: {
      // Native buffering fast path: installs a BufferAction on the ByteStream.
      parked = res.body!.text();
      break;
    }
  }

  if (i % 4 >= 2) {
    // Abort from inside another signal's abort listener so the fetch abort
    // re-enters from event dispatch.
    const outer = new AbortController();
    outer.signal.addEventListener("abort", () => ac.abort());
    return { parked, abort: () => outer.abort() };
  }
  return { parked, abort: () => ac.abort() };
}

const streams = await Promise.all(Array.from({ length: ITERATIONS }, (_, i) => setup(i)));

for (const { abort } of streams) abort();

// Every parked consumer must settle (reject with the abort reason, or resolve
// if its chunk raced in first); a hang here fails the test by timeout.
const results = await Promise.allSettled(streams.map(s => s.parked));

// Let scheduled producer callbacks (receive resumes, trailing socket data)
// land before exiting so a delayed crash still fails the fixture.
await Bun.sleep(0);
await Bun.sleep(0);
Bun.gc(true);

console.log(`done ${results.length}`);
