// @bun
//@ runDefaultWasm("--useJSPI=1")
// Ported from WebKit JSTests/wasm/stress/jspi-resuspension.js.
// WAT sources are pre-compiled to base64 wasm using wabt.

// The different test modules test resuspension at different depths in the Wasm stack.

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
//   (import "env" "get_number2" (func $get_number2 (result i32)))
//   (func $c (result i32)
//     i32.const 500 call $get_number i32.const 500 call $get_number2 i32.add i32.add i32.add)
//   (func $b (result i32) call $c i32.const 100 i32.add)
//   (func $a (export "entry") (result i32) call $b i32.const 50 i32.add i32.const 1000 i32.sub))
let depth1 = "AGFzbQEAAAABBQFgAAF/AiQCA2VudgpnZXRfbnVtYmVyAAADZW52C2dldF9udW1iZXIyAAADBAMAAAAHCQEFZW50cnkABAomAw8AQfQDEABB9AMQAWpqagsIABACQeQAagsLABADQTJqQegHaws=";

// (func $c (result i32) call $get_number)
// (func $b (result i32) call $c i32.const 100 call $get_number2 i32.add i32.add)
// (func $a (export "entry") (result i32) call $b i32.const 50 i32.add)
let depth2 = "AGFzbQEAAAABBQFgAAF/AiQCA2VudgpnZXRfbnVtYmVyAAADZW52C2dldF9udW1iZXIyAAADBAMAAAAHCQEFZW50cnkABAoaAwQAEAALCwAQAkHkABABamoLBwAQA0Eyags=";

// (func $c (result i32) call $get_number)
// (func $b (result i32) call $c i32.const 100 i32.add)
// (func $a (export "entry") (result i32) call $b i32.const 50 i32.add call $get_number2 i32.add)
let depth3 = "AGFzbQEAAAABBQFgAAF/AiQCA2VudgpnZXRfbnVtYmVyAAADZW52C2dldF9udW1iZXIyAAADBAMAAAAHCQEFZW50cnkABAoaAwQAEAALCAAQAkHkAGoLCgAQA0EyahABags=";

// (func $c (result i32) call $get_number)
// (func $b (result i32) call $c i32.const 100 i32.add)
// (func $a (export "entry") (result i32) call $get_number2 i32.const 50 call $b i32.add i32.add)
let depth3inverted = "AGFzbQEAAAABBQFgAAF/AiQCA2VudgpnZXRfbnVtYmVyAAADZW52C2dldF9udW1iZXIyAAADBAMAAAAHCQEFZW50cnkABAoaAwQAEAALCAAQAkHkAGoLCgAQAUEyEANqags=";

async function asyncReturn42() {
  return 42;
}

async function asyncReturn67() {
  return 67;
}

async function test(moduleBase64) {
  const instance = await instantiate(moduleBase64, {
    env: {
      get_number: new WebAssembly.Suspending(asyncReturn42),
      get_number2: new WebAssembly.Suspending(asyncReturn67),
    },
  });

  const probe = WebAssembly.promising(instance.exports.entry);

  for (let i = 0; i < wasmTestLoopCount; i++) {
    assert.eq(await probe(), 259);
  }
}

(async function () {
  await test(depth1);
  await test(depth2);
  await test(depth3);
  await test(depth3inverted);
})().then(
  () => print("OK"),
  e => {
    print("FAIL: " + e);
    if (e?.stack) print(e.stack);
    process.exit(1);
  },
);
