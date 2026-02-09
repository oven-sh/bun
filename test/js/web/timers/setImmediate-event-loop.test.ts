import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("setImmediate runs before setTimeout(0)", async () => {
  const order: string[] = [];

  await new Promise<void>(resolve => {
    setTimeout(() => {
      order.push("timeout");
      resolve();
    }, 0);

    setImmediate(() => {
      order.push("immediate");
    });
  });

  expect(order).toEqual(["immediate", "timeout"]);
});

test("nested setImmediate callbacks run on separate ticks", async () => {
  const order: string[] = [];

  await new Promise<void>(resolve => {
    setImmediate(() => {
      order.push("first");
      setImmediate(() => {
        order.push("third");
        resolve();
      });
    });
    setImmediate(() => {
      order.push("second");
    });
  });

  expect(order).toEqual(["first", "second", "third"]);
});

test("setImmediate microtasks drain between callbacks", async () => {
  const order: string[] = [];

  await new Promise<void>(resolve => {
    setImmediate(() => {
      order.push("immediate1");
      Promise.resolve().then(() => order.push("microtask-from-immediate1"));
    });
    setImmediate(() => {
      order.push("immediate2");
      Promise.resolve().then(() => {
        order.push("microtask-from-immediate2");
        resolve();
      });
    });
  });

  // Microtask from immediate1 should drain before immediate2 runs
  // (each runImmediateTask calls exitMaybeDrainMicrotasks)
  expect(order).toEqual(["immediate1", "microtask-from-immediate1", "immediate2", "microtask-from-immediate2"]);
});

test("setImmediate works with active I/O", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Promise<Response>(resolve => {
        setImmediate(() => {
          resolve(new Response("from-immediate"));
        });
      });
    },
  });

  try {
    const resp = await fetch(`http://localhost:${server.port}/`);
    expect(await resp.text()).toBe("from-immediate");
  } finally {
    server.stop(true);
  }
});

test("many setImmediate callbacks execute correctly", async () => {
  const count = 1000;
  let executed = 0;

  await new Promise<void>(resolve => {
    for (let i = 0; i < count; i++) {
      setImmediate(() => {
        executed++;
        if (executed === count) {
          resolve();
        }
      });
    }
  });

  expect(executed).toBe(count);
});

test("setImmediate works when spawned as subprocess", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let count = 0;
      function tick() {
        count++;
        if (count < 5) {
          setImmediate(tick);
        } else {
          console.log("done:" + count);
        }
      }
      setImmediate(tick);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("done:5");
  expect(exitCode).toBe(0);
});
