import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, normalizeBunSnapshot } from "harness";
import path from "path";

test("ipc with json serialization still works when bun is parent and not the child", async () => {
  const child = Bun.spawn([bunExe(), path.resolve(import.meta.dir, "fixtures", "ipc-parent-bun.js")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await child.exited;
  expect(await new Response(child.stdout).text()).toEqual(
    `p start
p end
c start
c end
c I am your father
p I am your father
`,
  );
  expect(await new Response(child.stderr).text()).toEqual("");
});

test.skipIf(!nodeExe())(
  'a node child under the default serialization is reported, with the "json" remedy',
  async () => {
    // Bun.spawn({ ipc }) defaults to serialization: "advanced", which only Bun
    // speaks. A Node.js child answers in v8's framing; the parent cannot decode it
    // and must fail loudly instead of leaving the user with a channel that never
    // delivers anything.
    const parentSource = `
    const child = Bun.spawn({
      cmd: [process.env.NODE_BIN, "-e", 'process.send({ hello: "from node" }, () => process.disconnect())'],
      stdio: ["ignore", "inherit", "inherit"],
      ipc(message) { console.log("UNEXPECTED_IPC_MESSAGE", message); },
    });
    await child.exited;
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentSource],
      env: { ...bunEnv, NODE_BIN: nodeExe()! },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // No uncaughtException handler: the parent exits 1 at the report.
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr)).toContain(
      `sent an IPC message that is not in Bun's "advanced" serialization format, so Bun closed the IPC channel. "advanced" serialization only works between two Bun processes. For IPC between Bun and Node.js, use serialization: "json".`,
    );
    expect(exitCode).toBe(1);
  },
);

test.skipIf(isWindows || !nodeExe())(
  "receives a net.Socket handle from a node child and releases its descriptor",
  async () => {
    const parentSource = [
      `const net = require("node:net");`,
      `const gotHandle = Promise.withResolvers();`,
      `const socketClosed = Promise.withResolvers();`,
      `const server = net.createServer(socket => {`,
      `  socket.resume();`,
      `  socket.on("close", () => socketClosed.resolve());`,
      `});`,
      `await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));`,
      `const childSource = 'const net = require("net"); const socket = net.connect(Number(process.env.HANDLE_PORT), "127.0.0.1", () => { process.send("x", socket); });';`,
      `const child = Bun.spawn({`,
      `  cmd: [process.env.NODE_BIN, "-e", childSource],`,
      `  stdio: ["ignore", "inherit", "inherit"],`,
      `  serialization: "json",`,
      `  ipc(message, _subprocess, handle) { gotHandle.resolve({ message, handle }); },`,
      `  env: { ...process.env, HANDLE_PORT: String(server.address().port) },`,
      `});`,
      `const { message, handle } = await gotHandle.promise;`,
      `console.log("message:", message);`,
      `console.log("handle is a net.Socket:", handle instanceof net.Socket);`,
      `child.kill();`,
      `await child.exited;`,
      `handle.destroy();`,
      `await socketClosed.promise;`,
      `server.close();`,
      `console.log("socket-closed");`,
    ].join("\n");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentSource],
      env: { ...bunEnv, NODE_BIN: nodeExe()! },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: normalizeBunSnapshot(stdout), exitCode }).toEqual({
      stdout: "message: x\nhandle is a net.Socket: true\nsocket-closed",
      exitCode: 0,
    });
  },
);

test.skipIf(isWindows || !nodeExe())(
  "receives a dgram.Socket handle from a node child and adopts its descriptor",
  async () => {
    const parentSource = [
      `const dgram = require("node:dgram");`,
      `const gotHandle = Promise.withResolvers();`,
      `const gotDatagram = Promise.withResolvers();`,
      `const childSource = 'const dgram = require("dgram"); const s = dgram.createSocket("udp4"); s.bind(0, "127.0.0.1", () => { process.send({ port: s.address().port }, s); });';`,
      `const child = Bun.spawn({`,
      `  cmd: [process.env.NODE_BIN, "-e", childSource],`,
      `  stdio: ["ignore", "inherit", "inherit"],`,
      `  serialization: "json",`,
      `  ipc(message, _subprocess, handle) { gotHandle.resolve({ message, handle }); },`,
      `  env: { ...process.env },`,
      `});`,
      `const { message, handle } = await gotHandle.promise;`,
      `console.log("message port:", typeof message.port === "number" && message.port > 0);`,
      `console.log("handle is a dgram.Socket:", handle instanceof dgram.Socket);`,
      `console.log("adopted port matches:", handle.address().port === message.port);`,
      `child.kill();`,
      `await child.exited;`,
      `handle.on("message", buf => gotDatagram.resolve(buf.toString()));`,
      `const sender = dgram.createSocket("udp4");`,
      `sender.send("ping", message.port, "127.0.0.1");`,
      `console.log("datagram:", await gotDatagram.promise);`,
      `sender.close();`,
      `handle.close();`,
      `console.log("done");`,
    ].join("\n");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentSource],
      env: { ...bunEnv, NODE_BIN: nodeExe()! },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: normalizeBunSnapshot(stdout), stderr, exitCode }).toEqual({
      stdout: [
        "message port: true",
        "handle is a dgram.Socket: true",
        "adopted port matches: true",
        "datagram: ping",
        "done",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  },
);
