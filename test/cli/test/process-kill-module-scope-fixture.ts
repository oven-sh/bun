import { afterAll, expect, test } from "bun:test";
import { echo, type EchoProcess, roundTrip } from "./process-kill-helpers";

// Started when the file loads. Bun tracks it under --isolate and --parallel (#46373).
const server = echo();
let own: EchoProcess;

afterAll(() => {
  server.kill();
});

test("test timeout kills the processes this test spawned", async () => {
  own = echo();
  await new Promise(() => {});
}, 10);

// Its own timeout gives the processes time to start on a slow machine.
test("process spawned at the top of the file survives the timeout", async () => {
  // Only the timeout's kill ends this process.
  await own.exited;

  expect(await roundTrip(server)).toBe("ping\n");
}, 30_000);
