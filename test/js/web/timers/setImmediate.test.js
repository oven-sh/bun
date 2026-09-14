import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

it("setImmediate", async () => {
  var lastID = -1;
  const result = await new Promise((resolve, reject) => {
    var numbers = [];

    for (let i = 0; i < 10; i++) {
      const id = setImmediate((...args) => {
        numbers.push(i);
        if (i === 9) {
          resolve(numbers);
        }
        try {
          expect(args.length).toBe(1);
          expect(args[0]).toBe(i);
        } catch (err) {
          reject(err);
        }
      }, i);
      expect(id > lastID).toBe(true);
      lastID = id;
    }
  });

  for (let j = 0; j < result.length; j++) {
    expect(result[j]).toBe(j);
  }
  expect(result.length).toBe(10);
});

it("clearImmediate", async () => {
  const { resolve, reject, promise } = Promise.withResolvers();
  var called = false;
  const id = setImmediate(() => {
    called = true;
  });
  clearImmediate(id);

  // assert it doesn't crash if you call clearImmediate twice
  clearImmediate(id);

  expect(called).toBe(false);

  setImmediate(() => {
    if (called) {
      reject(new Error("clearImmediate didn't work"));
    } else {
      resolve();
    }
  });

  await promise;
});

it("clearImmediate with a numeric or string id does not clear a timeout or interval (Node.js parity)", async () => {
  const timeoutFired = Promise.withResolvers();
  const intervalFired = Promise.withResolvers();
  const t = setTimeout(() => timeoutFired.resolve(true), 1);
  const i = setInterval(() => {
    clearInterval(i);
    intervalFired.resolve(true);
  }, 1);
  clearImmediate(+t);
  clearImmediate(String(+t));
  clearImmediate(+i);
  clearImmediate(String(+i));
  expect(await timeoutFired.promise).toBe(true);
  expect(await intervalFired.promise).toBe(true);
});

it("setImmediate should not keep the process alive forever", async () => {
  let process = null;
  const success = async () => {
    process = Bun.spawn({
      cmd: [bunExe(), "run", path.join(import.meta.dir, "process-setImmediate-fixture.js")],
      stdout: "ignore",
      env: {
        ...bunEnv,
        NODE_ENV: undefined,
      },
    });
    await process.exited;
    process = null;
    return true;
  };

  const fail = async () => {
    await Bun.sleep(500);
    process?.kill();
    return false;
  };

  expect(await Promise.race([success(), fail()])).toBe(true);
});
