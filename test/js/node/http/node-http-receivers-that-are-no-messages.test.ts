import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

async function expectOutput(program: string, expected: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "../../../aot/parallel/node-http", program)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.split("\n")).toEqual((await Bun.file(join(import.meta.dir, expected)).text()).split("\n"));
  expect(exitCode).toBe(0);
}

test("the accessors of a response answer for a plain object and for the prototype object", () => {
  const http = require("node:http");
  const response = new http.ServerResponse(new http.IncomingMessage(null));
  const answers: Record<string, string[]> = {};
  for (const key of [
    "socket",
    "connection",
    "headersSent",
    "writableLength",
    "writableNeedDrain",
    "writableHighWaterMark",
    "writableCorked",
  ]) {
    answers[key] = [{}, http.ServerResponse.prototype].map(receiver => typeof Reflect.get(response, key, receiver));
  }
  expect(answers).toEqual({
    socket: ["object", "object"],
    connection: ["undefined", "object"],
    headersSent: ["boolean", "boolean"],
    writableLength: ["number", "number"],
    writableNeedDrain: ["boolean", "boolean"],
    writableHighWaterMark: ["number", "number"],
    writableCorked: ["number", "number"],
  });
});

test("what the members of outgoing messages answer, throw, store and read for receivers that are no messages", async () => {
  await expectOutput(
    "members-outgoing-messages-receivers.js",
    "node-http-members-of-outgoing-messages-for-receivers-that-are-no-messages.expected.txt",
  );
}, 60_000);

test("what objects that hold what a response holds send, and responses that a constructor of the program makes", async () => {
  await expectOutput(
    "objects-that-hold-what-a-response-holds.js",
    "node-http-objects-that-hold-what-a-response-holds.expected.txt",
  );
}, 60_000);
