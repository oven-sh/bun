import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("memory usage of Performance", () => {
  const initial = estimateShallowMemoryUsageOf(performance);
  for (let i = 0; i < 1024; i++) {
    performance.mark(`mark-${i}`);
  }
  const final = estimateShallowMemoryUsageOf(performance);

  for (let i = 1; i < 1024; i++) {
    performance.measure(`measure-${i}`, `mark-${i}`, `mark-${i - 1}`);
  }
  const final2 = estimateShallowMemoryUsageOf(performance);
  expect(final2).toBeGreaterThan(final);
  expect(final).toBeGreaterThan(initial);
});

// clearMarks(name) / clearMeasures(name) erase a single name, so the buffer
// that getEntries* builds must still account for the entries left behind.
// Runs in a subprocess because `performance` is process-global.
const clearByNameFixture = /* js */ `
  const names = type => performance.getEntriesByType(type).map(entry => entry.name).sort();
  const results = {};

  performance.mark("a");
  performance.mark("b");
  performance.clearMarks("a");
  performance.mark("c");
  results.clearExistingMark = names("mark");

  performance.clearMarks();
  results.clearAllMarks = names("mark");

  performance.mark("x");
  performance.clearMarks("does-not-exist");
  performance.mark("y");
  results.clearMissingMark = names("mark");

  performance.clearMarks();
  performance.mark("dup");
  performance.mark("dup");
  performance.mark("other");
  performance.clearMarks("other");
  performance.mark("last");
  results.clearOneOfSeveralMarks = names("mark");

  performance.clearMarks();
  performance.mark("start");
  performance.measure("m1", "start");
  performance.measure("m2", "start");
  performance.clearMeasures("m1");
  performance.measure("m3", "start");
  results.clearExistingMeasure = names("measure");

  performance.clearMeasures("does-not-exist");
  performance.measure("m4", "start");
  results.clearMissingMeasure = names("measure");

  performance.clearMeasures();
  results.clearAllMeasures = names("measure");

  performance.clearMarks();
  performance.mark("g1");
  performance.mark("g2");
  performance.clearMarks("g1");
  performance.mark("g3");
  performance.measure("g4", "g2");
  results.getEntries = performance.getEntries().map(entry => entry.name).sort();

  console.log(JSON.stringify(results));
`;

test("clearMarks(name) and clearMeasures(name) keep the entry buffer in sync", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", clearByNameFixture],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // An aborted process prints nothing, so fall back to the raw text for a readable diff.
  const results = stdout.startsWith("{") ? JSON.parse(stdout) : stdout;

  expect({ results, exitCode, signalCode: proc.signalCode }).toEqual({
    results: {
      clearExistingMark: ["b", "c"],
      clearAllMarks: [],
      clearMissingMark: ["x", "y"],
      clearOneOfSeveralMarks: ["dup", "dup", "last"],
      clearExistingMeasure: ["m2", "m3"],
      clearMissingMeasure: ["m2", "m3", "m4"],
      clearAllMeasures: [],
      getEntries: ["g2", "g3", "g4"],
    },
    exitCode: 0,
    signalCode: null,
  });
});
