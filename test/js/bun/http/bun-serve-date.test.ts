import type { Socket } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { join } from "node:path";

// The Date header is the second in which the response is written, read from a coarse clock.
// That clock and Date.now() can disagree by a clock tick, which is the second before at a
// boundary.
const CLOCK_SLACK_MS = 100;

/** `date` is the second of a response that was written between `notBefore` and `notAfter`. */
function expectWrittenBetween(date: string | null, notBefore: number, notAfter: number) {
  expect(date).toMatch(
    /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  );
  const seconds = Date.parse(date!) / 1000;
  expect(seconds).toBeGreaterThanOrEqual(Math.floor((notBefore - CLOCK_SLACK_MS) / 1000));
  expect(seconds * 1000).toBeLessThanOrEqual(notAfter + CLOCK_SLACK_MS);
}

/** The lines a child process prints, one per call. */
function lineReader(stream: ReadableStream<Uint8Array>): () => Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return async () => {
    while (!buffered.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("the child process exited before it printed a line");
      buffered += decoder.decode(value, { stream: true });
    }
    const end = buffered.indexOf("\n");
    const line = buffered.slice(0, end);
    buffered = buffered.slice(end + 1);
    return line;
  };
}

test.concurrent("Date header is not updated every request", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
  });

  // 30 responses, 5 at a time.
  const started = Date.now();
  const dates = new Set<string>();
  for (let burst = 0; burst < 6; burst++) {
    // So that the responses span more than one second.
    if (burst > 0) await Bun.sleep(250);
    const sent = Date.now();
    const responses = await Promise.all([
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
      fetch(server.url),
    ]);
    const received = Date.now();
    for (const response of responses) {
      expectWrittenBetween(response.headers.get("Date"), sent, received);
      dates.add(response.headers.get("Date")!);
    }
  }

  // As many values as seconds, not as many as responses.
  const seconds = Math.floor(Date.now() / 1000) - Math.floor((started - CLOCK_SLACK_MS) / 1000) + 1;
  expect(dates.size).toBeLessThanOrEqual(seconds);
});

// The child processes of the two groups below start in beforeAll. A test is then its own wait
// and no more, on a debug build too, where a child takes seconds to start.

describe("Date header is the second the response is written in", () => {
  const protocols = ["http1.1", "http2", "http3"] as const;
  const origins = {} as Record<(typeof protocols)[number], string>;
  const servers = new AsyncDisposableStack();

  beforeAll(async () => {
    await Promise.all(
      protocols.map(async protocol => {
        const server = servers.use(
          Bun.spawn({
            cmd: [bunExe(), join(import.meta.dir, "bun-serve-date-fixture.ts")],
            env: { ...bunEnv, PROTOCOL: protocol, TLS_CERT: tlsCert.cert, TLS_KEY: tlsCert.key },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "inherit",
          }),
        );
        // The server stops on stdin EOF and exits by itself (see the fixture).
        servers.defer(async () => {
          server.stdin.end();
          await server.exited;
        });
        const port = Number(await lineReader(server.stdout)());
        origins[protocol] = `${protocol === "http1.1" ? "http" : "https"}://127.0.0.1:${port}`;
      }),
    );
  });
  afterAll(() => servers.disposeAsync());

  test.concurrent.each(protocols)("%s: after a handler that blocks", async protocol => {
    /** One request. Returns its Date header once that is shown to be current. */
    async function currentDate(path: string): Promise<string> {
      const response = await fetch(origins[protocol] + path, { protocol, tls: { rejectUnauthorized: false } });
      await response.arrayBuffer();
      const received = Date.now();
      const date = response.headers.get("date");
      // x-now is the server's clock when the handler returned the response, so the check does
      // not depend on how long the response took to arrive.
      expectWrittenBetween(date, Number(response.headers.get("x-now")), received);
      return date!;
    }

    const before = await currentDate("/");
    // The handler holds the event loop until the second has changed, so nothing but the write
    // itself can refresh the date.
    const after = await currentDate("/block");
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  });
});

