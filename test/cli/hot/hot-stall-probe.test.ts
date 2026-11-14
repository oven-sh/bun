// Temporary probe, not for merge. See hot-stall-probe.ts.
import { expect, it } from "bun:test";
import { isWindows } from "harness";
import { probeStall } from "./hot-stall-probe";

it.if(isWindows).each([1, 2])("probe without the JIT, run %d", async run => {
  expect(await probeStall("no JIT, run " + run, { BUN_JSC_useJIT: "0" })).toEqual([]);
});

it.if(isWindows)("probe with the JIT, after the runs without it", async () => {
  expect(await probeStall("JIT after no JIT")).toEqual([]);
});
