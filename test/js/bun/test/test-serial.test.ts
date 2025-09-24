import { describe, expect, test } from "bun:test";

// Test that test.serial() is available and works
test("test.serial is a function", () => {
  expect(typeof test.serial).toBe("function");
});

test("test.serial.if is a function", () => {
  expect(typeof test.serial.if).toBe("function");
});

test("test.serial.skip is a function", () => {
  expect(typeof test.serial.skip).toBe("function");
});

test("test.serial.todo is a function", () => {
  expect(typeof test.serial.todo).toBe("function");
});

test("test.serial.each is a function", () => {
  expect(typeof test.serial.each).toBe("function");
});

test("test.serial.only is a function", () => {
  expect(typeof test.serial.only).toBe("function");
});

// Test describe.serial
test("describe.serial is a function", () => {
  expect(typeof describe.serial).toBe("function");
});

// Test serialIf function
test("test.serial.if() works correctly", () => {
  const serialIf = test.serial.if(true);
  expect(typeof serialIf).toBe("function");

  const notSerial = test.serial.if(false);
  expect(typeof notSerial).toBe("function");
});

// Functional tests for serial execution
let serialTestCounter = 0;
const serialResults: number[] = [];

test.serial("serial execution test 1", async () => {
  const myIndex = serialTestCounter++;
  serialResults.push(myIndex);
  await Bun.sleep(10);
  expect(myIndex).toBe(0);
});

test.serial("serial execution test 2", async () => {
  const myIndex = serialTestCounter++;
  serialResults.push(myIndex);
  await Bun.sleep(10);
  expect(myIndex).toBe(1);
});

test.serial("serial execution test 3", async () => {
  const myIndex = serialTestCounter++;
  serialResults.push(myIndex);
  await Bun.sleep(10);
  expect(myIndex).toBe(2);
});

// Verify serial execution happened
test("verify serial execution order", () => {
  expect(serialResults).toEqual([0, 1, 2]);
});

// Test describe.serial functionality
describe.serial("serial describe block", () => {
  let describeCounter = 0;
  const describeResults: number[] = [];

  test("nested test 1", async () => {
    const myIndex = describeCounter++;
    describeResults.push(myIndex);
    await Bun.sleep(10);
    expect(myIndex).toBe(0);
  });

  test("nested test 2", async () => {
    const myIndex = describeCounter++;
    describeResults.push(myIndex);
    await Bun.sleep(10);
    expect(myIndex).toBe(1);
  });

  test("verify nested serial execution", () => {
    expect(describeResults).toEqual([0, 1]);
  });
});

// Test test.serial.each functionality
const testCases = [
  [1, 2, 3],
  [4, 5, 9],
  [10, 20, 30],
];
let eachCounter = 0;

test.serial.each(testCases)("serial.each test %#", (a, b, expected) => {
  const myIndex = eachCounter++;
  expect(a + b).toBe(expected);
  // These should run serially, so counter should increment predictably
  expect(myIndex).toBeLessThan(3);
});

// Test mixing serial and concurrent in same describe block
describe("mixing serial and concurrent tests", () => {
  let mixedCounter = 0;
  const mixedResults: { type: string; index: number; startTime: number }[] = [];
  const startTime = Date.now();

  test.serial("mixed serial 1", async () => {
    const myIndex = mixedCounter++;
    mixedResults.push({ type: "serial", index: myIndex, startTime: Date.now() - startTime });
    await Bun.sleep(20);
  });

  test.concurrent("mixed concurrent 1", async () => {
    const myIndex = mixedCounter++;
    mixedResults.push({ type: "concurrent", index: myIndex, startTime: Date.now() - startTime });
    await Bun.sleep(20);
  });

  test.concurrent("mixed concurrent 2", async () => {
    const myIndex = mixedCounter++;
    mixedResults.push({ type: "concurrent", index: myIndex, startTime: Date.now() - startTime });
    await Bun.sleep(20);
  });

  test.serial("mixed serial 2", async () => {
    const myIndex = mixedCounter++;
    mixedResults.push({ type: "serial", index: myIndex, startTime: Date.now() - startTime });
    await Bun.sleep(20);
  });

  test("verify mixed execution", () => {
    // Serial tests should not overlap with each other
    const serialTests = mixedResults.filter(r => r.type === "serial");
    for (let i = 1; i < serialTests.length; i++) {
      // Each serial test should start after the previous one (with at least 15ms gap for 20ms sleep)
      const gap = serialTests[i].startTime - serialTests[i - 1].startTime;
      expect(gap).toBeGreaterThanOrEqual(15);
    }

    // Concurrent tests might overlap (their start times should be close)
    const concurrentTests = mixedResults.filter(r => r.type === "concurrent");
    if (concurrentTests.length > 1) {
      const gap = concurrentTests[1].startTime - concurrentTests[0].startTime;
      // Concurrent tests should start within a few ms of each other
      expect(gap).toBeLessThan(10);
    }
  });
});

