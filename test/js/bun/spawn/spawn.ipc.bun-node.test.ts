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

// A `net.Socket` handle sent by a node child is delivered to the `ipc`
// callback's third argument. The received descriptor is a dup of the child's
// socket, so the server only observes the FIN once this process closes it too
// — that is what makes the close observable proof the descriptor was real and
// is not leaked.
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
      // The child is gone but its connection is still open: this process holds
      // the only remaining descriptor for it.
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

// `dgram.Socket` handles are not implemented: parsing must throw rather than
// deliver a half-built handle, and the received descriptor must be closed
// instead of leaked.
test.skipIf(isWindows || !nodeExe())(
  "releases the descriptor of a received handle whose type it does not accept",
  async () => {
    const parentSource = [
      `let reported = false;`,
      `const handleFailed = Promise.withResolvers();`,
      `process.on("uncaughtException", err => {`,
      `  if (!reported) {`,
      `    reported = true;`,
      `    console.log("handle-error:", err.message);`,
      `    handleFailed.resolve();`,
      `  }`,
      `});`,
      `const childSource = 'const dgram = require("dgram"); const s = dgram.createSocket("udp4"); s.bind(0, () => { process.send("x", s); });';`,
      `const child = Bun.spawn({`,
      `  cmd: [process.env.NODE_BIN, "-e", childSource],`,
      `  stdio: ["ignore", "inherit", "inherit"],`,
      `  serialization: "json",`,
      `  ipc(_message, _subprocess, handle) { console.log("unexpected handle:", String(handle)); },`,
      `  env: { ...process.env },`,
      `});`,
      `await handleFailed.promise;`,
      `child.kill();`,
      `await child.exited;`,
      `console.log("done");`,
    ].join("\n");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parentSource],
      env: { ...bunEnv, NODE_BIN: nodeExe()! },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: normalizeBunSnapshot(stdout), exitCode }).toEqual({
      stdout: "handle-error: TODO case dgram.Socket\ndone",
      exitCode: 0,
    });
  },
);
