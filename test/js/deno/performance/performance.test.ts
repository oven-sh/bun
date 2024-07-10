// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
import { createDenoTest } from "deno:harness";
const { test, assert, assertEquals, assertThrows } = createDenoTest(import.meta.path);

test({ permissions: { hrtime: false } }, async function performanceNow() {
  const { promise, resolve } = Promise.withResolvers<void>();
  const start = performance.now();
  let totalTime = 0;
  setTimeout(() => {
    const end = performance.now();
    totalTime = Math.ceil(end - start);
    resolve();
  }, 10);
  await promise;
  assert(totalTime >= 10);
});

test(function timeOrigin() {
  const origin = performance.timeOrigin;

  assert(origin > 0);
  assert(Date.now() >= origin);
});

test(function performanceToJSON() {
  const json = performance.toJSON();

  assert("timeOrigin" in json);
  assert(json.timeOrigin === performance.timeOrigin);
  // check there are no other keys
  assertEquals(Object.keys(json).length, 1);
});

test(function performanceMark() {
  const mark = performance.mark("test");
  assert(mark instanceof PerformanceMark);
  assertEquals(mark.detail, null);
  assertEquals(mark.name, "test");
  assertEquals(mark.entryType, "mark");
  assert(mark.startTime > 0);
  assertEquals(mark.duration, 0);
  const entries = performance.getEntries();
  assert(entries[entries.length - 1] === mark);
  const markEntries = performance.getEntriesByName("test", "mark");
  assert(markEntries[markEntries.length - 1] === mark);
});

test(function performanceMarkDetail() {
  const detail = { foo: "foo" };
  const mark = performance.mark("test", { detail });
  assert(mark instanceof PerformanceMark);
  assertEquals(mark.detail, { foo: "foo" });
  assert(mark.detail !== detail);
});
test(function performanceMarkDetailArrayBuffer() {
  const detail = new ArrayBuffer(10);
  const mark = performance.mark("test", { detail });
  assert(mark instanceof PerformanceMark);
  assertEquals(mark.detail, new ArrayBuffer(10));
  assert(mark.detail !== detail);
});

test(function performanceMarkDetailSubTypedArray() {
  class SubUint8Array extends Uint8Array {}
  const detail = new SubUint8Array([1, 2]);
  const mark = performance.mark("test", { detail });
  assert(mark instanceof PerformanceMark);
  assertEquals(mark.detail, new Uint8Array([1, 2]));
  assert(mark.detail !== detail);
});

test(function performanceMeasure() {
  const markName1 = "mark1";
  const measureName1 = "measure1";
  const measureName2 = "measure2";
  const mark1 = performance.mark(markName1);
  // Measure against the inaccurate-but-known-good wall clock
  const now = new Date().valueOf();
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        const later = new Date().valueOf();
        const measure1 = performance.measure(measureName1, markName1);
        const measure2 = performance.measure(measureName2, undefined, markName1);
        assert(measure1 instanceof PerformanceMeasure);
        assertEquals(measure1.detail, null);
        assertEquals(measure1.name, measureName1);
        assertEquals(measure1.entryType, "measure");
        assert(measure1.startTime > 0);
        assertEquals(measure2.startTime, 0);
        assertEquals(mark1.startTime, measure1.startTime);
        assertEquals(mark1.startTime, measure2.duration);
        assert(measure1.duration >= 100, `duration below 100ms: ${measure1.duration}`);
        assert(
          measure1.duration < (later - now) * 1.5,
          `duration exceeds 150% of wallclock time: ${measure1.duration}ms vs ${later - now}ms`,
        );
        const entries = performance.getEntries();
        assertEquals(entries[entries.length - 1], measure2);
        const entriesByName = performance.getEntriesByName(measureName1, "measure");
        assertEquals(entriesByName[entriesByName.length - 1], measure1);
        const measureEntries = performance.getEntriesByType("measure");
        assertEquals(measureEntries[measureEntries.length - 1], measure2);
      } catch (e) {
        return reject(e);
      }
      resolve();
    }, 100);
  });
});

test(function performanceObserver() {
  function perfObserver(list, observer) {
    list.getEntries().forEach(entry => {
      if (entry.entryType === "mark") {
        assertEquals(entry.name, "testmark");
      }
      if (entry.entryType === "measure") {
        assertEquals(entry.name, "testmeasure");
      }
    });
  }
  const observer = new PerformanceObserver(perfObserver);
  observer.observe({ entryTypes: ["measure", "mark"] });

  performance.mark("testmark");
  performance.measure("testmeasure", "testmark");
});

test(function performanceIllegalConstructor() {
  assertThrows(() => new Performance(), TypeError, "Illegal constructor");
  assertEquals(Performance.length, 0);
});

test(function performanceEntryIllegalConstructor() {
  assertThrows(() => new PerformanceEntry(), TypeError, "Illegal constructor");
  assertEquals(PerformanceEntry.length, 0);
});

test(function performanceMeasureIllegalConstructor() {
  assertThrows(() => new PerformanceMeasure(), TypeError, "Illegal constructor");
});

test(function performanceIsEventTarget() {
  assert(performance instanceof EventTarget);

  return new Promise(resolve => {
    const handler = () => {
      resolve();
    };

    performance.addEventListener("test", handler, { once: true });
    performance.dispatchEvent(new Event("test"));
  });
});
