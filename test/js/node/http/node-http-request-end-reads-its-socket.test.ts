import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("a request of a server that ends reads socket.destroyed, and emits what that read throws", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "node-http-request-end-reads-its-socket-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`GET, heard: nothing, null before end():
    uncaught TypeError
    uncaught TypeError
    answered HTTP/1.1 200 OK
GET, heard: nothing, null behind end():
    uncaught TypeError
    uncaught TypeError
    answered HTTP/1.1 200 OK
GET, heard: nothing, null when the response finishes:
    uncaught TypeError
    answered HTTP/1.1 200 OK
GET, heard: nothing, null when the response closes:
    uncaught TypeError
    answered HTTP/1.1 200 OK
GET, heard: error, null before end():
    uncaught TypeError
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
GET, heard: error, null behind end():
    uncaught TypeError
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
GET, heard: error, null when the response finishes:
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
GET, heard: error end, null before end():
    uncaught TypeError
    the request emits end
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
GET, heard: error end, null behind end():
    uncaught TypeError
    the request emits end
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
POST, heard: error, null before end():
    uncaught TypeError
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
POST, heard: error, null when the request ends:
    uncaught TypeError
    the request emits error with a TypeError
    answered HTTP/1.1 200 OK
POST, heard: error, null when the response finishes:
    answered HTTP/1.1 200 OK
`);
  expect(exitCode).toBe(0);
});
