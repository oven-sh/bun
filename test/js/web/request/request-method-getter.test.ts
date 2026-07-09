import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { isASAN } from "harness";

// Fewer iterations under ASAN; still >> 512 so the "<512 new strings" assertion stays meaningful.
const cloneIters = isASAN ? 1024 * 64 : 1024 * 512;
const newIters = isASAN ? 1024 * 16 : 1024 * 128;

const requestOptions = [
  ["http://localhost:3000/"],
  [
    "http://localhost:3000/",
    {
      method: "GET",
    },
  ],
  [
    "http://localhost:3000/",
    {
      method: "POST",
    },
  ],
] as const;
test.each(requestOptions)("new Request(%s).clone().method doesnt create a new JSString every time", function () {
  // Start at a clean state.
  Bun.gc(true);

  // @ts-expect-error
  const request = new Request(...arguments);

  const {
    objectTypeCounts: { string: initialStrings },
  } = heapStats();
  for (let i = 0; i < cloneIters; i++) {
    request.clone().method;
  }
  const {
    objectTypeCounts: { string: finalStrings },
  } = heapStats();

  expect(finalStrings - initialStrings).toBeLessThan(512);
});

test.each(requestOptions)("new Request(%s).method doesnt create a new JSString every time", function () {
  // Start at a clean state.
  Bun.gc(true);

  const {
    objectTypeCounts: { string: initialStrings },
  } = heapStats();
  for (let i = 0; i < newIters; i++) {
    // @ts-expect-error
    const request = new Request(...arguments);
    request.method;
  }
  const {
    objectTypeCounts: { string: finalStrings },
  } = heapStats();

  expect(finalStrings - initialStrings).toBeLessThan(512);
});
