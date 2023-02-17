import { it } from "bun:test";

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
