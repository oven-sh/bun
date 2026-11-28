import { rss, tls } from "harness";

/**
 * Each case sends `rounds` batches of `batchSize` concurrent requests to its own Bun.serve().
 * Every handler reads `req.signal`, adds an 'abort' listener, and waits for the round's gate.
 * The case keeps a WeakRef to every server `req.signal` and every client signal it creates, so
 * the leak check only counts its own signals.
 *
 *  - "abort-racing-response": once the batch has arrived, the client aborts every request and
 *    the gate opens in the same tick.
 *  - "abort-before-response" (https://github.com/oven-sh/bun/issues/4517): the client aborts once
 *    the batch has arrived, and the gate opens after the server saw every 'abort' event.
 *  - "response-only": the gate opens once the batch has arrived, every request gets a 200, and
 *    the 'abort' listener never fires.
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
  settled: number;
  allArrived: PromiseWithResolvers<void>;
  allAborted: PromiseWithResolvers<void>;
  gate: PromiseWithResolvers<void>;
};

function createRound(): Round {
  return {
    arrived: 0,
    aborted: 0,
    settled: 0,
    allArrived: Promise.withResolvers(),
    allAborted: Promise.withResolvers(),
    gate: Promise.withResolvers(),
  };
}

/** Only a hang reaches this. It fails the round with its counts instead of a bare test timeout. */
const DEADLINE_MS = 60_000;

async function withDeadline<T>(work: Promise<T>, state: () => string): Promise<T> {
  const { promise: expired, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(() => reject(new Error(`no progress in ${DEADLINE_MS} ms: ${state()}`)), DEADLINE_MS);
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

function countAlive(refs: WeakRef<object>[]): number {
  return refs.filter(ref => ref.deref() !== undefined).length;
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
    // Long enough that the idle timeout never ends a waiting request.
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
  const settle = (response: Promise<Response>) => {
    const current = round;
    return response.then(
      async res => {
        current.settled++;
        return `${res.status} body=${JSON.stringify(await res.text())}`;
      },
      err => {
        current.settled++;
        return `${err?.name}`;
      },
    );
  };

  // One round per call, so a finished round's controllers go out of scope.
  async function runRound(index: number): Promise<string[]> {
    round = createRound();
    const current = round;
    const state = () =>
      `${http2 ? "http/2" : "http/1.1"} ${mode} round ${index + 1} of ${rounds}: ${current.arrived} of ${batchSize} requests arrived, ${current.aborted} aborted, ${current.settled} settled`;
    let responses: Promise<string>[];
    if (mode === "response-only") {
      responses = Array.from({ length: batchSize }, () => settle(fetch(url, fetchOptions)));
      await withDeadline(current.allArrived.promise, state);
      current.gate.resolve();
    } else {
      const controllers = Array.from({ length: batchSize }, () => new AbortController());
      for (const controller of controllers) clientSignals.push(new WeakRef(controller.signal));
      responses = controllers.map(({ signal }) => settle(fetch(url, { ...fetchOptions, signal })));
      await withDeadline(current.allArrived.promise, state);
      for (const controller of controllers) controller.abort();
      if (mode === "abort-before-response") await withDeadline(current.allAborted.promise, state);
      current.gate.resolve();
    }
    // A collection while the batch is still in flight on both ends.
    Bun.gc();
    return await withDeadline(Promise.all(responses), state);
  }

  for (let i = 0; i < rounds; i++) {
    for (const outcome of await runRound(i)) outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  // A fetch() can reject before the server's handler returns, so give the last round's handlers a turn to finish.
  await new Promise<void>(resolve => setImmediate(resolve));
  // The server is still running, so a signal it kept past the end of its request counts as alive.
  Bun.gc(true);
  return {
    requests: rounds * batchSize,
    outcomes,
    abortEvents,
    serverSignals: { tracked: serverSignals.length, alive: countAlive(serverSignals) },
    clientSignals: { tracked: clientSignals.length, alive: countAlive(clientSignals) },
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
