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

test.skipIf(isWindows || !nodeExe())(
  "releases the descriptor of a received handle whose type it does not accept",
  async () => {
    const parentSource = [
      `const net = require("node:net");`,
      `let reported = false;`,
      `const handleFailed = Promise.withResolvers();`,
      `process.on("uncaughtException", () => {`,
      `  if (!reported) {`,
      `    reported = true;`,
      `    console.log("handle-error");`,
      `    handleFailed.resolve();`,
      `  }`,
      `});`,
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
      `  ipc() {},`,
      `  env: { ...process.env, HANDLE_PORT: String(server.address().port) },`,
      `});`,
      `await handleFailed.promise;`,
      `child.kill();`,
      `await child.exited;`,
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
      stdout: "handle-error\nsocket-closed",
      exitCode: 0,
    });
  },
);
