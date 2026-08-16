// @bun
//@ runDefaultWasm("--useJSPI=1")
// Ported from WebKit JSTests/wasm/stress/jspi-basic.js.
// WAT sources are pre-compiled to base64 wasm using wabt.

// Basic JSPI invocation: a suspension that then returns directly out of Wasm,
// for different depths of overall Wasm stack.

const assert = {
  eq(lhs, rhs, msg) {
    if (lhs !== rhs) throw new Error(`Not the same: "${lhs}" and "${rhs}"` + (msg ? `: ${msg}` : ""));
  },
};

function instantiate(moduleBase64, importObject) {
  let bytes = Uint8Array.fromBase64(moduleBase64);
  return WebAssembly.instantiate(bytes, importObject).then(r => r.instance);
}

// (module
//   (import "env" "get_number" (func $get_number (result i32)))
//   (func $a (export "entry") (result i32)
//     i32.const 20 call $get_number i32.const 30 i32.add i32.add))
let depth1 = "AGFzbQEAAAABBQFgAAF/AhIBA2VudgpnZXRfbnVtYmVyAAADAgEABwkBBWVudHJ5AAEKDAEKAEEUEABBHmpqCw==";

// Same as depth1 with an extra caller frame ($z then $a).
let depth2 = "AGFzbQEAAAABBQFgAAF/AhIBA2VudgpnZXRfbnVtYmVyAAADAwIAAAcJAQVlbnRyeQACChcCCgBBFBAAQR5qagsKAEE8EAFBKGpqCw==";

// depth1 with two extra caller frames.
let depth3 = "AGFzbQEAAAABBQFgAAF/AhIBA2VudgpnZXRfbnVtYmVyAAADBAMAAAAHCQEFZW50cnkAAwokAwoAQRQQAEEeamoLCgBBPBABQShqagsMAEH4ABACQdAAamoL";

// depth1 with three extra caller frames.
let depth4 = "AGFzbQEAAAABBQFgAAF/AhIBA2VudgpnZXRfbnVtYmVyAAADBQQAAAAABwkBBWVudHJ5AAQKMAQKAEEUEABBHmpqCwoAQTwQAUEoamoLCwBBHhACQcYAamoLDABB+AAQA0HQAGpqCw==";

async function asyncReturn42() {
  return 42;
}

async function test(moduleBase64, expected) {
  const instance = await instantiate(moduleBase64, {
    env: {
      get_number: new WebAssembly.Suspending(asyncReturn42),
    },
  });
  const runTest = WebAssembly.promising(instance.exports.entry);

  for (let i = 0; i < wasmTestLoopCount; i++) {
    assert.eq(await runTest(), expected);
  }
}

// Loop with imported function call and sum accumulation.
// (module
//   (import "env" "get_value" (func $get_value (param i32) (result i32)))
//   (import "env" "print" (func $print (param i32)))
//   (func $loop_and_sum (export "loop_and_sum") (result i32)
//     (local $sum i32) (local $counter i32)
//     ... loop 10 times: sum += get_value(counter); counter++ ...
//     local.get $sum))
let loopTest = "AGFzbQEAAAABDgNgAX8Bf2ABfwBgAAF/Ah0CA2VudglnZXRfdmFsdWUAAANlbnYFcHJpbnQAAQMCAQIHEAEMbG9vcF9hbmRfc3VtAAIKLwEtAQJ/QQAhAEEAIQECQANAIAFBCk4NASABEAAgAGohACABQQFqIQEMAAsLIAAL";

let callCounter = 0;
async function asyncGetValue(expectedCounter) {
  assert.eq(callCounter, expectedCounter);
  return callCounter++;
}

async function testLoopAccumulation() {
  callCounter = 0; // Reset counter for this test

  const instance = await instantiate(loopTest, {
    env: {
      get_value: new WebAssembly.Suspending(asyncGetValue),
      print: print,
    },
  });
  const runTest = WebAssembly.promising(instance.exports.loop_and_sum);

  const result = await runTest();

  // Assert that the loop executed exactly 10 times
  assert.eq(callCounter, 10);
  // Assert that the computed sum is correct (0+1+2+3+4+5+6+7+8+9 = 45)
  assert.eq(result, 45);
}

// Test with a function that has 24 parameters and verify argument preservation
// entry() calls add_all() with 24 arguments, add_all() calls call_out(),
// call_out() calls get_number() (suspends), adds 100, returns to add_all(),
// add_all() then adds all 24 parameters to the result.
let manyParams = "AGFzbQEAAAABIQJgAAF/YBh/f39/f39/f39/f39/f39/f39/f39/f38BfwISAQNlbnYKZ2V0X251bWJlcgAAAwQDAAEABwkBBWVudHJ5AAMKjAEDCAAQAEHkAGoLTAAQASAAaiABaiACaiADaiAEaiAFaiAGaiAHaiAIaiAJaiAKaiALaiAMaiANaiAOaiAPaiAQaiARaiASaiATaiAUaiAVaiAWaiAXags0AEEBQQJBA0EEQQVBBkEHQQhBCUEKQQtBDEENQQ5BD0EQQRFBEkETQRRBFUEWQRdBGBACCw==";

(async function () {
  await test(depth1, 92);
  await test(depth2, 192);
  await test(depth3, 392);
  await test(depth4, 492);

  await testLoopAccumulation();

  // Expected: (42 + 100) + (1+2+3+...+24) = 142 + 300 = 442
  await test(manyParams, 442);
})().then(
  () => print("OK"),
  e => {
    print("FAIL: " + e);
    if (e?.stack) print(e.stack);
    process.exit(1);
  },
);
