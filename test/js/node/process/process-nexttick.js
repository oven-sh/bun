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

await new Promise((resolve, reject) => {
  process.nextTick(
    (first, second) => {
      console.log(first, second);
      if (first !== 12345 || second !== "hello") reject(new Error("process.nextTick called with wrong arguments"));
      resolve(true);
    },
    12345,
    "hello",
  );
});
