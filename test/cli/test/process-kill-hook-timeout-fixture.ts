import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { echo, type EchoProcess, roundTrip } from "./process-kill-helpers";

let server: EchoProcess;
let hookProcess: EchoProcess | undefined;

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

// Its own timeout gives the process from beforeAll time to start on a slow machine.
test("process spawned in beforeAll survives the hook timeout", async () => {
  // Only the timeout's kill ends this process.
  await hookProcess!.exited;

  expect(await roundTrip(server)).toBe("ping\n");
}, 30_000);
