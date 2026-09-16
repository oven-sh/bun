import { expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { totalmem } from "node:os";

// https://github.com/oven-sh/bun/issues/9249
it("queueMicrotask.length is 1", () => {
  expect(queueMicrotask).toHaveLength(1);
});

it("queueMicrotask", async () => {
  // You can verify this test is correct by copy pasting this into a browser's console and checking it doesn't throw an error.
  var run = 0;

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
    var passed = false;
    try {
      queueMicrotask(1234);
    } catch (exception) {
      passed = exception instanceof TypeError;
    }

    if (!passed) throw new Error("queueMicrotask should throw a TypeError if the argument is not a function");
  }

  {
    var passed = false;
    try {
      queueMicrotask();
    } catch (exception) {
      passed = exception instanceof TypeError;
    }

    if (!passed) throw new Error("queueMicrotask should throw a TypeError if the argument is empty");
  }
});

// The microtask queue is a WTF::Deque: one buffer that doubles. WTF limits that buffer (it is a Vector
// buffer) to 2 GB, and 2^26 tasks is past that, so the 2^25th pending task aborted the process. That count
// is the limit itself, so the test cannot use a smaller one. The child needs about 3 GB.
//
// A release build takes 2 to 3 s. ASAN and debug builds need minutes to run 2^25 callbacks, so there the
// child exits when the queue has grown past the limit: 4 s with ASAN, 45 s in a debug build.
const slowBuild = isASAN || isDebug;

it.skipIf(totalmem() < 6 * 1024 ** 3)(
  "queueMicrotask accepts more than 2^25 pending callbacks",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const count = 2 ** 25 + 1;
          let ran = 0;
          const callback = () => { ran++; };
          for (let i = 0; i < count; i++) queueMicrotask(callback);
          console.log("queued", count);
          if (${slowBuild}) process.exit(0);
          queueMicrotask(() => console.log("ran", ran));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: slowBuild ? "queued 33554433\n" : "queued 33554433\nran 33554433\n",
      stderr: "",
      exitCode: 0,
    });
  },
  isDebug ? 300_000 : 60_000,
);
