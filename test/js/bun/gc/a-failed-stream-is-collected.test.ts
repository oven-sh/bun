import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

const count = 40;

async function afterFailing(holder: "nothing" | "property" | "set" | "stack") {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "a-failed-stream-is-collected.fixture.js"), String(count), holder],
    // A compilation on another thread is a root for the arguments of the call that started it.
    env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const { errors, ...heap } = JSON.parse(stdout);
  expect(errors).toEqual(Array(count).fill("Z_DATA_ERROR"));
  expect(exitCode).toBe(0);
  return heap as { left: number; rooted: string[]; onStack: string };
}

// A heap snapshot lists all roots but the stack. The count is for the references that it leaves out, like those from a Map or a Set.
test.concurrent("nothing holds on to a stream that failed", async () => {
  const { left, rooted } = await afterFailing("nothing");
  expect(rooted).toEqual([]);
  expect(left).toBeLessThan(count / 2);
});

describe.concurrent("the fixture", () => {
  test("finds a stream in a property", async () => {
    expect((await afterFailing("property")).rooted).toEqual([expect.stringMatching(/ > Object > Inflate$/)]);
  });

  test("counts the streams in a Set", async () => {
    expect((await afterFailing("set")).left).toBe(count);
  });

  test("does not go by what is on the stack", async () => {
    const { left, rooted, onStack } = await afterFailing("stack");
    expect({ rooted, onStack }).toEqual({ rooted: [], onStack: "object" });
    expect(left).toBeGreaterThan(0);
  });
});
