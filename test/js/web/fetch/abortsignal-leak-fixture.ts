import { rss, tls } from "harness";

/**
 * Each case drives `rounds` batches of `batchSize` concurrent requests at its
 * own Bun.serve() instance. Every handler reads `req.signal`, adds an 'abort'
 * listener, and parks until the round's gate opens. The case keeps a WeakRef
 * to every server `req.signal` and every client `AbortController#signal` it
 * creates, so the leak check counts exactly the signals this case made and is
 * unaffected by whatever else lives in the heap.
 *
 *  - "abort-racing-response": the gate opens as soon as the whole batch has
 *    arrived and the client aborts every request in the same tick, so each
 *    request ends by whichever of the two the server sees first.
 *  - "abort-before-response" (https://github.com/oven-sh/bun/issues/4517): the
 *    client aborts once the batch has arrived; the gate opens only after the
 *    server has seen an 'abort' event for every request in the batch.
 *  - "response-only": nothing aborts; the gate opens once the batch has
 *    arrived, every request gets a 200, and the 'abort' listener never fires.
 */
export type AbortSignalLeakMode = "abort-racing-response" | "abort-before-response" | "response-only";

export type AbortSignalLeakResult = {
  requests: number;
  /** How each client fetch() settled: a status code, or the rejection's `name`. */
  outcomes: Record<string, number>;
  /** 'abort' events seen by the server-side listeners, summed over all rounds. */
  abortEvents: number;
  serverSignals: { tracked: number; alive: number };
  clientSignals: { tracked: number; alive: number };
};

type Round = {
  arrived: number;
  aborted: number;
  allArrived: PromiseWithResolvers<void>;
  allAborted: PromiseWithResolvers<void>;
  gate: PromiseWithResolvers<void>;
};

function createRound(): Round {
  return {
    arrived: 0,
    aborted: 0,
    allArrived: Promise.withResolvers(),
    allAborted: Promise.withResolvers(),
    gate: Promise.withResolvers(),
  };
}

/**
 * Full GC, then count the refs in each group that still point at a live
 * object. One collection is enough in practice; the extra event-loop turns
 * only give a straggler a chance to drop out before the caller's bound applies.
 */
async function countAlive(...groups: WeakRef<object>[][]): Promise<number[]> {
  let alive = groups.map(group => group.length);
  for (let attempt = 0; attempt < 5; attempt++) {
    Bun.gc(true);
    alive = groups.map(group => group.reduce((n, ref) => (ref.deref() === undefined ? n : n + 1), 0));
    if (alive.every(n => n === 0)) break;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return alive;
}

export async function runAbortSignalLeakCase({
  http2,
  mode,
  rounds,
  batchSize,
}: {
  http2: boolean;
  mode: AbortSignalLeakMode;
  rounds: number;
  batchSize: number;
}): Promise<AbortSignalLeakResult> {
  const serverSignals: WeakRef<AbortSignal>[] = [];
  const clientSignals: WeakRef<AbortSignal>[] = [];
  const outcomes: Record<string, number> = {};
  let abortEvents = 0;
  let round = createRound();

  using server = Bun.serve({
    port: 0,
    ...(http2 ? { tls, http2: true } : {}),
    // Long enough that a parked request is never ended by the idle timeout:
    // the test runner's own timeout fires first if a round never completes.
    idleTimeout: 254,
    async fetch(req) {
      const current = round;
      const signal = req.signal;
      serverSignals.push(new WeakRef(signal));
      signal.addEventListener("abort", () => {
        abortEvents++;
        if (++current.aborted === batchSize) current.allAborted.resolve();
      });
      if (++current.arrived === batchSize) current.allArrived.resolve();
      await current.gate.promise;
      return new Response();
    },
  });

  const url = server.url.href;
  const fetchOptions = http2 ? ({ protocol: "http2", tls: { rejectUnauthorized: false } } as const) : {};
  const settle = (response: Promise<Response>) =>
    response.then(
      async res => `${res.status} body=${JSON.stringify(await res.text())}`,
      err => `${err?.name}`,
    );

  // One round per call, so nothing from a finished round stays reachable
  // through this function's frame while the next one runs.
  async function runRound(): Promise<string[]> {
    round = createRound();
    let responses: Promise<string>[];
    if (mode === "response-only") {
      responses = Array.from({ length: batchSize }, () => settle(fetch(url, fetchOptions)));
      await round.allArrived.promise;
      round.gate.resolve();
    } else {
      const controllers = Array.from({ length: batchSize }, () => new AbortController());
      for (const controller of controllers) clientSignals.push(new WeakRef(controller.signal));
      responses = controllers.map(({ signal }) => settle(fetch(url, { ...fetchOptions, signal })));
      await round.allArrived.promise;
      for (const controller of controllers) controller.abort();
      if (mode === "abort-before-response") await round.allAborted.promise;
      round.gate.resolve();
    }
    // A collection while the batch is still in flight on both ends.
    Bun.gc();
    return await Promise.all(responses);
  }

  for (let i = 0; i < rounds; i++) {
    for (const outcome of await runRound()) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  // Resolves once every request has finished and every connection is closed,
  // so nothing the server still works on can hold a signal past this point.
  await server.stop();

  const [serverAlive, clientAlive] = await countAlive(serverSignals, clientSignals);
  return {
    requests: rounds * batchSize,
    outcomes,
    abortEvents,
    serverSignals: { tracked: serverSignals.length, alive: serverAlive },
    clientSignals: { tracked: clientSignals.length, alive: clientAlive },
  };
}

if (import.meta.main) {
  const http2 = process.argv.includes("--http2");
  for (const mode of ["abort-racing-response", "abort-before-response", "response-only"] as const) {
    const rssBefore = rss();
    const started = performance.now();
    const result = await runAbortSignalLeakCase({ http2, mode, rounds: 50, batchSize: 50 });
    const elapsed = performance.now() - started;
    const rssDelta = ((rss() - rssBefore) / 1024 / 1024) | 0;
    console.log(JSON.stringify({ http2, mode, ms: Math.round(elapsed), rssDeltaMB: rssDelta, ...result }));
  }
}
