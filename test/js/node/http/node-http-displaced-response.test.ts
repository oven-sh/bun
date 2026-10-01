import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug } from "harness";
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
      // The handle records each call on it. The bytes go out behind response 1, when response 2 has the connection.
      const outputs = {
        "write": "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nearly\r\nb\r\nsecond-body\r\n0\r\n\r\n",
        "end": "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nearly",
        "writeHead": "HTTP/1.1 201 Created\r\nx-early: yes\r\nContent-Length: 11\r\n\r\nsecond-body",
        "flushHeaders": head(11) + "second-body",
        "writeContinue": "HTTP/1.1 100 Continue\r\n\r\n" + head(11) + "second-body",
        "writeInformational": "early" + head(11) + "second-body",
        "cork": head(11) + "second-body",
      };
      expect(await run("queued", transport)).toEqual({
        results: Object.entries(outputs).map(([call, output]) => ({
          call,
          queued: true,
          result: "returned",
          received: head(10) + "first-body" + output,
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