// No timer keeps the Date header fresh: neither in a process that serves no HTTP, nor in a
// server between responses. Each child holds one idle socket, and the other end of the socket
// is this process. Two events from here, WINDOW_MS apart, are all that the child's loop has to
// turn for: it reports how many times it turned from the first to the second.
//
// What else turns the loop of an idle process is off in the child: the idle GC timer (1 s for
// its first 30 fires after the heap grows, then 30 s), JSC's incremental sweeper, and on
// Windows the allocator sweep that the libuv loop comes back for up to 3 times, 100 ms apart,
// after JS ran. The 4 s socket timeout sweep stays on, and can fall in the window once.
describe("no timer behind the Date header turns an idle event loop", () => {
  const WINDOW_MS = 3200;
  // A timer that fires each second turns the loop 3 times in the window. The event that ends
  // the window turns it once.
  const TURNS_WITH_A_TIMER = 4;
  const fixture = join(import.meta.dir, "bun-serve-date-idle-fixture.ts");
  const env = {
    ...bunEnv,
    BUN_GC_TIMER_DISABLE: "1",
    BUN_JSC_sweepSynchronously: "1",
    BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS: "0",
  };

  // The two events of a child's socket. `end` resolves to what the child prints.
  type Idle = { start(): Promise<void>; end(): Promise<{ iterations: number }> };
  const idle = {} as Record<"tcp" | "tls" | "serve", Idle>;
  const children = new AsyncDisposableStack();

  /** A child with a client socket to a listener of this process. */
  async function idleClient(kind: "tcp" | "tls") {
    const connected = Promise.withResolvers<Socket>();
    const listener = children.use(
      Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: kind === "tls" ? tlsCert : undefined,
        socket: {
          ...(kind === "tls" ? { handshake: connected.resolve } : { open: connected.resolve }),
          data() {},
        },
      }),
    );
    const client = children.use(
      Bun.spawn({
        cmd: [bunExe(), fixture, kind, String(listener.port)],
        env,
        stdout: "pipe",
        stderr: "inherit",
      }),
    );
    const nextLine = lineReader(client.stdout);
    const socket = await Promise.race([
      connected.promise,
      client.exited.then(code => Promise.reject(new Error(`the client exited with code ${code}`))),
    ]);
    idle[kind] = {
      async start() {
        socket.write("s");
      },
      async end() {
        socket.write("e");
        return JSON.parse(await nextLine());
      },
    };
  }

  /** A child that serves HTTP, with one connection from this process. */
  async function idleServer() {
    const server = children.use(
      Bun.spawn({
        cmd: [bunExe(), fixture, "serve"],
        env,
        stdout: "pipe",
        stderr: "inherit",
      }),
    );
    const nextLine = lineReader(server.stdout);
    const port = Number(await nextLine());

    // The response to the request that is in flight, if any.
    let answered: PromiseWithResolvers<void> | undefined;
    const socket = children.use(
      await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          data(_, chunk) {
            if (chunk.toString().startsWith("HTTP/1.1 200")) answered?.resolve();
          },
          close() {
            answered?.reject(new Error("the server closed the connection"));
          },
          error(_, error) {
            answered?.reject(error);
          },
        },
      }),
    );
    // Both requests are on this one connection, so it is open for all of the idle time.
    const request = async (path: string) => {
      answered = Promise.withResolvers<void>();
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
      await answered.promise;
    };
    idle.serve = {
      start: () => request("/start"),
      async end() {
        await request("/end");
        return JSON.parse(await nextLine());
      },
    };
  }

  beforeAll(async () => {
    await Promise.all([idleClient("tcp"), idleClient("tls"), idleServer()]);
  });
  afterAll(() => children.disposeAsync());

  test.concurrent.each([
    ["a TCP client socket", "tcp"],
    ["a TLS client socket", "tls"],
    ["a Bun.serve keep-alive connection", "serve"],
  ] as const)("%s", async (_, kind) => {
    await idle[kind].start();
    // The wait is the test: nothing may turn the child's loop meanwhile, so there is no signal
    // to wait for.
    await Bun.sleep(WINDOW_MS);
    const { iterations } = await idle[kind].end();
    expect(iterations).toBeLessThan(TURNS_WITH_A_TIMER);
  });
});
