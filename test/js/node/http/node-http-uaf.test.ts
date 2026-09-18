import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join } from "path";

const slow = isASAN || isDebug;

async function runFixture(fixture: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, fixture)],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A fixture prints one JSON line when it completes. Keep the raw text when
  // it did not (a crash), so the failing assertion shows what came out.
  let result: unknown = stdout;
  try {
    result = JSON.parse(stdout);
  } catch {}
  return { result, stderr, exitCode };
}

// Ceiling for the tests that spawn a child. All of them run at once, so on a
// loaded 16-core debug+ASAN box the children take 3 to 8 s each (the #18564
// fixture is the longest). Release runs each in well under a second; the 20 s
// ceiling is for the windows-aarch64 lane, which once took 5 s on one of them.
const fixtureTimeout = slow ? 60_000 : 20_000;

// The fixture replays the #18485 crash in two ways. Ten rounds make the exact
// order of events that freed the socket under a pending response, one per
// connection. Then the load pattern of the report: REQUESTS POSTs, 100 in
// flight, each aborted 1 to 6 ms in. The pre-fix release (bun 1.2.6, commit
// 8ebd5d53d) crashes on the first round every time, and the load pattern
// crashed it around request 300 in 10/10 runs at both 500 and 1000 requests.
// Release ran 10000 before. Every request is a new connection, and on darwin
// the listen(0) of the two GC tests below failed right after that burst
// (builds 105020, 105316 and 105364), which fits an exhausted ephemeral port
// range. 1000 is the largest calibrated count and a tenth of the churn. The
// load part costs about 5 ms per request under ASAN, so slow builds run fewer.
test.concurrent(
  "a response written after the client aborted does not touch the freed socket (#18485)",
  async () => {
    const requests = slow ? 500 : 1000;
    const { result, stderr, exitCode } = await runFixture("node-http-uaf-fixture.ts", {
      ROUNDS: "10",
      REQUESTS: String(requests),
    });
    expect({ result, stderr, exitCode }).toEqual({
      result: {
        rounds: Array.from({ length: 10 }, () => "wrote after close"),
        tally: {
          requests,
          handled: expect.any(Number),
          responded: expect.any(Number),
          aborted: expect.any(Number),
          // Only AbortError counts as aborted. A reset or a refused connection
          // would show up here by name.
          failed: {},
        },
      },
      stderr: "",
      exitCode: 0,
    });
    // Under ASAN every request is aborted before the server answers; release
    // answers about a fifth of them. `handled` says how many reached the
    // server: about nine in ten on a fast machine, and none on a slow one
    // (windows-aarch64 in CI), where every abort lands before the accept. It
    // is reported, not asserted. The deterministic rounds above carry the
    // coverage; the load only has to settle, and abort at least once.
    const { tally } = result as { tally: { responded: number; aborted: number } };
    expect({ settled: tally.responded + tally.aborted, aborted: tally.aborted > 0 }).toEqual({
      settled: requests,
      aborted: true,
    });
  },
  fixtureTimeout,
);

// 200 rounds of ten uploads crash bun 1.2.6 every time (8/8 here, between
// upload 150 and 400; 10/10 in the earlier calibration, where 40 to 100 rounds
// did in 8/10). The same count runs on every lane: the uploads are cut short,
// so a round costs about 35 ms under ASAN whatever the body size.
test.concurrent(
  "destroying a response while its body is still uploading does not crash (#18564)",
  async () => {
    const { result, stderr, exitCode } = await runFixture("node-http-uaf-fixture-2.ts", { ROUNDS: "200" });
    expect({ result, stderr, exitCode }).toEqual({
      result: { requests: 2000, responded: expect.any(Number), failed: expect.any(Number) },
      stderr: "",
      exitCode: 0,
    });
    const { responded, failed } = result as { responded: number; failed: number };
    expect(responded + failed).toBe(2000);
  },
  fixtureTimeout,
);

