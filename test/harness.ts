import { gc as bunGC, unsafe } from "bun";
import { heapStats } from "bun:jsc";

export const bunEnv: any = {
  ...process.env,
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
};

export function bunExe() {
  return process.execPath;
}

export function gc(force = true) {
  bunGC(force);
}

/**
 * The garbage collector is not 100% deterministic
 *
 * We want to assert that SOME of the objects are collected
 * But we cannot reliably assert that ALL of them are collected
 *
 * Therefore, we check that the count is less than or equal to the expected count
 *
 * @param type
 * @param count
 * @param maxWait
 * @returns
 */
export async function expectMaxObjectTypeCount(
  expect: typeof import("bun:test").expect,
  type: string,
  count: number,
  maxWait = 1000,
) {
  gc();
  if (heapStats().objectTypeCounts[type] <= count) return;
  gc(true);
  for (const wait = 20; maxWait > 0; maxWait -= wait) {
    if (heapStats().objectTypeCounts[type] <= count) break;
    await new Promise(resolve => setTimeout(resolve, wait));
    gc();
  }
  expect(heapStats().objectTypeCounts[type]).toBeLessThanOrEqual(count);
}

// we must ensure that finalizers are run
// so that the reference-counting logic is exercised
export function gcTick(trace = false) {
  trace && console.trace("");
  // console.trace("hello");
  gc();
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function withoutAggressiveGC(block: () => unknown) {
  if (!unsafe.gcAggressionLevel) return block();

  const origGC = unsafe.gcAggressionLevel();
  unsafe.gcAggressionLevel(0);
  try {
    return block();
  } finally {
    unsafe.gcAggressionLevel(origGC);
  }
}

export function hideFromStackTrace(block: CallableFunction) {
  Object.defineProperty(block, "name", {
    value: "::bunternal::",
    configurable: true,
    enumerable: true,
    writable: true,
  });
}
