import { deepEquals } from "bun";
import {
  callerSourceOrigin,
  deserialize,
  drainMicrotasks,
  edenGC,
  fullGC,
  gcAndSweep,
  heapSize,
  heapStats,
  memoryUsage,
  noFTL,
  noOSRExitFuzzing,
  numberOfDFGCompiles,
  optimizeNextInvocation,
  profile,
  reoptimizationRetryCount,
  serialize,
  startSamplingProfiler,
  totalCompileTime,
  type SamplingProfile,
  type SamplingProfileStackFrame,
  type SamplingProfileStackTraces,
} from "bun:jsc";
import { expectType } from "./utilities";

const obj = { a: 1, b: 2 };
const buffer = serialize(obj);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = deserialize(buffer);

if (deepEquals(obj, clone)) {
  console.log("They are equal!");
}

expectType(gcAndSweep()).is<number>();
expectType(fullGC()).is<number>();
expectType(edenGC()).is<number>();
expectType(heapSize()).is<number>();

const stats = heapStats();
expectType(stats.heapSize).is<number>();
expectType(stats.objectTypeCounts).is<Record<string, number>>();
expectType(stats.protectedObjectTypeCounts).is<Record<string, number>>();

expectType(memoryUsage().current).is<number>();
expectType(memoryUsage().pageFaults).is<number>();

expectType(callerSourceOrigin()).is<string | null>();

function add(a: number, b: number) {
  return a + b;
}

expectType(noFTL(add)).is<void>();
expectType(noOSRExitFuzzing(add)).is<void>();
expectType(optimizeNextInvocation(add)).is<void>();
expectType(numberOfDFGCompiles(add)).is<number>();
expectType(reoptimizationRetryCount(add)).is<number>();
expectType(totalCompileTime()).is<number>();
expectType(drainMicrotasks()).is<void>();

startSamplingProfiler();
startSamplingProfiler("/tmp/profile");
startSamplingProfiler(undefined, 100);

const syncProfile = profile(add, 100, 1, 2);
expectType(syncProfile).is<SamplingProfile>();
expectType(syncProfile.functions).is<string>();
expectType(syncProfile.bytecodes).is<string>();
expectType(syncProfile.stackTraces).is<SamplingProfileStackTraces>();
expectType(syncProfile.stackTraces.interval).is<number>();
expectType(syncProfile.stackTraces.traces[0]!.frames).is<SamplingProfileStackFrame[]>();
expectType(syncProfile.stackTraces.traces[0]!.frames[0]!.sourceURL).is<string | undefined>();
expectType(syncProfile.stackTraces.sources[0]!.url).is<string | undefined>();

const asyncProfile = profile(async () => {});
expectType(asyncProfile).is<Promise<SamplingProfile>>();
