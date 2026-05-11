// @bun
//@ runDefaultWasm("--useJSPI=1")
// Ported from WebKit JSTests/wasm/stress/jspi-rejection.js.
// WAT source is pre-compiled to base64 wasm using wabt.

const assert = {
  eq(lhs, rhs, msg) {
    if (lhs !== rhs) throw new Error(`Not the same: "${lhs}" and "${rhs}"` + (msg ? `: ${msg}` : ""));
  },
  falsy(v, msg) {
    if (v) throw new Error(`Expected falsy` + (msg ? `: ${msg}` : ""));
  },
};

function instantiate(moduleBase64, importObject) {
  let bytes = Uint8Array.fromBase64(moduleBase64);
  return WebAssembly.instantiate(bytes, importObject).then(r => r.instance);
}

// (module
//   (import "env" "createPromise" (func $createPromise (result i32)))
//   (import "env" "shouldNotBeCalled" (func $shouldNotBeCalled))
//   (func $testFunc (export "testFunc") (result i32)
//     call $createPromise
//     call $shouldNotBeCalled))
let wat = "AGFzbQEAAAABCAJgAAF/YAAAAi0CA2Vudg1jcmVhdGVQcm9taXNlAAADZW52EXNob3VsZE5vdEJlQ2FsbGVkAAEDAgEABwwBCHRlc3RGdW5jAAIKCAEGABAAEAEL";

let doRejectPromise = null;
let hasBeenCalledFlag = false;
const rejectionReason = new Error("Test rejection reason");

function createPromise() {
  const promise = new Promise((resolve, reject) => {
    doRejectPromise = reject;
  });
  return promise;
}

async function rejectByThrowing() {
  throw rejectionReason;
}

function shouldNotBeCalled() {
  hasBeenCalledFlag = true;
}

async function test1() {
  hasBeenCalledFlag = false;

  const instance = await instantiate(wat, {
    env: {
      createPromise: new WebAssembly.Suspending(createPromise),
      shouldNotBeCalled: shouldNotBeCalled,
    },
  });

  const promisingFunc = WebAssembly.promising(instance.exports.testFunc);
  const resultPromise = promisingFunc();
  doRejectPromise(rejectionReason);

  try {
    await resultPromise;
    throw new Error("test1: Promise should have been rejected");
  } catch (error) {
    assert.eq(error, rejectionReason, "test1: Rejection reason should match");
  }

  assert.falsy(hasBeenCalledFlag, "test1: WASM function has been resumed after rejection");
}

async function test2() {
  hasBeenCalledFlag = false;

  const instance = await instantiate(wat, {
    env: {
      createPromise: new WebAssembly.Suspending(rejectByThrowing),
      shouldNotBeCalled: shouldNotBeCalled,
    },
  });

  const promisingFunc = WebAssembly.promising(instance.exports.testFunc);
  const resultPromise = promisingFunc();

  try {
    await resultPromise;
    throw new Error("test2: Promise should have been rejected by throwing");
  } catch (error) {
    assert.eq(error, rejectionReason, "test2: Rejection reason should match");
  }

  assert.falsy(hasBeenCalledFlag, "test2: WASM function has been resumed after rejection");
}

(async function () {
  await test1();
  await test2();
})().then(
  () => print("OK"),
  e => {
    print("FAIL: " + e);
    if (e?.stack) print(e.stack);
    process.exit(1);
  },
);
