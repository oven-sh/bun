import { listenOnSocket, Message, MessageType, ModuleStart, TestStatus } from "./TestReporterProtocol";
import { test, expect } from "bun:test";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { bunEnv, bunExe } from "harness";

test("listenOnSocket", async () => {
  const { resolve, promise } = Promise.withResolvers<Socket>();
  const server = createServer(socket => {
    resolve(socket);
  }).listen(0, "127.0.0.1");

  const testPath = path.join(__dirname, "simple-test-fixture.ts");
  const { address: host, port } = server.address();
  const { stdout, exited } = Bun.spawn({
    cmd: [bunExe(), "test", testPath, "--listen=" + `${host}:${port}`],
    env: { ...bunEnv, "BUN_DEBUG": "out.log", "BUN_DEBUG_ALL": "1", "BUN_DEBUG_QUIET_LOGS": undefined },
    stdout: "inherit",
    stderr: "inherit",
  });

  const messages: Message[] = [];
  const socket = await promise;
  const getIterator = await listenOnSocket(socket);
  for await (const message of getIterator()) {
    messages.push(message);
  }
  expect(messages).toEqual([
    {
      tag: MessageType.ModuleStart,
      path: testPath,
      id: 0,
    },
    {
      tag: MessageType.TestStart,
      id: 0,
      label: "should pass",
      byteOffset: expect.any(Number),
      byteLength: expect.any(Number),
      parent_id: 0,
      module_id: 0,
    },
    {
      tag: MessageType.TestEnd,
      id: 0,
      duration_ms: expect.any(Number),
      expectation_count: 1,
      status: TestStatus.pass,
    },
    {
      tag: MessageType.TestStart,
      id: 1,
      label: "should fail",
      byteOffset: expect.any(Number),
      byteLength: expect.any(Number),
      parent_id: 0,
      module_id: 0,
    },
    {
      tag: MessageType.TestEnd,
      id: 1,
      duration_ms: expect.any(Number),
      expectation_count: 1,
      status: TestStatus.fail,
    },
  ]);
});
