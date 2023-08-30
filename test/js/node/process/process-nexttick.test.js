"use strict";
// Can run this either in
// - node via `bunx jest process-nexttick.test.js`
// - bun via  `bun test process-nexttick.test.js`
const isBun = !!process.versions.bun;

// Node.js is missing this as of writing
if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    var resolve, reject;
    var promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

it("process.nextTick", async () => {
  // You can verify this test is correct by copy pasting this into a browser's console and checking it doesn't throw an error.
  var run = 0;
  var queueMicrotask = process.nextTick;

  await new Promise((resolve, reject) => {
    queueMicrotask(() => {
      if (run++ != 0) {
        reject(new Error("Microtask execution order is wrong: " + run));
      }
      queueMicrotask(() => {
        if (run++ != 3) {
          reject(new Error("Microtask execution order is wrong: " + run));
        }
      });
    });
    queueMicrotask(() => {
      if (run++ != 1) {
        reject(new Error("Microtask execution order is wrong: " + run));
      }
      queueMicrotask(() => {
        if (run++ != 4) {
          reject(new Error("Microtask execution order is wrong: " + run));
        }

        queueMicrotask(() => {
          if (run++ != 6) {
            reject(new Error("Microtask execution order is wrong: " + run));
          }
        });
      });
    });
    queueMicrotask(() => {
      if (run++ != 2) {
        reject(new Error("Microtask execution order is wrong: " + run));
      }
      queueMicrotask(() => {
        if (run++ != 5) {
          reject(new Error("Microtask execution order is wrong: " + run));
        }

        queueMicrotask(() => {
          if (run++ != 7) {
            reject(new Error("Microtask execution order is wrong: " + run));
          }
          resolve(true);
        });
      });
    });
  });

  {
    let passed = false;
    try {
      queueMicrotask(1234);
    } catch (exception) {
      if (isBun) {
        passed = exception instanceof TypeError;
      } else {
        // Node.js throws a non-TypeError TypeError
        passed = exception instanceof Error && exception.name === "TypeError";
      }
    }

    if (!passed) throw new Error("1: queueMicrotask should throw a TypeError if the argument is not a function");
  }

  {
    let passed = false;
    try {
      queueMicrotask();
    } catch (exception) {
      if (isBun) {
        passed = exception instanceof TypeError;
      } else {
        // Node.js throws a non-TypeError TypeError
        passed = exception instanceof Error && exception.name === "TypeError";
      }
    }

    if (!passed) throw new Error("2: queueMicrotask should throw a TypeError if the argument is empty");
  }
});

it("process.nextTick 2 args", async () => {
  await new Promise((resolve, reject) => {
    process.nextTick(
      (first, second) => {
        if (first !== 12345 || second !== "hello") reject(new Error("process.nextTick called with wrong arguments"));
        resolve(true);
      },
      12345,
      "hello",
    );
  });
});

it("process.nextTick 5 args", async () => {
  await new Promise((resolve, reject) => {
    var args = [12345, "hello", "hello", "hello", 5];
    process.nextTick((...receivedArgs) => {
      if (!args.every((arg, index) => arg === receivedArgs[index]))
        reject(new Error("process.nextTick called with wrong arguments"));
      resolve(true);
    }, ...args);
  });
});

