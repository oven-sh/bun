import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("getEntries after clearMarks/clearMeasures by name", () => {
  const { exitCode, stdout, stderr, signalCode } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
        performance.mark("a");
        performance.mark("a");
        performance.mark("b");
        performance.clearMarks("a");
        console.log(JSON.stringify(performance.getEntriesByType("mark").map(e => e.name)));
        performance.clearMarks("nonexistent");
        console.log(JSON.stringify(performance.getEntriesByType("mark").map(e => e.name)));
        performance.mark("c");
        console.log(JSON.stringify(performance.getEntriesByType("mark").map(e => e.name).sort()));

        performance.measure("m1", "b");
        performance.measure("m2", "b");
        performance.clearMeasures("m1");
        console.log(JSON.stringify(performance.getEntriesByType("measure").map(e => e.name)));
        performance.clearMeasures("nonexistent");
        console.log(JSON.stringify(performance.getEntriesByType("measure").map(e => e.name)));

        console.log(JSON.stringify(performance.getEntries().map(e => e.name).sort()));

        performance.clearMarks();
        performance.clearMeasures();
        console.log(JSON.stringify(performance.getEntries()));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrText = stderr
    .toString()
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect({ exitCode, signalCode, stderr: stderrText }).toEqual({
    exitCode: 0,
    signalCode: undefined,
    stderr: "",
  });
  expect(stdout.toString().trim().split("\n")).toEqual([
    '["b"]',
    '["b"]',
    '["b","c"]',
    '["m2"]',
    '["m2"]',
    '["b","c","m2"]',
    "[]",
  ]);
});

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
