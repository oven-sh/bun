// @bun
//@ runDefaultWasm("--useJSPI=1")
// Ported from WebKit JSTests/wasm/stress/jspi-exceptions-from-wasm.js.
// Module bytes are pre-generated via WebKit's wasm Builder.

// Here we test the throwing of a Wasm exception in Wasm code called from JS via a
// promising() wrapper. The exception should turn into a rejection of the promise
// returned by promising().

const assert = {
  eq(lhs, rhs, msg) {
    if (lhs !== rhs) throw new Error(`Not the same: "${lhs}" and "${rhs}"` + (msg ? `: ${msg}` : ""));
  },
  truthy(v, msg) {
    if (!v) throw new Error(`Expected truthy` + (msg ? `: ${msg}` : ""));
  },
};

function instantiate(moduleBase64, importObject) {
  let bytes = Uint8Array.fromBase64(moduleBase64);
  return WebAssembly.instantiate(bytes, importObject).then(r => r.instance);
}

async function testWasmExceptionBecomesPromisingRejection() {
  // (module
  //   (tag $tag (param i32))
  //   (func $throwingWasmFunc (result i32)
  //     i32.const 42  ;; Exception payload
  //     throw $tag)   ;; Throw exception with tag 0
  //   (export "throwingWasmFunc" (func $throwingWasmFunc))
  //   (export "tag" (tag $tag)))
  const instance = await instantiate(
    "AGFzbQEAAAABCQJgAX8AYAABfwIBAAMCAQENAwEAAAcaAhB0aHJvd2luZ1dhc21GdW5jAAADdGFnBAAKCAEGAEEqCAAL",
    {},
  );

  const exceptionTag = instance.exports.tag;
  const promisingFunc = WebAssembly.promising(instance.exports.throwingWasmFunc);

  try {
    await promisingFunc();
    throw new Error("Promise should have been rejected");
  } catch (error) {
    assert.truthy(error instanceof WebAssembly.Exception, "Should be a WebAssembly.Exception");
    assert.eq(error.getArg(exceptionTag, 0), 42, "Exception payload should be 42");
  }
}

(async function () {
  await testWasmExceptionBecomesPromisingRejection();
})().then(
  () => print("OK"),
  e => {
    print("FAIL: " + e);
    if (e?.stack) print(e.stack);
    process.exit(1);
  },
);
