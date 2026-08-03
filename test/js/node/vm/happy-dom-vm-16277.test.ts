import { expect, test } from "bun:test";
import vm from "node:vm";

// Regression tests for https://github.com/oven-sh/bun/issues/16277
//
// The original report hit this via happy-dom loading a large external script
// that happened to tail-call a non-function. The root cause is that when a
// strict-mode tail call site invokes a value that is not callable, JSC
// reconstructs the elided tail-call frame from CallLinkInfo with a null
// `callee` and a non-null `codeBlock`. Bun's stack formatter dereferenced
// `frame.callee()` unconditionally, which segfaulted at address 0x5.
//
// The original test shelled out to YouTube via happy-dom's synchronous fetch
// (child_process.execFileSync) to obtain such a script, which made the test
// both network-dependent and very slow. These tests reproduce the exact crash
// deterministically and locally.

function makeTailCallError(): unknown {
  "use strict";
  function inner(fn: () => void): void {
    "use strict";
    return fn();
  }
  function outer(fn: () => void): void {
    "use strict";
    return inner(fn);
  }
  try {
    outer(null as any);
  } catch (e) {
    return e;
  }
  throw new Error("unreachable: outer(null) did not throw");
}

test("error stack includes the reconstructed tail-call frame", () => {
  const err = makeTailCallError() as Error;
  // The reconstructed frame has codeBlock=inner's but callee=null; the fix is
  // that Bun's stack formatter null-checks the callee before `->getObject()`.
  const stack = String(err.stack);
  expect(stack.includes("is not a function") || stack.includes("not callable")).toBe(true);
  expect(stack).toContain("inner");
  // `outer` was the tail caller of `inner`; its own frame is legitimately gone
  // (tail-call semantics), but `inner` must be present.
});

test("same path through a node:vm context", () => {
  const ctx = vm.createContext({});
  const err = vm.runInContext(
    `"use strict";
     function inner(fn) { "use strict"; return fn(); }
     function outer(fn) { "use strict"; return inner(fn); }
     var caught;
     try { outer(null); } catch (e) { caught = e; }
     caught;`,
    ctx,
  );
  expect(err).toBeTruthy();
  const stack = String((err as Error).stack);
  expect(stack).toContain("inner");
  expect(stack).toContain("is not a function");
});

test("error whose stack is materialized lazily during GC does not crash", () => {
  // Create Errors with tail-call frames and drop them without touching `.stack`
  // so JSC materializes the stack string in the ErrorInstance finalizer, which
  // runs under Heap::runEndPhase.
  for (let i = 0; i < 64; i++) makeTailCallError();
  Bun.gc(true);
  // If we got here the finalizer did not crash; finish with a positive check.
  const stack = String((makeTailCallError() as Error).stack);
  expect(stack).toContain("inner");
});
