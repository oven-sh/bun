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

// Differential event-loop liveness battery: each case spawns a subprocess and
// asserts it exits on its own. A parked or spinning loop never resolves
// `proc.exited`, so the test times out and `await using` kills the child.
it.concurrent("pure setImmediate chain 10k deep exits cleanly", async () => {
  const src = `
    let n = 0;
    function next() {
      if (++n < 10_000) setImmediate(next);
      else console.log("done " + n);
    }
    setImmediate(next);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("done 10000\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

it.concurrent("setImmediate scheduled from a timer callback fires", async () => {
  const src = `
    setTimeout(() => {
      setImmediate(() => console.log("immediate-after-timer"));
    }, 10);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("immediate-after-timer\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

it.concurrent("process with only a drained setImmediate chain exits 0 with no output", async () => {
  const src = `
    setImmediate(() => {
      setImmediate(() => {});
    });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});
