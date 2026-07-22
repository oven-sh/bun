import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { join } from "path";

// Each fixture internally loops thousands of requests to hit the abort/destroy
// race; running the whole subprocess a second time adds no new coverage. On
// ASAN/debug builds the access-after-free is caught on the first bad touch, so
// the request count only needs to be large enough to land the timing window a
// few times. Release builds keep the original counts.
const slow = isASAN || isDebug;
// #18485: reporter "spammed in a bash while loop" to crash a release build; 2000
// aborted requests at CONCURRENCY=100 is still 20 full windows under ASAN.
uafTest("node-http-uaf-fixture.ts", { REQUESTS: slow ? "2000" : "10000" });
// #18564: the repro in the PR body was a single request; 200 is 200x that.
uafTest("node-http-uaf-fixture-2.ts", { ROUNDS: slow ? "20" : "100" });

function uafTest(fixture: string, extraEnv: Record<string, string>) {
  test.concurrent(
    `should not crash on abort (${fixture})`,
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, fixture)],
        env: { ...bunEnv, ...extraEnv },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout.trimEnd().split("\n").at(-1)).toBe("Done");
      expect(exitCode).toBe(0);
    },
    // One reduced-count pass measured ~22 s (fixture 1) / ~3.5 s (fixture 2) on
    // a 16-core debug+ASAN box with the other concurrent tests contending;
    // release runs the full 10k in ~1 s. Keep the 20 s release ceiling for the
    // windows-aarch64 lane that previously ran one fixture to 5006 ms.
    slow ? 60_000 : 20_000,
  );
}

test.concurrent.each([
  ["undefined", "undefined"],
  ["null", "null"],
  ["0", "0"],
  ["false", "false"],
])("should not crash when drain fires after onWritable slot is set to %s", async (_, slotExpr) => {
  const src = /* js */ `
    import http from "node:http";
    import net from "node:net";
    import { once } from "node:events";

    let caught;
    process.on("uncaughtException", err => { caught = String(err); });

    const server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write(Buffer.alloc(8 * 1024 * 1024, "a"));
      const sym = Object.getOwnPropertySymbols(res).find(s => s.description === "handle");
      const handle = res[sym];
      handle.onwritable = ${slotExpr};
      while (handle.bufferedAmount > 0) await new Promise(r => setImmediate(r));
      res.end();
    });
    await once(server.listen(0), "listening");

    const sock = net.connect(server.address().port, "127.0.0.1");
    await once(sock, "connect");
    sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
    let received = 0;
    sock.on("data", d => (received += d.length));
    await once(sock, "close");
    console.log(JSON.stringify({ received, caught }));
    server.close();
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    stdout: { received: expect.any(Number) },
    stderr: "",
    exitCode: 0,
  });
  expect(JSON.parse(stdout).received).toBeGreaterThan(8 * 1024 * 1024);
});

test("'connection' and 'clientError' callbacks survive GC", async () => {
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
