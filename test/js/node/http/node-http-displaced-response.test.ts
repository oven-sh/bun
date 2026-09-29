import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "path";

// A connection has one current response. The server socket gives the connection to the next
// response when JS says that the current one is done (res.detachSocket(), a 'close' or 'finish'
// event, socket._httpMessage = null), or when the next request of a keep-alive connection
// arrives. A WebSocket can also adopt the socket while responses are queued. A response that
// lost the connection no longer hears about a close, so it must not keep a pointer to the
// socket. It used to: the next call on it read the freed socket.
//
// Each fixture run is one process that goes through its scenarios in order and prints a line
// for each. The unfixed build stops at the first one (ASAN: heap-use-after-free or
// heap-buffer-overflow), or never exits.
const fixture = join(import.meta.dir, "node-http-displaced-response-fixture.ts");
// A debug or ASAN build needs several seconds to load node:http and to run 22 scenarios.
const timeout = isASAN || isDebug ? 90_000 : undefined;

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
          uses.map(use => ({ trigger, use, secondRequest, displacedBeforeClose: true, result: "returned" })),
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
        results: [{ completed: true, secondBody: true }],
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
        results: [{ displaced: true, receivedAtLeastTheWrite: true }],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );

  // Not on TLS: its socket is bigger, so the unfixed build reads inside the block of the WebSocket and nothing shows.
  test.skipIf(transport === "tls")(
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
        })),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
    timeout,
  );
});
