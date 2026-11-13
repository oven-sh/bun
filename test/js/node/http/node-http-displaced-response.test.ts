import { nodeHTTPMessageHasConnection } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, tls as tlsCertificate } from "harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import tls from "node:tls";
import { join } from "path";

// A connection has one current response. The server socket gives the connection to the next
// response when JS says that the current one is done (res.detachSocket(), a 'close' or 'finish'
// event, socket._httpMessage = null), or when the next request of a keep-alive connection
// arrives. A WebSocket can also adopt the socket while responses are queued. A response that
// lost the connection no longer hears about a close, so it must not keep a pointer to the
// socket. It used to: the next call on it read the freed socket.
//
// Each fixture run is one process that runs the scenarios of a suite and prints a line for
// each. The unfixed build stops with a sanitizer report (heap-use-after-free or
// heap-buffer-overflow), or reports a response that still holds its refs.
const fixture = join(import.meta.dir, "node-http-displaced-response-fixture.ts");
// CI has its own time for each test. A local debug or ASAN build needs 4 s to start one fixture
// and load node:http, and about 40 s when all of them start together, so the default 5 s cannot hold.
const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;

async function run(...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = stdout
    .split("\n")
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line));
  return { results, stderr, exitCode, signalCode: proc.signalCode };
}

const uses = [
  "end",
  "write",
  "flushHeaders",
  "writeContinue",
  "writeProcessing",
  "writeHead+end",
  "destroy",
  "req.destroy",
  "getters",
  "emit-close",
  "nothing",
];
const triggers = ["detachSocket", "emit-close", "emit-finish", "clear-httpMessage"];

describe.concurrent.each(["tcp", "tls"])("a response that lost the connection to the next response (%s)", transport => {
  test.each(triggers)(
    "can be used after the connection closed: %s",
    async trigger => {
      expect(await run("displaced", transport, trigger)).toEqual({
        results: ["same read", "later read"].flatMap(secondRequest =>
          uses.map(use => ({
            trigger,
            use,
            secondRequest,
            displacedBeforeClose: true,
            result: "returned",
            // "nothing" makes no call on the response, so it does not read its state.
            ...(use === "nothing" ? {} : { pending: false }),
          })),
        ),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  test(
    "a finished response that the next keep-alive request replaced does not read the closed connection",
    async () => {
      const returned = (call: string) => ({ call, replaced: true, result: "returned" });
      const threw = (call: string, code: string) => ({ call, replaced: true, result: `threw ${code}` });
      expect(await run("finished", transport)).toEqual({
        results: [
          returned("resume"),
          returned("pause"),
          returned("pauseReads"),
          returned("notifyWhenReadParsed"),
          returned("flushHeaders"),
          threw("end", "ERR_STREAM_WRITE_AFTER_END"),
          threw("write", "ERR_STREAM_WRITE_AFTER_END"),
          returned("abort"),
          returned("writeContinue"),
          returned("bufferedAmount"),
          threw("cork", "ERR_STREAM_ALREADY_FINISHED"),
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  test(
    "does not write into the place of the response that has the connection",
    async () => {
      expect(await run("connected", transport)).toEqual({
        results: triggers.map(trigger => ({
          trigger,
          late: "returned",
          pending: false,
          regranted: false,
          thirdQueued: true,
          bodies: ["second-body", "third-body"],
          errors: [],
        })),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  test(
    "a response that native code completed does not keep the process alive after it is replaced",
    async () => {
      expect(await run("completed-but-pending", transport)).toEqual({
        results: [{ completed: true, secondBody: true, pending: false }],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  test(
    "a queued response does not write before it has the connection",
    async () => {
      const head = (length: number) =>
        `HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\nContent-Length: ${length}\r\n\r\n`;
      const calls = ["write", "end", "writeHead", "flushHeaders", "writeContinue", "writeInformational", "cork"];
      expect(await run("queued", transport)).toEqual({
        results: calls.map(call => ({
          call,
          queued: true,
          result: "returned",
          received: head(10) + "first-body" + head(11) + "second-body",
        })),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  test(
    "the write that it left in the socket buffer goes out, and its drain handler is gone",
    async () => {
      expect(await run("draining", transport)).toEqual({
        results: [{ displaced: true, pending: false, receivedAtLeastTheWrite: true }],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  test(
    "a queued response can be used after a WebSocket adopted the connection",
    async () => {
      expect(await run("adopted", transport)).toEqual({
        results: uses.map(use => ({
          use,
          queued: true,
          switched: true,
          // req.destroy() destroys the socket of the request, which the WebSocket has.
          open: use !== "req.destroy",
          result: "returned",
          pending: false,
        })),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );
});

// The other way to lose the connection is a close. The response hears about a close at once, before uWS
// destructs the response state in the socket, so that is when it has to let go of the connection. A close
// runs inside a listener when uWS cannot defer it: in a tunnel ('connect', 'upgrade') and for a reset.
describe("a response lets go of the connection when its socket closes inside the listener", () => {
  const head = "GET / HTTP/1.1\r\nHost: x\r\n";
  const cases = [
    {
      event: "connect",
      payload: "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
      close: "destroy",
      transports: ["tcp", "tls"],
    },
    {
      event: "upgrade",
      payload: head + "Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
      close: "destroy",
      transports: ["tcp", "tls"],
    },
    // A TLS socket cannot be reset.
    { event: "request", payload: head + "\r\n", close: "resetAndDestroy", transports: ["tcp"] },
  ] as const;

  for (const { event, payload, close, transports } of cases) {
    test.each(transports)(`socket.${close}() inside '${event}' (%s)`, async transport => {
      const held = Promise.withResolvers<{ before: boolean; after: boolean }>();
      const server = transport === "tls" ? https.createServer(tlsCertificate) : http.createServer();
      server.on(event, (req: http.IncomingMessage) => {
        try {
          const before = nodeHTTPMessageHasConnection(req);
          (req.socket as any)[close]();
          held.resolve({ before, after: nodeHTTPMessageHasConnection(req) });
        } catch (error) {
          held.reject(error);
        }
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;
      const client =
        transport === "tls"
          ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
          : net.connect(port, "127.0.0.1");
      try {
        // The server closes the socket, so the client ends with an error or a close. Only a close before the listener ran is a failure.
        client.on("error", () => {});
        client.on("close", () => held.reject(new Error("the client closed before the listener ran")));
        client.write(payload);
        expect(await held.promise).toEqual({ before: true, after: false });
      } finally {
        client.destroy();
        server.closeAllConnections();
        server.close();
      }
    });
  }
});
