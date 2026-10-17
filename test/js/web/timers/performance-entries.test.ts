import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect, test } from "bun:test";

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

test("getEntries() after clearMarks(name) and clearMeasures(name)", () => {
  performance.clearMarks();
  performance.clearMeasures();

  performance.mark("kept-mark");
  performance.mark("dropped-mark");
  performance.mark("dropped-mark");
  performance.clearMarks("dropped-mark");
  performance.clearMarks("missing-mark");

  performance.measure("kept-measure");
  performance.measure("dropped-measure");
  performance.measure("dropped-measure");
  performance.clearMeasures("dropped-measure");
  performance.clearMeasures("missing-measure");

  const names = (entries: PerformanceEntryList) => entries.map(entry => `${entry.entryType}:${entry.name}`).sort();
  expect(names(performance.getEntries())).toEqual(["mark:kept-mark", "measure:kept-measure"]);
  expect(names(performance.getEntriesByType("mark"))).toEqual(["mark:kept-mark"]);
  expect(names(performance.getEntriesByType("measure"))).toEqual(["measure:kept-measure"]);

  performance.mark("kept-mark");
  performance.measure("kept-measure");
  expect(names(performance.getEntries())).toEqual([
    "mark:kept-mark",
    "mark:kept-mark",
    "measure:kept-measure",
    "measure:kept-measure",
  ]);

  performance.clearMarks();
  performance.clearMeasures();
  expect(performance.getEntries()).toEqual([]);
});
