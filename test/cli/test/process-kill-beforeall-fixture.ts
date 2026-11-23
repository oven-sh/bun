import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
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

async function expectEcho(proc: ReturnType<typeof echo>) {
  const reader = proc.stdout.getReader();
  proc.stdin.write("ping\n");
  proc.stdin.flush();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toBe("ping\n");
  reader.releaseLock();
}

let server: ReturnType<typeof echo>;
let perTest: ReturnType<typeof echo> | undefined;
let own: ReturnType<typeof echo>;

beforeAll(() => {
  server = echo();
});

// Spawns once, in the first test's beforeEach.
beforeEach(() => {
  perTest ??= echo();
});

afterAll(() => {
  server.kill();
  perTest?.kill();
});

test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
}, 10);

test("process spawned in beforeAll and beforeEach survives the timeout", async () => {
  // Only the timeout's kill ends this process.
  await own.exited;

  await expectEcho(server);
  await expectEcho(perTest!);
});
