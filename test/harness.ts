import { gc as bunGC, unsafe } from "bun";
import { heapStats } from "bun:jsc";
import { expect } from "bun:test";

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

export async function expectObjectTypeCount(type: string, count: number, maxWait = 10000) {
  gc();
  for (const wait = 20; maxWait > 0; maxWait -= wait) {
    if (heapStats().objectTypeCounts[type] === count) break;
    await new Promise(resolve => setTimeout(resolve, wait));
    gc();
  }
  expect(heapStats().objectTypeCounts[type]).toBe(count);
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
