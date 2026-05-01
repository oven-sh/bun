import { mustCall } from "../test/common/index.mjs";

process.on(
  "uncaughtException",
  mustCall(err => {
    if (err.message !== "oops") {
      throw err;
    }
  }, 3),
);

function checkNextTick(expected) {
  process.nextTick(
    mustCall(() => {
      if (counter !== expected) {
        throw new Error("oops: " + expected + " != " + counter);
      }
    }),
  );
}

var counter = 0;
setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(1);
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(2);
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(4);
    throw new Error("oops");
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(4);
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(6);
    throw new Error("oops");
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(6);
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(7);
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(8);
    setImmediate(
      mustCall(() => {
        counter++;
        checkNextTick(11);
      }),
    );
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(9);
    setImmediate(
      mustCall(() => {
        counter++;
        checkNextTick(12);
        throw new Error("oops");
      }),
    );
  }),
);

setImmediate(
  mustCall(() => {
    counter++;
    checkNextTick(10);
  }),
);
