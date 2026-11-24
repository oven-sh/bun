import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { echo, roundTrip } from "./process-kill-helpers";

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

// Its own timeout gives the processes time to start on a slow machine.
test("process spawned in beforeAll and beforeEach survives the timeout", async () => {
  // Only the timeout's kill ends this process.
  await own.exited;

  expect(await roundTrip(server)).toBe("ping\n");
  expect(await roundTrip(perTest!)).toBe("ping\n");
}, 30_000);
