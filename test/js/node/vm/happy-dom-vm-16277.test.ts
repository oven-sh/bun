import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { bunEnv, bunExe } from "harness";
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
  expect(stack).toContain("is not a function");
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

test("stack materialized in ErrorInstance::finalizeUnconditionally does not crash", async () => {
  // ErrorInstance::finalizeUnconditionally runs on ErrorInstances that survive
  // a collection, and calls computeErrorInfo only when one of the captured
  // frames' callee or codeBlock is unmarked. So: retain the Error, but let the
  // per-iteration Function (and thus its CodeBlock) become unreachable, so the
  // reconstructed frame's codeBlock is unmarked at Bun.gc(true). On Bun 1.1.43
  // the child segfaults at address 0x5 inside Bun.gc(true); that crash trace is
  // the one in the original report.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `"use strict";
       const errs = [];
       for (let i = 0; i < 64; i++) {
         const inner = new Function("fn", "'use strict'; return fn();");
         const outer = new Function("inner", "fn", "'use strict'; return inner(fn);");
         try { outer(inner, null); } catch (e) { errs.push(e); }
       }
       Bun.gc(true);
       process.stdout.write(String(errs.length) + " " + typeof errs[0].stack + "\\n");`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("64 string\n");
  expect(proc.signalCode).toBeNull();
  expect(exitCode).toBe(0);
});

test("happy-dom Window (vm.createContext on the Window object) works", async () => {
  // happy-dom's `new Window()` is the only place in the test suite that calls
  // vm.createContext on a large real-world object and runs a Script in it.
  // Kept here (without the external fetch) so that integration path stays covered.
  const window = new Window({
    url: "http://localhost/",
    settings: { disableJavaScriptFileLoading: true },
  });
  try {
    expect(vm.isContext(window)).toBe(true);
    const { document } = window;
    document.body.innerHTML = `<div id="x">ok</div>`;
    expect(document.getElementById("x")?.textContent).toBe("ok");
  } finally {
    await window.happyDOM.close();
  }
});
