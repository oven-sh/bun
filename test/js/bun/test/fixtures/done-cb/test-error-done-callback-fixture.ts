import { test } from "bun:test";

// So the source code doesn't appear in the error message preview.
const msg = String.fromCharCode(
  121,
  111,
  117,
  32,
  115,
  104,
  111,
  117,
  108,
  100,
  32,
  115,
  101,
  101,
  32,
  116,
  104,
  105,
  115,
);

test("error done callback (sync)", done => {
  done(new Error(msg + "(sync)"));
});

test("error done callback (async with await)", async done => {
  await 1;
  done(new Error(msg + "(async with await)"));
});

test("error done callback (async with Bun.sleep)", async done => {
  await Bun.sleep(0);
  done(new Error(msg + "(async with Bun.sleep)"));
});

test("error done callback (async)", done => {
  Promise.resolve().then(() => {
    done(new Error(msg + "(async)"));
  });
});

test("error done callback (async, setTimeout)", done => {
  setTimeout(() => {
    done(new Error(msg + "(async, setTimeout)"));
  }, 0);
});

test("error done callback (async, setImmediate)", done => {
  setImmediate(() => {
    done(new Error(msg + "(async, setImmediate)"));
  });
});

test("error done callback (async, nextTick)", done => {
  process.nextTick(() => {
    done(new Error(msg + "(async, nextTick)"));
  });
});

test("error done callback (async, setTimeout, Promise.resolve)", done => {
  setTimeout(() => {
    Promise.resolve().then(() => {
      done(new Error(msg + "(async, setTimeout, Promise.resolve)"));
    });
  }, 0);
});

test("error done callback (async, setImmediate, Promise.resolve)", done => {
  setImmediate(() => {
    Promise.resolve().then(() => {
      done(new Error(msg + "(async, setImmediate, Promise.resolve)"));
    });
  });
});
