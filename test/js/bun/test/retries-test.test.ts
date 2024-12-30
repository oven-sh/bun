import { expect, it } from "bun:test";

// Synchronous Test (3 Attempts)
let syncFailCount = 0;
it(
  "should retry sync test until max retries",
  () => {
    syncFailCount++;
    console.log(`Sync fail attempt: ${syncFailCount}`);
    expect(false).toBe(true);
  },
  { retry: 2 },
);

// Synchronous Retry Test (2 attempts - should succeed eventually)
let eventualPassCount = 0;
it(
  "should stop retrying once test passes",
  () => {
    eventualPassCount++;
    console.log(`Attempt until pass: ${eventualPassCount}`);
    expect(eventualPassCount >= 2).toBe(true);
  },
  { retry: 5 },
);

// Repeat Test (3 Attempts)
let repeatCount = 0;
it(
  "should repeat specified number of times",
  () => {
    repeatCount++;
    console.log(`Repeat count: ${repeatCount}`);
  },
  { repeats: 2 },
);

// Async Retry Test (3 Attempts)
let asyncFailCount = 0;
it(
  "should retry async failures",
  async () => {
    asyncFailCount++;
    console.log(`Async fail attempt: ${asyncFailCount}`);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(false).toBe(true);
  },
  { retry: 2 },
);

// Async Repeat Test (3 Attempts)
let asyncRepeatCount = 0;
it(
  "should repeat async tests",
  async () => {
    asyncRepeatCount++;
    console.log(`Async repeat: ${asyncRepeatCount}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  },
  { repeats: 2 },
);

// Edge Case for negative value (1 Attempt)
it(
  "should handle negative retry count as 0",
  () => {
    expect(false).toBe(true);
  },
  { retry: -1 },
);

it("should handle negative repeat count as 0", () => {}, { repeats: -1 });
