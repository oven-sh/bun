import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import perf from "perf_hooks";

test("stubs", () => {
  expect(perf.performance.nodeTiming).toBeObject();

  expect(perf.performance.now()).toBeNumber();
  expect(perf.performance.timeOrigin).toBeNumber();
  expect(perf.performance.eventLoopUtilization()).toBeObject();
});

test("doesn't throw", () => {
  expect(() => performance.mark("test")).not.toThrow();
  expect(() => performance.measure("test", "test")).not.toThrow();
  expect(() => performance.clearMarks()).not.toThrow();
  expect(() => performance.clearMeasures()).not.toThrow();
  expect(() => performance.getEntries()).not.toThrow();
  expect(() => performance.getEntriesByName("test")).not.toThrow();
  expect(() => performance.getEntriesByType("measure")).not.toThrow();
  expect(() => performance.now()).not.toThrow();
  expect(() => performance.timeOrigin).not.toThrow();
  expect(() => performance.markResourceTiming()).not.toThrow();
});

// supportedEntryTypes is the feature-detection surface: only types that can
// actually be delivered to an observer belong in it.
test("PerformanceObserver.supportedEntryTypes only lists deliverable types", () => {
  expect(globalThis.PerformanceObserver.supportedEntryTypes).toEqual(["mark", "measure"]);
  expect(perf.PerformanceObserver.supportedEntryTypes).toEqual(["dns", "http", "mark", "measure", "net"]);
});

test("node:dns operations are observable as 'dns' performance entries", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "dns-entries-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The fixture prints the delivered entries as one JSON array. If it failed
  // to do so, compare against its stderr instead so the failure is readable.
  const entries = stdout.trimStart().startsWith("[") ? JSON.parse(stdout) : null;
  expect({
    exitCode,
    entries: entries ? entries.map(entry => `${entry.entryType}:${entry.name}`) : stderr,
  }).toEqual({
    exitCode: 0,
    entries: [
      "dns:lookup", // dns.lookup()
      "dns:lookup", // dns.promises.lookup()
      "dns:lookupService", // dns.lookupService()
      "dns:lookupService", // dns.promises.lookupService()
      "dns:queryA", // dns.resolve4()
      "dns:queryA", // dns.promises.resolve4()
      "dns:queryTxt", // dns.resolve(hostname, "TXT")
      "dns:queryTxt", // dns.promises.resolve(hostname, "TXT")
      "dns:queryTxt", // new dns.Resolver().resolveTxt()
      "dns:queryTxt", // new dns.promises.Resolver().resolveTxt()
    ],
  });

  // Entries are delivered in dispatch order with sane timings.
  let previousStartTime = -Infinity;
  for (const entry of entries) {
    expect(entry.startTime).toBeGreaterThanOrEqual(previousStartTime);
    expect(entry.duration).toBeGreaterThanOrEqual(0);
    previousStartTime = entry.startTime;
  }

  // detail carries the same fields Node records for each operation kind.
  expect(entries[0].detail).toEqual({
    hostname: "localhost",
    family: 0,
    hints: 0,
    verbatim: expect.any(Boolean),
    order: expect.any(String),
    addresses: expect.any(Array),
  });
  expect(typeof entries[0].detail.addresses[0]).toBe("string");
  expect(entries[2].detail).toEqual({
    host: "127.0.0.1",
    port: 80,
    hostname: expect.any(String),
    service: expect.any(String),
  });
  expect(entries[4].detail).toEqual({
    host: "a.test",
    ttl: false,
    result: expect.any(Array),
  });
});
