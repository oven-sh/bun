import { test, expect, afterAll, beforeEach, afterEach } from "bun:test";

// Track concurrent executions
let currentlyExecuting = 0;
const executionLog: number[] = [];

beforeEach(() => {
  currentlyExecuting++;
  executionLog.push(currentlyExecuting);
});
afterEach(() => currentlyExecuting--);

function queue(fn: () => void) {
  resolveQueue.push(fn);
  if (!timeout) {
    const set = () =>
      setTimeout(() => {
        const cb = resolveQueue.shift();
        if (!cb) {
          timeout = false;
          return;
        }
        cb();
        set();
      }, 0);
    set();
    timeout = true;
  } else {
    timeout = true;
  }
}

const resolveQueue: (() => void)[] = [];
let timeout: boolean = false;

test.concurrent.each(Array.from({ length: 100 }, (_, i) => i + 1))(`concurrent test %d`, (i, done) => {
  console.log(`start test ${i}`);
  // Small delay to ensure tests overlap
  queue(() => {
    console.log(`end test ${i}`);
    done();
  });
});

// afterAll to report the max concurrency observed
afterAll(() => {
  // Log execution pattern
  console.log("Execution pattern: " + JSON.stringify(executionLog));
});
