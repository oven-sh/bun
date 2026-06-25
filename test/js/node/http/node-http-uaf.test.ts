import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

uafTest("node-http-uaf-fixture.ts");
uafTest("node-http-uaf-fixture-2.ts");

function uafTest(fixture, iterations = 2) {
  test(`should not crash on abort (${fixture})`, async () => {
    for (let i = 0; i < iterations; i++) {
      const { exited } = Bun.spawn({
        cmd: [bunExe(), join(import.meta.dir, fixture)],
        env: bunEnv,
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      const exitCode = await exited;
      expect(exitCode).not.toBeNull();
      expect(exitCode).toBe(0);
    }
  });
}

test("should not crash when drain fires after the onWritable slot was cleared", async () => {
  const src = /* js */ `
    import http from "node:http";
    import net from "node:net";
    import { once } from "node:events";

    const server = http.createServer(async (req, res) => {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write(Buffer.alloc(8 * 1024 * 1024, "a"));
      const sym = Object.getOwnPropertySymbols(res).find(s => s.description === "handle");
      const handle = res[sym];
      handle.onwritable = undefined;
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
    console.log(JSON.stringify({ received }));
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