it("process.nextTick runs after queueMicrotask", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const order = [];
  var nextTickI = 0;
  var microtaskI = 0;
  var remaining = 200;
  var runs = [];
  for (let i = 0; i < 100; i++) {
    queueMicrotask(() => {
      runs.push(queueMicrotask);
      order.push("queueMicrotask " + microtaskI++);
      if (--remaining === 0) resolve(order);
    });
    process.nextTick(() => {
      runs.push(process.nextTick);
      order.push("process.nextTick " + nextTickI++);
      if (--remaining === 0) resolve(order);
    });
  }

  await promise;
  expect(order).toEqual([
    "process.nextTick 0",
    "process.nextTick 1",
    "process.nextTick 2",
    "process.nextTick 3",
    "process.nextTick 4",
    "process.nextTick 5",
    "process.nextTick 6",
    "process.nextTick 7",
    "process.nextTick 8",
    "process.nextTick 9",
    "process.nextTick 10",
    "process.nextTick 11",
    "process.nextTick 12",
    "process.nextTick 13",
    "process.nextTick 14",
    "process.nextTick 15",
    "process.nextTick 16",
    "process.nextTick 17",
    "process.nextTick 18",
    "process.nextTick 19",
    "process.nextTick 20",
    "process.nextTick 21",
    "process.nextTick 22",
    "process.nextTick 23",
    "process.nextTick 24",
    "process.nextTick 25",
    "process.nextTick 26",
    "process.nextTick 27",
    "process.nextTick 28",
    "process.nextTick 29",
    "process.nextTick 30",
    "process.nextTick 31",
    "process.nextTick 32",
    "process.nextTick 33",
    "process.nextTick 34",
    "process.nextTick 35",
    "process.nextTick 36",
    "process.nextTick 37",
    "process.nextTick 38",
    "process.nextTick 39",
    "process.nextTick 40",
    "process.nextTick 41",
    "process.nextTick 42",
    "process.nextTick 43",
    "process.nextTick 44",
    "process.nextTick 45",
    "process.nextTick 46",
    "process.nextTick 47",
    "process.nextTick 48",
    "process.nextTick 49",
    "process.nextTick 50",
    "process.nextTick 51",
    "process.nextTick 52",
    "process.nextTick 53",
    "process.nextTick 54",
    "process.nextTick 55",
    "process.nextTick 56",
    "process.nextTick 57",
    "process.nextTick 58",
    "process.nextTick 59",
    "process.nextTick 60",
    "process.nextTick 61",
    "process.nextTick 62",
    "process.nextTick 63",
    "process.nextTick 64",
    "process.nextTick 65",
    "process.nextTick 66",
    "process.nextTick 67",
    "process.nextTick 68",
    "process.nextTick 69",
    "process.nextTick 70",
    "process.nextTick 71",
    "process.nextTick 72",
    "process.nextTick 73",
    "process.nextTick 74",
    "process.nextTick 75",
    "process.nextTick 76",
    "process.nextTick 77",
    "process.nextTick 78",
    "process.nextTick 79",
    "process.nextTick 80",
    "process.nextTick 81",
    "process.nextTick 82",
    "process.nextTick 83",
    "process.nextTick 84",
    "process.nextTick 85",
    "process.nextTick 86",
    "process.nextTick 87",
    "process.nextTick 88",
    "process.nextTick 89",
    "process.nextTick 90",
    "process.nextTick 91",
    "process.nextTick 92",
    "process.nextTick 93",
    "process.nextTick 94",
    "process.nextTick 95",
    "process.nextTick 96",
    "process.nextTick 97",
    "process.nextTick 98",
    "process.nextTick 99",
  ]);
  expect(runs.map(a => a.name)).toEqual([
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "nextTick",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
    "queueMicrotask",
  ]);
});

it("process.nextTick can be called 100,000 times", async () => {
  var county = 0;
  function ticky() {
    county++;
  }
  for (let i = 0; i < 100_000; i++) {
    process.nextTick(ticky);
  }

  await 1;
  expect(county).toBe(100_000);
});

it("process.nextTick works more than once", async () => {
  var county = 0;
  function ticky() {
    county++;
  }
  for (let i = 0; i < 1000; i++) {
    process.nextTick(ticky);
    await 1;
  }
  expect(county).toBe(1000);
});

// `enterWith` is problematic because it and `nextTick` both rely on
// JSC's `global.onEachMicrotaskTick`, and this test is designed to
// cover what happens when both are active
it("process.nextTick and AsyncLocalStorage.enterWith don't conflict", async () => {
  const AsyncLocalStorage = require("async_hooks").AsyncLocalStorage;
  const t = require("timers/promises");
  const storage = new AsyncLocalStorage();

  let call1 = false;
  let call2 = false;

  process.nextTick(() => (call1 = true));

  const p = Promise.withResolvers();
  const p2 = p.promise.then(() => {
    return storage.getStore(); // should not leak "hello"
  });
  const promise = Promise.resolve().then(async () => {
    storage.enterWith("hello");
    process.nextTick(() => (call2 = true));

    let didCall = false;
    let value = null;
    function ticky() {
      didCall = true;
      value = storage.getStore();
    }
    process.nextTick(ticky);
    await t.setTimeout(1);
    expect(didCall).toBe(true);
    expect(value).toBe("hello");
    expect(storage.getStore()).toBe("hello");
  });

  expect(storage.getStore()).toBe(undefined);
  await promise;
  p.resolve();
  expect(await p2).toBe(undefined);

  expect(call1).toBe(true);
  expect(call2).toBe(true);
});
