import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// net.Server.listen({ fd }) adopts an already-bound, already-listening socket
// inherited from the parent process — the mechanism systemd socket activation
// uses (LISTEN_FDS hands the listening socket to the service as fd 3).
// Inheriting a listening fd is POSIX-only.
test.skipIf(isWindows)("net.Server.listen({ fd }) adopts an inherited listening socket", async () => {
  using dir = tempDir("listen-fd", {
    "parent.mjs": `
import net from "node:net";
import { spawn } from "node:child_process";

// Create the bound + listening socket in this process.
const listener = net.createServer();
await new Promise((res, rej) => {
  listener.once("error", rej);
  listener.listen(0, "127.0.0.1", res);
});
const port = listener.address().port;
const fd = listener._handle.fd;

// Hand the listening socket to the child as fd 3 (systemd convention), then
// close our own copy so only the child accepts connections.
const child = spawn(process.execPath, [new URL("./child.mjs", import.meta.url).pathname], {
  stdio: ["inherit", "inherit", "inherit", fd],
  env: { ...process.env, PORT_FROM_PARENT: String(port) },
});
listener.close();
child.on("exit", code => process.exit(code ?? 1));
`,
    "child.mjs": `
import net from "node:net";

const server = net.createServer(sock => {
  sock.setEncoding("utf8");
  sock.on("data", () => sock.end("OK from fd-activated child"));
});

server.on("error", e => { console.log("FAILED:server:" + e.message); process.exit(2); });
server.listen({ fd: 3 }, () => {
  const port = Number(process.env.PORT_FROM_PARENT);
  const client = net.connect(port, "127.0.0.1", () => client.write("ping"));
  client.setEncoding("utf8");
  let data = "";
  client.on("data", d => { data += d; });
  client.on("end", () => {
    console.log("RESPONSE:" + data);
    server.close();
    process.exit(0);
  });
  client.on("error", e => { console.log("FAILED:client:" + e.message); process.exit(3); });
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("RESPONSE:OK from fd-activated child");
  expect(exitCode).toBe(0);
});
