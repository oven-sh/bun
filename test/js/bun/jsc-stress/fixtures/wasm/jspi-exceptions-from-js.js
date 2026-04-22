// @bun
//@ runDefaultWasm("--useJSPI=1")
// Ported from WebKit JSTests/wasm/stress/jspi-exceptions-from-js.js.
// Module bytes are pre-generated via WebKit's wasm Builder.

// Here we test the throwing of Wasm exceptions in JS code called from Wasm code via a
// Suspending wrapper. An exception like that turns into a rejection of the promise
// returned to Suspending, with the exception captured as the rejection's reason. If the
// exception is a Wasm exception, it is propagated through the suspended Wasm stack. If
// uncaught in Wasm, an exception should turn back into a rejection of the promise
// returned by promising().

const assert = {
  eq(lhs, rhs, msg) {
    if (lhs !== rhs) throw new Error(`Not the same: "${lhs}" and "${rhs}"` + (msg ? `: ${msg}` : ""));
  },
  truthy(v, msg) {
    if (!v) throw new Error(`Expected truthy` + (msg ? `: ${msg}` : ""));
  },
  falsy(v, msg) {
    if (v) throw new Error(`Expected falsy` + (msg ? `: ${msg}` : ""));
  },
};

function instantiate(moduleBase64, importObject) {
  let bytes = Uint8Array.fromBase64(moduleBase64);
  return WebAssembly.instantiate(bytes, importObject).then(r => r.instance);
}

let exceptionTag = null;
let shouldNotBeCalledHasBeenCalled = false;

async function throwingFunc() {
  // Throw a Wasm exception with payload value 42
  throw new WebAssembly.Exception(exceptionTag, [42]);
}

function shouldNotBeCalled() {
  shouldNotBeCalledHasBeenCalled = true;
}

async function testCatchWasmExceptionThrownFromJS() {
  // (module
  //     (import "env" "throwingFunc" (func $throwingFunc (result i32)))
  //     (tag $tag (param i32))
  //     (func $testCatch (result i32)
  //       try (result i32)
  //         call $throwingFunc
  //       catch $tag
  //         ;; Exception caught, the payload is on the stack
  //       end
  //     )
  //     (export "testCatch" (func $testCatch))
  //     (export "tag" (tag $tag)))
  const instance = await instantiate(
    "AGFzbQEAAAABCQJgAAF/YAF/AAIUAQNlbnYMdGhyb3dpbmdGdW5jAAADAgEADQMBAAEHEwIJdGVzdENhdGNoAAEDdGFnBAAKCwEJAAZ/EAAHAAsL",
    {
      env: {
        throwingFunc: new WebAssembly.Suspending(throwingFunc),
      },
    },
  );

  exceptionTag = instance.exports.tag;
  const promisingFunc = WebAssembly.promising(instance.exports.testCatch);
  try {
    const result = await promisingFunc();
    assert.eq(result, 42, "Should catch exception and return payload value");
  } catch (error) {
    throw new Error("Exception has not been caught in Wasm code");
  }
}

async function testPropagateUncaughtWasmException() {
  shouldNotBeCalledHasBeenCalled = false;
  exceptionTag = new WebAssembly.Tag({ parameters: ["i32"] });

  // (module
  //   (import "env" "throwingFunc" (func $throwingFunc (result i32)))
  //   (import "env" "shouldNotBeCalled" (func $shouldNotBeCalled))
  //   (func $testNoCatch (result i32)
  //     call $throwingFunc
  //     ;; Should not reach this
  //     drop
  //     call $shouldNotBeCalled
  //     i32.const 999
  //   )
  //   (export "testNoCatch" (func $testNoCatch)))
  const instance = await instantiate(
    "AGFzbQEAAAABCAJgAAF/YAAAAiwCA2Vudgx0aHJvd2luZ0Z1bmMAAANlbnYRc2hvdWxkTm90QmVDYWxsZWQAAQMCAQAHDwELdGVzdE5vQ2F0Y2gAAgoMAQoAEAAaEAFB5wcL",
    {
      env: {
        throwingFunc: new WebAssembly.Suspending(throwingFunc),
        shouldNotBeCalled: shouldNotBeCalled,
      },
    },
  );

  const promisingFunc = WebAssembly.promising(instance.exports.testNoCatch);

  try {
    await promisingFunc();
    throw new Error("Exception should have propagated out");
  } catch (error) {
    assert.truthy(error instanceof WebAssembly.Exception, "Should be a WebAssembly.Exception");
    assert.eq(error.getArg(exceptionTag, 0), 42, "Exception payload should match");
  }

  assert.falsy(shouldNotBeCalledHasBeenCalled, "Wasm function should not have continued after exception");
}