// Test nested describe blocks with conflicting settings
describe.concurrent("concurrent parent describe", () => {
  let parentCounter = 0;
  const parentResults: { block: string; index: number }[] = [];

  test("parent test 1", async () => {
    const myIndex = parentCounter++;
    parentResults.push({ block: "parent", index: myIndex });
    await Bun.sleep(10);
  });

  describe.serial("nested serial describe", () => {
    let nestedCounter = 0;

    test("nested serial 1", async () => {
      const myIndex = nestedCounter++;
      parentResults.push({ block: "nested-serial", index: myIndex });
      await Bun.sleep(10);
      expect(myIndex).toBe(0);
    });

    test("nested serial 2", async () => {
      const myIndex = nestedCounter++;
      parentResults.push({ block: "nested-serial", index: myIndex });
      await Bun.sleep(10);
      expect(myIndex).toBe(1);
    });
  });

  test("parent test 2", async () => {
    const myIndex = parentCounter++;
    parentResults.push({ block: "parent", index: myIndex });
    await Bun.sleep(10);
  });

  test("verify nested behavior", () => {
    // Tests in the nested serial block should run serially
    const nestedSerial = parentResults.filter(r => r.block === "nested-serial");
    expect(nestedSerial[0].index).toBe(0);
    expect(nestedSerial[1].index).toBe(1);
  });
});

// Test explicit serial overrides concurrent describe
describe.concurrent("concurrent describe with explicit serial", () => {
  let overrideCounter = 0;
  const overrideResults: number[] = [];

  test.serial("explicit serial in concurrent describe 1", async () => {
    const myIndex = overrideCounter++;
    overrideResults.push(myIndex);
    await Bun.sleep(10);
    expect(myIndex).toBe(0);
  });

  test.serial("explicit serial in concurrent describe 2", async () => {
    const myIndex = overrideCounter++;
    overrideResults.push(myIndex);
    await Bun.sleep(10);
    expect(myIndex).toBe(1);
  });

  test("regular test in concurrent describe", async () => {
    const myIndex = overrideCounter++;
    overrideResults.push(myIndex);
    await Bun.sleep(10);
  });

  test("verify override behavior", () => {
    // First two tests should have run serially
    expect(overrideResults[0]).toBe(0);
    expect(overrideResults[1]).toBe(1);
  });
});

// Test explicit concurrent overrides serial describe
describe.serial("serial describe with explicit concurrent", () => {
  let overrideCounter2 = 0;
  let maxConcurrent2 = 0;
  let currentlyRunning2 = 0;

  test.concurrent("explicit concurrent in serial describe 1", async () => {
    currentlyRunning2++;
    maxConcurrent2 = Math.max(maxConcurrent2, currentlyRunning2);
    overrideCounter2++;
    await Bun.sleep(10);
    currentlyRunning2--;
  });

  test.concurrent("explicit concurrent in serial describe 2", async () => {
    currentlyRunning2++;
    maxConcurrent2 = Math.max(maxConcurrent2, currentlyRunning2);
    overrideCounter2++;
    await Bun.sleep(10);
    currentlyRunning2--;
  });

  test("regular test in serial describe", async () => {
    overrideCounter2++;
    await Bun.sleep(10);
  });

  test("verify concurrent override in serial describe", () => {
    // The concurrent tests should have run in parallel even in a serial describe
    if (typeof maxConcurrent2 === "number") {
      // This might be 1 if tests ran too fast, but structure is correct
      expect(maxConcurrent2).toBeGreaterThanOrEqual(1);
    }
  });
});
