import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";

// The tests below wait for the clock: for a second to pass, for a handler that blocks, for an
// idle window. The explicit timeouts are for those waits on a debug+ASAN build, where each
// child process also takes seconds to start.

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

// x-now is the server's clock when the handler returned the response, so the check does not
// depend on how long the response took to arrive.
describe("Date header is the second the response is written in", () => {
  test.concurrent.each(["http1.1", "http2", "http3"] as const)(
    "%s: after idle time, across a second boundary, and after a handler that blocks",
    async protocol => {
      await using server = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, "bun-serve-date-fixture.ts")],
        env: { ...bunEnv, PROTOCOL: protocol },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const port = Number(await lineReader(server.stdout)());
      const origin = `${protocol === "http1.1" ? "http" : "https"}://127.0.0.1:${port}`;

      /** One request. Returns its Date header once that is shown to be current. */
      async function currentDate(path: string): Promise<string> {
        const response = await fetch(origin + path, { protocol, tls: { rejectUnauthorized: false } });
        await response.arrayBuffer();
        const received = Date.now();
        const date = response.headers.get("date");
        expectWrittenBetween(date, Number(response.headers.get("x-now")), received);
        return date!;
      }

      // The first response after the server had no connection for more than 2 s. The wait is
      // the condition.
      await Bun.sleep(2100);
      const first = await currentDate("/");

      // Back-to-back responses until one carries the next second.
      let next = first;
      while (next === first) next = await currentDate("/");
      expect(Date.parse(next)).toBeGreaterThan(Date.parse(first));

      // The handler holds the event loop for 1.5 s, so nothing but the write itself can refresh
      // the date.
      await currentDate("/block");

      server.stdin.end();
      expect(await server.exited).toBe(0);
    },
    20_000,
  );
});

// No timer keeps the Date header fresh: neither in a process that serves no HTTP, nor in a
// server between responses. Each child holds one idle socket and counts the turns of its event
// loop. The other end of the socket is this process.
//
// What still turns that loop is the 4 s socket timeout sweep, which a connected socket arms.
// Two other timers of an idle process are off in the child: the idle GC timer (1 s for its first
// 30 fires after the heap grows, then 30 s) and JSC's incremental sweeper.
describe("no timer behind the Date header turns an idle event loop", () => {
  const IDLE_SECONDS = 6;
  const fixture = join(import.meta.dir, "bun-serve-date-idle-fixture.ts");
  const env = { ...bunEnv, BUN_GC_TIMER_DISABLE: "1", BUN_JSC_sweepSynchronously: "1" };
  type Idle = { open?: boolean; iterations: number };

  /** Runs the fixture as a client of `port`. Resolves to what it reports after the idle time. */
  async function idleClient(kind: "net" | "tls" | "https-agent", port: number): Promise<Idle> {
    await using client = Bun.spawn({
      cmd: [bunExe(), fixture, kind, String(IDLE_SECONDS * 1000), String(port)],
      env,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([client.stdout.text(), client.exited]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test.concurrent(
    "net.connect",
    async () => {
      const server = net.createServer(socket => socket.write("x")).listen(0, "127.0.0.1");
      try {
        await once(server, "listening");
        const idle = await idleClient("net", (server.address() as net.AddressInfo).port);
        expect(idle).toEqual({ open: true, iterations: expect.any(Number) });
        // A timer that fires each second turns the loop at least once per second.
        expect(idle.iterations).toBeLessThan(IDLE_SECONDS);
      } finally {
        server.close();
      }
    },
    20_000,
  );

  test.concurrent(
    "tls.connect",
    async () => {
      const server = tls.createServer(tlsCert, socket => socket.write("x")).listen(0, "127.0.0.1");
      try {
        await once(server, "listening");
        const idle = await idleClient("tls", (server.address() as net.AddressInfo).port);
        expect(idle).toEqual({ open: true, iterations: expect.any(Number) });
        expect(idle.iterations).toBeLessThan(IDLE_SECONDS);
      } finally {
        server.close();
      }
    },
    20_000,
  );

  test.concurrent(
    "https.Agent keep-alive socket in freeSockets",
    async () => {
      // idleTimeout: 0, so the server does not close the parked socket while the client idles.
      await using server = Bun.serve({ port: 0, tls: tlsCert, idleTimeout: 0, fetch: () => new Response("ok") });
      const idle = await idleClient("https-agent", server.port);
      expect(idle).toEqual({ open: true, iterations: expect.any(Number) });
      expect(idle.iterations).toBeLessThan(IDLE_SECONDS);
    },
    20_000,
  );

  test.concurrent(
    "Bun.serve with an idle keep-alive connection",
    async () => {
      await using server = Bun.spawn({
        cmd: [bunExe(), fixture, "serve-keep-alive", String(IDLE_SECONDS * 1000)],
        env,
        stdout: "pipe",
        stderr: "inherit",
      });
      const nextLine = lineReader(server.stdout);
      const port = Number(await nextLine());

      // One connection, and the number of responses that arrived on it.
      let responses = 0;
      let closed = false;
      let arrived = Promise.withResolvers<void>();
      const socket = await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          data(_, chunk) {
            if (chunk.toString().startsWith("HTTP/1.1 200")) {
              responses++;
              arrived.resolve();
            }
          },
          close() {
            closed = true;
            arrived.reject(new Error("the server closed the connection"));
          },
        },
      });
      const request = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";
      socket.write(request);
      await arrived.promise;

      const idle: Idle = JSON.parse(await nextLine());
      // The same connection still answers, so it was open for all of the idle time.
      arrived = Promise.withResolvers<void>();
      socket.write(request);
      await arrived.promise;
      expect({ responses, closed }).toEqual({ responses: 2, closed: false });
      expect(idle.iterations).toBeLessThan(IDLE_SECONDS);
      socket.end();
    },
    20_000,
  );
});
