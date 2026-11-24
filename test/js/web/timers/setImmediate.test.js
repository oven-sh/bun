import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

it("setImmediate settles the top-level await of a preload while a socket is open", async () => {
  using dir = tempDir("set-immediate-preload", {
    // The first iterations consume the wakeups that are left from startup.
    "preload.js": `globalThis.socket = await Bun.udpSocket({});
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));`,
    "index.js": `socket.close();
      console.log("loaded");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=./preload.js", "index.js"],
    cwd: String(dir),
    // The GC timer would wake the event loop.
    env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "loaded\n", exitCode: 0 });
});
