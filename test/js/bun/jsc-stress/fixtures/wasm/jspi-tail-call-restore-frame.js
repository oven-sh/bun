// @bun
//@ runDefaultWasm("--useJSPI=1", "--useWasmTailCalls=true", "--wasmInliningMaximumWasmCalleeSize=0")
// Ported from WebKit JSTests/wasm/stress/jspi-tail-call-restore-frame.js.
// WAT sources are pre-compiled to base64 wasm using wabt.
//
// A tail call can leave a RestoreFrame on the stack between the tail callee and the
// original caller: IPInt writes one for a cross-instance return_call, BBQ and OMG for a
// return_call to any import. When the tail callee then suspends, the JSPI stack scan has
// to accept that frame (and relink it when the stack is implanted again).
// Regression test for https://github.com/oven-sh/bun/issues/46376.

const assert = {
  eq(lhs, rhs, msg) {
    if (lhs !== rhs) throw new Error(`Not the same: "${lhs}" and "${rhs}"` + (msg ? `: ${msg}` : ""));
  },
};

function instantiate(moduleBase64, importObject) {
  let bytes = Uint8Array.fromBase64(moduleBase64);
  return WebAssembly.instantiate(bytes, importObject).then(r => r.instance);
}

// Module A owns the Suspending import and a memory of its own (memory[0] = 42).
// (module
//   (import "env" "suspending" (func $suspending (param i32) (result i32)))
//   (memory (export "mem") 1)
//   (data (i32.const 0) "\2a\00\00\00")
//   ;; call -> suspend: a RestoreFrame sits above this frame.
//   (func (export "suspend_once") (param i32) (result i32)
//     local.get 0 call $suspending (i32.load (i32.const 0)) i32.add)
//   ;; return_call -> suspend: the RestoreFrame sits directly above the WasmToJS frame.
//   (func (export "tail_suspend") (param i32) (result i32)
//     local.get 0 return_call $suspending)
//   ;; Two suspensions in one activation.
//   (func (export "suspend_twice") (param i32) (result i32)
//     local.get 0 call $suspending call $suspending (i32.load (i32.const 0)) i32.add)
//   ;; Enough parameters to put some on the stack.
//   (func (export "suspend_many_params") (param i32 x10) (result i32)
//     sum of params, call $suspending, (i32.load (i32.const 0)) i32.add))
const watA =
  "AGFzbQEAAAABFAJgAX8Bf2AKf39/f39/f39/fwF/AhIBA2VudgpzdXNwZW5kaW5nAAADBQQAAAABBQMBAAEHSwUDbWVtAgAMc3VzcGVuZF9vbmNlAAEMdGFpbF9zdXNwZW5kAAINc3VzcGVuZF90d2ljZQADE3N1c3BlbmRfbWFueV9wYXJhbXMABApMBAwAIAAQAEEAKAIAagsGACAAEgALDgAgABAAEABBACgCAGoLJwAgACABaiACaiADaiAEaiAFaiAGaiAHaiAIaiAJahAAQQAoAgBqCwsKAQBBAAsEKgAAAA==";

