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

it("a promise that native code waits for can be settled by an immediate", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const socket = await Bun.udpSocket({});
      const setup = () => new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 3; i++) {
        await Bun.build({ entrypoints: ["/e.js"], files: { "/e.js": "" }, plugins: [{ name: "a", setup }] });
      }
      socket.close();
      console.log("built");`,
    ],
    // Its timer would wake the loop.
    env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "built\n", exitCode: 0 });
});
