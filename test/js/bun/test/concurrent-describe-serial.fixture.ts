import { afterEach, beforeEach, describe, expect, onTestFinished, test } from "bun:test";

// Prints one line for each scenario: serial or concurrent | how many times `run` ran | the scenario.
// A scenario is "concurrent" when one `run` starts before another one has ended.
function scenario(name: string, register: (run: () => Promise<void>) => void) {
  let runs = 0;
  let running = 0;
  let overlapped = false;
  register(async () => {
    runs++;
    if (++running > 1) overlapped = true;
    // One turn of the event loop. The other tests of a concurrent group have started by then.
    await new Promise(resolve => setImmediate(resolve));
    running--;
  });
  // Serial, so that it also ends the concurrent group of the tests before it.
  test.serial(`result: ${name}`, () => {
    console.log(`${overlapped ? "concurrent" : "serial    "} | ${runs} runs | ${name}`);
  });
}

// These follow the default of the file.
scenario("test", run => {
  test("a", run);
  test("b", run);
});
scenario("describe > test", run => {
  describe("group", () => {
    test("a", run);
    test("b", run);
  });
});

// These are serial, whatever the default of the file is.
scenario("describe.serial > test", run => {
  describe.serial("group", () => {
    test("a", run);
    test("b", run);
  });
});
scenario("describe.serial > test.each", run => {
  describe.serial("group", () => {
    test.each(["a", "b"])("%s", () => run());
  });
});
scenario("describe.serial.each > test", run => {
  describe.serial.each(["group"])("%s", () => {
    test("a", run);
    test("b", run);
  });
});
scenario("describe.serial > describe > test", run => {
  describe.serial("group", () => {
    describe("inner", () => {
      test("a", run);
      test("b", run);
    });
  });
});
scenario("describe.concurrent > describe.serial > test", run => {
  describe.concurrent("group", () => {
    describe.serial("inner", () => {
      test("a", run);
      test("b", run);
    });
  });
});
scenario("describe.serial > describe.concurrent > describe.serial > test", run => {
  describe.serial("group", () => {
    describe.concurrent("middle", () => {
      describe.serial("inner", () => {
        test("a", run);
        test("b", run);
      });
    });
  });
});
scenario("describe.serial > beforeEach, test, afterEach", run => {
  describe.serial("group", () => {
    beforeEach(run);
    afterEach(run);
    test("a", run);
    test("b", run);
  });
});
scenario("test, describe.serial > test, test", run => {
  test("before", run);
  describe.serial("group", () => {
    test("a", run);
  });
  test("after", run);
});
scenario("describe.concurrent > test.serial", run => {
  describe.concurrent("group", () => {
    test.serial("a", run);
    test.serial("b", run);
  });
});

// These are concurrent, whatever the default of the file is.
scenario("describe.serial > test.concurrent", run => {
  describe.serial("group", () => {
    test.concurrent("a", run);
    test.concurrent("b", run);
  });
});
scenario("describe.serial > describe.concurrent > test", run => {
  describe.serial("group", () => {
    describe.concurrent("inner", () => {
      test("a", run);
      test("b", run);
    });
  });
});
scenario("describe.concurrent > describe > test", run => {
  describe.concurrent("group", () => {
    describe("inner", () => {
      test("a", run);
      test("b", run);
    });
  });
});

// After the groups above, this one still follows the default of the file.
scenario("describe > describe > test", run => {
  describe("group", () => {
    describe("inner", () => {
      test("a", run);
      test("b", run);
    });
  });
});

// Each of these calls throws in a test that shares its group with another test.
describe.serial("calls that need a test to run alone", () => {
  test.each(["a", "b"])("%s", async name => {
    expect.assertions(1);
    onTestFinished(() => console.log(`onTestFinished ${name}`));
    await new Promise(resolve => setImmediate(resolve));
    expect(name).toBeString();
  });
});