// Module B tail-calls into A. Its memory differs from A's (memory[0] = 1000).
// (module
//   (import "a" "suspend_once" (func $suspend_once (param i32) (result i32)))
//   (import "a" "tail_suspend" (func $tail_suspend (param i32) (result i32)))
//   (import "a" "suspend_twice" (func $suspend_twice (param i32) (result i32)))
//   (import "a" "suspend_many_params" (func $suspend_many_params (param i32 x10) (result i32)))
//   (memory (export "mem") 1)
//   (data (i32.const 0) "\e8\03\00\00")
//   (func (export "tail_suspend_once") (param i32) (result i32) local.get 0 return_call $suspend_once)
//   (func (export "tail_tail_suspend") (param i32) (result i32) local.get 0 return_call $tail_suspend)
//   (func (export "tail_suspend_twice") (param i32) (result i32) local.get 0 return_call $suspend_twice)
//   (func (export "tail_suspend_many_params") (param i32) (result i32)
//     local.get 0 i32.const 1 ... i32.const 9 return_call $suspend_many_params)
//   ;; The RestoreFrame must restore B's instance: this reads B's memory after the call.
//   (func (export "call_tail_suspend_once") (param i32) (result i32)
//     local.get 0 call $tail_suspend_once_internal (i32.load (i32.const 0)) i32.add)
//   (func $tail_suspend_once_internal (param i32) (result i32) local.get 0 return_call $suspend_once))
const watB =
  "AGFzbQEAAAABFAJgAX8Bf2AKf39/f39/f39/fwF/Ak0EAWEMc3VzcGVuZF9vbmNlAAABYQx0YWlsX3N1c3BlbmQAAAFhDXN1c3BlbmRfdHdpY2UAAAFhE3N1c3BlbmRfbWFueV9wYXJhbXMAAQMHBgAAAAAAAAUDAQABB3gGA21lbQIAEXRhaWxfc3VzcGVuZF9vbmNlAAQRdGFpbF90YWlsX3N1c3BlbmQABRJ0YWlsX3N1c3BlbmRfdHdpY2UABhh0YWlsX3N1c3BlbmRfbWFueV9wYXJhbXMABxZjYWxsX3RhaWxfc3VzcGVuZF9vbmNlAAgKQwYGACAAEgALBgAgABIBCwYAIAASAgsYACAAQQFBAkEDQQRBBUEGQQdBCEEJEgMLDAAgABAJQQAoAgBqCwYAIAASAAsLCgEAQQALBOgDAAA=";

// Module C adds one more cross-instance tail call on top of B.
// (module
//   (import "b" "tail_suspend_once" (func $tail_suspend_once (param i32) (result i32)))
//   (func (export "tail_tail_suspend_once") (param i32) (result i32)
//     local.get 0 return_call $tail_suspend_once))
const watC =
  "AGFzbQEAAAABBgFgAX8BfwIXAQFiEXRhaWxfc3VzcGVuZF9vbmNlAAADAgEABxoBFnRhaWxfdGFpbF9zdXNwZW5kX29uY2UAAQoIAQYAIAASAAs=";

let suspendCount = 0;
async function suspending(x) {
  suspendCount++;
  await Promise.resolve();
  return x + 100;
}

const rejectionReason = new Error("rejected from the Suspending import");
async function rejecting(x) {
  throw rejectionReason;
}

async function run(instance, name, arg, expected) {
  const promising = WebAssembly.promising(instance.exports[name]);
  for (let i = 0; i < wasmTestLoopCount; i++) assert.eq(await promising(arg), expected, name);
}

async function test() {
  const a = await instantiate(watA, { env: { suspending: new WebAssembly.Suspending(suspending) } });
  const b = await instantiate(watB, { a: a.exports });
  const c = await instantiate(watC, { b: b.exports });

  // A -> return_call suspending, one module: BBQ and OMG write a RestoreFrame for it
  await run(a, "tail_suspend", 0, 0 + 100);
  // B -> return_call A.suspend_once -> call suspending
  await run(b, "tail_suspend_once", 1, 1 + 100 + 42);
  // B -> return_call A.tail_suspend -> return_call suspending
  await run(b, "tail_tail_suspend", 2, 2 + 100);
  // Two suspensions behind one RestoreFrame
  await run(b, "tail_suspend_twice", 3, 3 + 100 + 100 + 42);
  // Stack arguments shifted by the RestoreFrame
  await run(b, "tail_suspend_many_params", 4, 4 + 45 + 100 + 42);
  // B's instance is restored after the resumed tail callee returns
  await run(b, "call_tail_suspend_once", 5, 5 + 100 + 42 + 1000);
  // Two cross-instance tail calls in a row
  await run(c, "tail_tail_suspend_once", 6, 6 + 100 + 42);

  // One suspension per iteration of each case, two for suspend_twice.
  assert.eq(suspendCount, 8 * wasmTestLoopCount);
}

async function testRejection() {
  const a = await instantiate(watA, { env: { suspending: new WebAssembly.Suspending(rejecting) } });
  const b = await instantiate(watB, { a: a.exports });

  const promising = WebAssembly.promising(b.exports.tail_suspend_once);
  for (let i = 0; i < wasmTestLoopCount; i++) {
    try {
      await promising(1);
      throw new Error("expected a rejection");
    } catch (error) {
      assert.eq(error, rejectionReason);
    }
  }
}

await test();
await testRejection();
