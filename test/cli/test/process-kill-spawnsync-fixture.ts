import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { echo, roundTrip } from "./process-kill-helpers";

let server: ReturnType<typeof echo>;

beforeAll(() => {
  server = echo();
});

afterAll(() => {
  server.kill();
});

test("test timeout kills the process spawnSync waits for", () => {
  Bun.spawnSync({ cmd: [bunExe(), "-e", "setInterval(() => {}, 1000)"], env: bunEnv });
}, 100);

// Its own timeout gives the process from beforeAll time to start on a slow machine.
test("process spawned in beforeAll survives the timeout", async () => {
  expect(await roundTrip(server)).toBe("ping\n");
}, 30_000);
