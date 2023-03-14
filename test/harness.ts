export const bunEnv: any = {
  ...process.env,
  BUN_DEBUG_QUIET_LOGS: "1",
  NO_COLOR: "1",
  FORCE_COLOR: undefined,
};

export function bunExe() {
  return process.execPath;
}

export function gc(force: boolean = true) {
  Bun.gc(force);
}

// we must ensure that finalizers are run
// so that the reference-counting logic is exercised
export function gcTick(trace = false) {
  trace && console.trace("");
  // console.trace("hello");
  gc();
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

export function withoutAggressiveGC(block: () => unknown) {
  if (!Bun.unsafe.gcAggressionLevel) return block();

  const origGC = Bun.unsafe.gcAggressionLevel();
  Bun.unsafe.gcAggressionLevel(0);
  try {
    return block();
  } finally {
    Bun.unsafe.gcAggressionLevel(origGC);
  }
}
