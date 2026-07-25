import { expect, test } from "bun:test";
import net from "node:net";

// The vendored Node suites routinely listen on the default address
// (server.listen(0), which binds ::) and connect via the default host
// (net.connect(port) / http://localhost:port). Two of them time out silently
// on the windows-11-aarch64 agent while explicit-127.0.0.1 twins pass, so
// this pins the exact contract they rely on and, when it breaks, reports
// which loopback family stalls instead of timing out with no output.
async function tryConnect(port: number, host: string | undefined, deadline: number): Promise<string> {
  return await new Promise<string>(resolve => {
    const started = Date.now();
    const socket = host === undefined ? net.connect(port) : net.connect(port, host);
    const finish = (result: string) => {
      socket.destroy();
      resolve(`${result} in ${Date.now() - started}ms`);
    };
    socket.on("connect", () => finish("ok"));
    socket.on("error", e => finish(`error ${(e as NodeJS.ErrnoException).code}`));
    setTimeout(() => finish("TIMEOUT"), deadline).unref();
  });
}

test("a default-bound server is reachable via the default localhost connect", async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address() as net.AddressInfo;
  console.error("DIAG listen(0) bound:", JSON.stringify(addr));

  const [byDefault, byV4, byV6, byName] = await Promise.all([
    tryConnect(addr.port, undefined, 3000),
    tryConnect(addr.port, "127.0.0.1", 3000),
    tryConnect(addr.port, "::1", 3000),
    tryConnect(addr.port, "localhost", 3000),
  ]);
  console.error(`DIAG default=${byDefault} 127.0.0.1=${byV4} ::1=${byV6} localhost=${byName}`);
  server.close();

  expect(byDefault).toStartWith("ok");
  expect(byName).toStartWith("ok");
}, 20_000);
