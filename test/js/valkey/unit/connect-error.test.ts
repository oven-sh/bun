import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import net from "node:net";

// A refused direct (literal-IP) connect must surface the error AND close the
// half-open socket in the core: a handler that only detaches its handle used
// to leave the failed fd registered forever — leaking one fd per attempt and
// spinning the event loop at 100% CPU.
test.concurrent("refused connect surfaces an error without leaking fds or spinning the event loop", async () => {
  // Grab a port that nothing listens on: bind, read it back, close.
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise(resolve => server.close(resolve));

  const src = `
    const fs = require("node:fs");
    const fdDir = process.platform === "darwin" ? "/dev/fd" : "/proc/self/fd";
    const countFds = () => (process.platform === "win32" ? 0 : fs.readdirSync(fdDir).length);

    async function failedConnect() {
      const client = new Bun.RedisClient("redis://127.0.0.1:${port}", {
        autoReconnect: false,
        connectionTimeout: 5000,
      });
      try {
        await client.connect();
        return null;
      } catch (error) {
        return error?.code ?? String(error);
      } finally {
        client.close();
      }
    }

    const code = await failedConnect();
    const before = countFds();
    for (let i = 0; i < 20; i++) await failedConnect();
    const after = countFds();

    // Spin check: with every failed socket closed, sleeping should use
    // almost no CPU; a leaked half-open fd keeps the poller hot.
    const t0 = performance.now();
    const cpu0 = process.cpuUsage();
    while (performance.now() - t0 < 250) await Bun.sleep(25);
    const wallMs = performance.now() - t0;
    const cpu = process.cpuUsage(cpu0);
    console.log(JSON.stringify({ code, fdGrowth: after - before, cpuMs: (cpu.user + cpu.system) / 1000, wallMs }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim() || "{}");
  expect({ code: result.code, stderr: exitCode === 0 ? "" : stderr }).toEqual({
    code: "ERR_REDIS_CONNECTION_CLOSED",
    stderr: "",
  });
  if (!isWindows) {
    expect(result.fdGrowth).toBeLessThanOrEqual(2);
  }
  expect(result.cpuMs).toBeLessThan(result.wallMs * 0.5);
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
