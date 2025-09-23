import { test, expect, describe } from "bun:test";

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
const testCases = [[1, 2, 3], [4, 5, 9], [10, 20, 30]];
let eachCounter = 0;

test.serial.each(testCases)("serial.each test %#", (a, b, expected) => {
  const myIndex = eachCounter++;
  expect(a + b).toBe(expected);
  // These should run serially, so counter should increment predictably
  expect(myIndex).toBeLessThan(3);
});