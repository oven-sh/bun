import { it, expect } from "bun:test";

it("setTimeout", async () => {
  var lastID = -1;
  const result = await new Promise((resolve, reject) => {
    var numbers = [];

    for (let i = 0; i < 10; i++) {
      const id = setTimeout(
        (...args) => {
          numbers.push(i);
          if (i === 9) {
            resolve(numbers);
          }
          try {
            expect(args).toStrictEqual(["foo"]);
          } catch (err) {
            reject(err);
          }
        },
        i,
        "foo",
      );
      expect(+id > lastID).toBe(true);
      lastID = id;
    }
  });

  for (let j = 0; j < result.length; j++) {
    expect(result[j]).toBe(j);
  }
  expect(result.length).toBe(10);
});

it("clearTimeout", async () => {
  var called = false;

  // as object
  {
    const id = setTimeout(() => {
      called = true;
      expect(false).toBe(true);
    }, 0);
    clearTimeout(id);

    // assert it doesn't crash if you call clearTimeout twice
    clearTimeout(id);
  }

  // as number
  {
    const id = setTimeout(() => {
      called = true;
      expect(false).toBe(true);
    }, 0);
    clearTimeout(+id);

    // assert it doesn't crash if you call clearTimeout twice
    clearTimeout(+id);
  }

  await new Promise((resolve, reject) => {
    setTimeout(resolve, 10);
  });
  expect(called).toBe(false);
});

it("setTimeout(() => {}, 0)", async () => {
  var called = false;
  setTimeout(() => {
    called = true;
  }, 0);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(true);
  var ranFirst = -1;
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 1;
  }, 1);
  setTimeout(() => {
    if (ranFirst === -1) ranFirst = 0;
  }, 0);

  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(ranFirst).toBe(0);

  ranFirst = -1;

  const id = setTimeout(() => {
    ranFirst = 0;
  }, 0);
  clearTimeout(id);
  await new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, 10);
  });
  expect(ranFirst).toBe(-1);
});

it("Bun.sleep", async () => {
  var sleeps = 0;
  await Bun.sleep(0);
  const start = performance.now();
  sleeps++;
  await Bun.sleep(1);
  sleeps++;
  await Bun.sleep(2);
  sleeps++;
  const end = performance.now();
  expect((end - start) * 1000).toBeGreaterThanOrEqual(3);

  expect(sleeps).toBe(3);
});

it("Bun.sleep propagates exceptions", async () => {
  try {
    await Bun.sleep(1).then(a => {
      throw new Error("TestPassed");
    });
    throw "Should not reach here";
  } catch (err) {
    expect(err.message).toBe("TestPassed");
  }
});

it("Bun.sleep works with a Date object", async () => {
  var ten_ms = new Date();
  ten_ms.setMilliseconds(ten_ms.getMilliseconds() + 12);
  const now = performance.now();
  await Bun.sleep(ten_ms);
  expect(performance.now() - now).toBeGreaterThanOrEqual(10);
});

it("node.js timers/promises setTimeout propagates exceptions", async () => {
  const { setTimeout } = require("timers/promises");
  try {
    await setTimeout(1).then(a => {
      throw new Error("TestPassed");
    });
    throw "Should not reach here";
  } catch (err) {
    expect(err.message).toBe("TestPassed");
  }
});

it.skip("order of setTimeouts", done => {
  var nums = [];
  var maybeDone = cb => {
    return () => {
      cb();
      if (nums.length === 4) {
        try {
          expect(nums).toEqual([1, 2, 3, 4]);
          done();
        } catch (e) {
          done(e);
        }
      }
    };
  };
  setTimeout(maybeDone(() => nums.push(2)));
  setTimeout(maybeDone(() => nums.push(3), 0));
  setTimeout(maybeDone(() => nums.push(4), 1));
  Promise.resolve().then(maybeDone(() => nums.push(1)));
});

it("setTimeout should refresh N times", done => {
  let count = 0;
  let timer = setTimeout(() => {
    count++;
    timer.refresh();
  }, 50);

  setTimeout(() => {
    expect(count).toBeGreaterThanOrEqual(5);
    done();
  }, 300);
});

it("setTimeout if refreshed before run, should reschedule to run later", done => {
  let start = Date.now();
  let timer = setTimeout(() => {
    let end = Date.now();
    expect(end - start).toBeGreaterThanOrEqual(150);
    done();
  }, 100);

  setTimeout(() => {
    timer.refresh();
  }, 50);
});

it("setTimeout should refresh after already been run", done => {
  let count = 0;
  let timer = setTimeout(() => {
    count++;
  }, 50);

  setTimeout(() => {
    timer.refresh();
  }, 100);

  setTimeout(() => {
    expect(count).toBe(2);
    done();
  }, 300);
});

it("setTimeout should not refresh after clearTimeout", done => {
  let count = 0;
  let timer = setTimeout(() => {
    count++;
  }, 50);

  clearTimeout(timer);

  timer.refresh();

  setTimeout(() => {
    expect(count).toBe(0);
    done();
  }, 100);
});
