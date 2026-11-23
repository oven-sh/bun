import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Echoes stdin to stdout until it is killed.
const echo = () =>
  Bun.spawn({
    cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

let server: ReturnType<typeof echo>;
let own: ReturnType<typeof echo>;

beforeAll(() => {
  server = echo();
});

afterAll(() => {
  server.kill();
});

test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
}, 10);

test("process spawned in beforeAll survives the timeout", async () => {
  await own.exited;
  expect(own.killed || own.signalCode !== null).toBe(true);

  const reader = server.stdout.getReader();
  server.stdin.write("ping\n");
  server.stdin.flush();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toBe("ping\n");
  reader.releaseLock();
});
