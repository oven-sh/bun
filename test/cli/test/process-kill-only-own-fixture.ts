import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Echoes stdin to stdout until it is killed.
function echo() {
  return Bun.spawn({
    cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });
}

async function roundTrip(proc: ReturnType<typeof echo>) {
  const reader = proc.stdout.getReader();
  proc.stdin.write("ping\n");
  proc.stdin.flush();
  const { value } = await reader.read();
  reader.releaseLock();
  return new TextDecoder().decode(value);
}

// Bun tracks this one under --isolate and --parallel.
const fromTopOfFile = echo();
let fromBeforeAll: ReturnType<typeof echo>;
let fromBeforeEach: ReturnType<typeof echo> | undefined;
let own: ReturnType<typeof echo>;

beforeAll(() => {
  fromBeforeAll = echo();
});

// Spawns once, in the first test's beforeEach.
beforeEach(() => {
  fromBeforeEach ??= echo();
});

afterAll(() => {
  for (const proc of [fromTopOfFile, fromBeforeAll, fromBeforeEach!]) proc.kill();
});

test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
}, 10);

// Its own timeout gives the processes time to start on a slow machine.
test("processes spawned before the test survive its timeout", async () => {
  // Only the timeout's kill ends this process.
  await own.exited;

  for (const proc of [fromTopOfFile, fromBeforeAll, fromBeforeEach!]) {
    expect(await roundTrip(proc)).toBe("ping\n");
  }
}, 30_000);