// A termination request (worker.terminate(), a node:vm timeout) that landed on
// the native writeHead of a response used to be taken in a stretch of native
// code that had no exception scope. JSC's exception-check validator reports
// that as "Unchecked JS exception ... NodeHTTPServer__writeHead" and aborts.
// The validator only exists in debug and ASAN builds; release has nothing to
// observe. The fixture steers node:vm deadlines onto that call. Against the
// unfixed build, all 20 calibration runs (five at a time on a 16-core
// debug+ASAN box) aborted, between attempt 350 and 1060. Two runs of 1500
// attempts each keep the total and take half the wall time: each run alone
// covers the window the calibration saw, with the same end/flushHeaders
// alternation.
test.concurrent.skipIf(!slow)(
  "a termination request landing on the native writeHead passes the exception-check validator",
  async () => {
    const runs = await Promise.all(
      [1, 2].map(() =>
        runFixture("node-http-writehead-termination-fixture.ts", {
          BUN_JSC_validateExceptionChecks: "1",
          ATTEMPTS: "1500",
        }),
      ),
    );
    const counts = {
      early: expect.any(Number),
      inCall: expect.any(Number),
      late: expect.any(Number),
      cutAfterHead: expect.any(Number),
    };
    for (const { result: summary, stderr, exitCode } of runs as { result: any; stderr: string; exitCode: number }[]) {
      // On a failure stdout stays empty and stderr carries the validator's report.
      expect({ summary, stderr, exitCode }).toEqual({
        summary: {
          attempts: expect.any(Number),
          timeout: expect.any(Number),
          paths: [
            { name: "end", ...counts },
            { name: "flushHeaders", ...counts },
          ],
        },
        stderr: "",
        exitCode: 0,
      });
      expect(summary.attempts).toBeGreaterThan(100);
      // The deadlines did land inside both calls (about 45% of them do here),
      // and on the end() path some were taken right after the native writeHead
      // had put the head out (15 to 30% of that path's attempts here).
      const [end, flushHeaders] = summary.paths;
      expect({
        end: end.inCall > 0,
        flushHeaders: flushHeaders.inCall > 0,
        cutAfterHead: end.cutAfterHead > 0,
      }).toEqual({
        end: true,
        flushHeaders: true,
        cutAfterHead: true,
      });
    }
  },
  60_000,
);

// The handler writes 8 MiB at a time until the socket pushes back (one write
// on Linux and macOS, two on Windows, whose loopback takes a whole 8 MiB send
// at once). The response is then left with a registered uWS writable handler
// while its onwritable slot holds a non-callable (#32661 set undefined, #32735
// the rest). The drain must skip the slot: the whole body still arrives, and
// the child exits clean. A drain that calls the slot throws an uncaught
// TypeError, which ends the child with the error on stderr. One child runs the
// four values in turn and prints a line per value, so a crash still names the
// value it happened on.
test.concurrent("drain skips an onwritable slot set to undefined, null, 0 or false", async () => {
  const src = /* js */ `
    import http from "node:http";
    import { once } from "node:events";

    const chunk = Buffer.alloc(8 * 1024 * 1024, "a");
    for (const slot of [undefined, null, 0, false]) {
      let written = 0;
      let hadBackpressure;
      const server = http.createServer(async (req, res) => {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        const sym = Object.getOwnPropertySymbols(res).find(s => s.description === "handle");
        const handle = res[sym];
        while (handle.bufferedAmount === 0 && written < 32 * chunk.length) {
          res.write(chunk);
          written += chunk.length;
        }
        hadBackpressure = handle.bufferedAmount > 0;
        handle.onwritable = slot;
        while (handle.bufferedAmount > 0) await new Promise(r => setImmediate(r));
        res.end();
      });
      await once(server.listen(0, "127.0.0.1"), "listening");

      const response = await fetch("http://127.0.0.1:" + server.address().port + "/", { headers: { connection: "close" } });
      const body = await response.bytes();
      console.log(JSON.stringify({ slot: String(slot), status: response.status, hadBackpressure, written, received: body.length }));
      server.close();
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout
    .split("\n")
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return line;
      }
    });
  expect({ lines, stderr, exitCode }).toEqual({
    lines: ["undefined", "null", "0", "false"].map(slot => ({
      slot,
      status: 200,
      hadBackpressure: true,
      written: expect.any(Number),
      received: expect.any(Number),
    })),
    stderr: "",
    exitCode: 0,
  });
  // Every byte the handler wrote, before and after the pushback, arrived.
  expect(lines.map(line => line.received)).toEqual(lines.map(line => line.written));
});

test.concurrent("'connection' and 'clientError' callbacks survive GC", async () => {
  // The server's native struct stores these two node:http callbacks on the JS
  // wrapper (GC-visited WriteBarrier slots), not in Strong handles. Force GC
  // between registration and dispatch to prove the wrapper roots them.
  let gotConnection = 0;
  let gotClientError = 0;
  const server = http.createServer((req, res) => res.end());
  server.on("connection", () => void gotConnection++);
  server.on("clientError", (err, sock) => {
    gotClientError++;
    sock.destroy();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    Bun.gc(true);

    const sock = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
    sock.on("error", () => {});
    await once(sock, "connect");
    Bun.gc(true);
    sock.write("!!!garbage!!!\r\n\r\n");
    await once(sock, "close");

    expect({ gotConnection, gotClientError }).toEqual({ gotConnection: 1, gotClientError: 1 });
  } finally {
    server.close();
  }
});

test.concurrent(
  "'request' and 'clientError' still dispatch on a connection that outlives server.close() and a GC",
  async () => {
    // The fixture also runs under `node --expose-gc` and prints the same result.
    const { result, stderr, exitCode } = await runFixture("node-http-server-close-gc-fixture.mjs");
    expect({ result, stderr, exitCode }).toEqual({
      result: Array.from({ length: 3 }, () => ({
        statuses: ["HTTP/1.1 200 OK", "HTTP/1.1 200 OK"],
        clientErrors: ["HPE_INVALID_HEADER_TOKEN"],
      })),
      stderr: "",
      exitCode: 0,
    });
  },
  fixtureTimeout,
);