async function returningFunc() {
  return 67;
}

async function secondThrowingFunc() {
  // Throw a Wasm exception with payload value 123
  throw new WebAssembly.Exception(exceptionTag, [123]);
}

async function testCatchAndResuspend() {
  // (module
  //   (import "env" "throwingFunc" (func $throwingFunc (result i32)))
  //   (import "env" "returningFunc" (func $returningFunc (result i32)))
  //   (tag $tag (param i32))
  //   (func $testCatchAndResuspend (result i32)
  //     try (result i32)
  //       call $throwingFunc
  //        ;; not supposed to reach here
  //       drop
  //       i32.const 999
  //       return
  //     catch $tag
  //       ;; exception payload 42 is on the stack
  //     end
  //     ;; Continue after catching exception
  //     call $returningFunc       ;; returns 67
  //     i32.add                   ;; return 67 + 42 = 109
  //   )
  //   (export "testCatchAndResuspend" (func $testCatchAndResuspend))
  //   (export "tag" (tag $tag)))
  const instance = await instantiate(
    "AGFzbQEAAAABCQJgAAF/YAF/AAIoAgNlbnYMdGhyb3dpbmdGdW5jAAADZW52DXJldHVybmluZ0Z1bmMAAAMCAQANAwEAAQcfAhV0ZXN0Q2F0Y2hBbmRSZXN1c3BlbmQAAgN0YWcEAAoTAREABn8QABpB5wcPBwALEAFqCw==",
    {
      env: {
        throwingFunc: new WebAssembly.Suspending(throwingFunc),
        returningFunc: new WebAssembly.Suspending(returningFunc),
      },
    },
  );

  exceptionTag = instance.exports.tag;
  const promisingFunc = WebAssembly.promising(instance.exports.testCatchAndResuspend);

  const result = await promisingFunc();
  assert.eq(result, 109, "Should catch exception, call returningFunc, add 42 and 67, and return 109");
}

async function testCatchAndThrowAgain() {
  // (module
  //   (import "env" "throwingFunc" (func $throwingFunc (result i32)))
  //   (import "env" "secondThrowingFunc" (func $secondThrowingFunc (result i32)))
  //   (tag $tag (param i32))
  //   (func $testCatchTwoExceptions (result i32)
  //     try (result i32)
  //       call $throwingFunc
  //       ;; not supposed to reach here
  //       drop
  //       i32.const 999
  //       return
  //     catch $tag
  //       ;; exception payload (42) is on the stack
  //     end
  //     ;; Now try calling second throwing function
  //     try (result i32)
  //       call $secondThrowingFunc
  //       ;; not supposed to reach here
  //       drop
  //       i32.const 888
  //     catch $tag
  //       ;; Exception caught, payload (123) is on stack
  //     end
  //     i32.add ;; return value: 123 + 42 == 165
  //   )
  //   (export "testCatchTwoExceptions" (func $testCatchTwoExceptions))
  //   (export "tag" (tag $tag)))
  const instance = await instantiate(
    "AGFzbQEAAAABCQJgAAF/YAF/AAItAgNlbnYMdGhyb3dpbmdGdW5jAAADZW52EnNlY29uZFRocm93aW5nRnVuYwAAAwIBAA0DAQABByACFnRlc3RDYXRjaFR3b0V4Y2VwdGlvbnMAAgN0YWcEAAobARkABn8QABpB5wcHAAsGfxABGkH4BgcAC2oL",
    {
      env: {
        throwingFunc: new WebAssembly.Suspending(throwingFunc),
        secondThrowingFunc: new WebAssembly.Suspending(secondThrowingFunc),
      },
    },
  );

  exceptionTag = instance.exports.tag;
  const promisingFunc = WebAssembly.promising(instance.exports.testCatchTwoExceptions);

  const result = await promisingFunc();
  assert.eq(result, 165, "Should catch both exceptions and return second exception payload");
}

(async function () {
  await testCatchWasmExceptionThrownFromJS();
  await testPropagateUncaughtWasmException();
  await testCatchAndResuspend();
  await testCatchAndThrowAgain();
})().then(
  () => print("OK"),
  e => {
    print("FAIL: " + e);
    if (e?.stack) print(e.stack);
    process.exit(1);
  },
);
