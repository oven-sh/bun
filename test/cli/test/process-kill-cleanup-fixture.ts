import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { idle } from "./process-kill-helpers";

let fromBeforeEach: ReturnType<typeof idle>;
let fromBeforeAll: ReturnType<typeof idle>;
let fromSyncTest: ReturnType<typeof idle>;
const fromConcurrentTests: ReturnType<typeof idle>[] = [];

describe("afterEach times out", () => {
  beforeEach(() => {
    fromBeforeEach = idle();
  });
  afterEach(() => new Promise(() => {}), 50);
  test("with a stuck afterEach", () => {});
});

describe("afterAll times out", () => {
  beforeAll(() => {
    fromBeforeAll = idle();
  });
  afterAll(() => new Promise(() => {}), 50);
  test("with a stuck afterAll", () => {});
});

test("runs past its timeout synchronously", () => {
  fromSyncTest = idle();
  Bun.sleepSync(100);
}, 20);

test.concurrent(
  "concurrent 1",
  () => {
    fromConcurrentTests.push(idle());
    return new Promise(() => {});
  },
  50,
);

test.concurrent(
  "concurrent 2",
  () => {
    fromConcurrentTests.push(idle());
    return new Promise(() => {});
  },
  50,
);

test("processes of timed-out tests and hooks are killed", async () => {
  // Only the timeouts' kills end these processes.
  await Promise.all([fromBeforeEach, fromBeforeAll, fromSyncTest, ...fromConcurrentTests].map(p => p.exited));
});

// Leaves the runner's timer armed for the next test.
test("short timeout", () => {}, 300);

test("a test without a timeout keeps its processes", async () => {
  const own = idle();
  await Bun.sleep(500);
  expect([own.exitCode, own.signalCode]).toEqual([null, null]);
  own.kill();
}, 0);
