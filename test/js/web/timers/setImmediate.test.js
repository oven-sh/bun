import { it, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";
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
  var called = false;
  const id = setImmediate(() => {
    called = true;
    expect.unreachable();
  });
  clearImmediate(id);

  // assert it doesn't crash if you call clearImmediate twice
  clearImmediate(id);

  await new Promise((resolve, reject) => {
    setImmediate(resolve);
  });
  expect(called).toBe(false);
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
