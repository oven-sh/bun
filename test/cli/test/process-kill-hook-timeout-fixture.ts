import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
let hookProcess: ReturnType<typeof echo> | undefined;

beforeAll(() => {
  server = echo();
});

afterAll(() => {
  server.kill();
});

// In its own describe, so its short timeout doesn't apply to the next test.
describe("beforeEach times out", () => {
  beforeEach(async () => {
    hookProcess = echo();
    await new Promise(() => {});
  }, 10);

  test("hook timeout kills the processes the hook spawned", () => {});
});

test("process spawned in beforeAll survives the hook timeout", async () => {
  // Only the timeout's kill ends this process.
  await hookProcess!.exited;

  const reader = server.stdout.getReader();
  server.stdin.write("ping\n");
  server.stdin.flush();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toBe("ping\n");
  reader.releaseLock();
});
