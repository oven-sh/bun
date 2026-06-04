import { jscInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// When an Error whose .stack was never accessed outlives its stack frames'
// functions, ErrorInstance::finalizeUnconditionally materializes the stack
// string from inside JSC's Heap::runEndPhase — which deliberately nulls out
// the current thread's atom string table around
// finalizeUnconditionalFinalizers() (and can run on the concurrent collector
// thread). Formatting + source-mapping the trace copies and destroys
// WTF::Strings that can be atoms (source URLs, function names,
// error.sourceURL): dropping the last reference to an atom in that context
// crashes with a null deref in WTF::stringTable() via
// AtomStringImpl::remove().
// https://github.com/oven-sh/bun/issues/17087

test("materializing error info in the GC finalizer context is atom-string-safe", () => {
  function someVeryUniquelyNamedFunction(): Error {
    return new Error("materialized in finalizer context");
  }
  const err = someVeryUniquelyNamedFunction();
  // Do NOT touch err.stack before the call — the helper needs the
  // unmaterialized frame vector, like the GC finalizer sees it.

  // Runs the registered onComputeErrorInfo callback with the thread's atom
  // string table nulled out (exactly like finalizeUnconditionalFinalizers
  // does), with the sourceURL out-param slot holding the last reference to
  // an atom string — modeling an error whose sourceURL's originating code
  // was already collected. Without the fix in computeErrorInfoWrapperToString
  // this crashes; with it, the VM's own atom table is installed for the
  // duration and the atom is removed from the table it actually lives in.
  const stack = jscInternals.materializeErrorInfoInGCFinalizerContext(err);
  // Function names are not resolved in the finalizer-safe mode, but the
  // frame's (source-mapped) location is.
  expect(stack).toContain("    at ");
  expect(stack).toContain("error-stack-gc-finalizer-atom.test.ts");

  // The error object is untouched and materializes normally afterwards.
  expect(err.stack).toContain("materialized in finalizer context");
  expect(err.stack).toContain("error-stack-gc-finalizer-atom.test.ts");
});

// End-to-end version exercising the real GC window. Each `new Function`
// creates a distinct executable; once `make` goes out of scope the function
// dies while the error (stack never accessed) stays alive, so the next full
// GC hits ErrorInstance::finalizeUnconditionally → computeErrorInfo →
// formatStackTrace → Bun__remapStackFramePositions with a nulled atom string
// table. In debug builds, a WTFStringImpl assertion additionally verifies
// that no atom string refcount is released without a usable atom table on
// the current thread.
test("GC-time stack materialization of errors with dead frames", () => {
  const keep: Error[] = ((globalThis as any).__errorGCFinalizerKeep = []);
  (function run() {
    for (let i = 0; i < 50; i++) {
      const make = new Function("msg", "return new Error('boom ' + msg)");
      keep.push(make(i));
    }
  })();
  Bun.gc(true);

  // Stacks were materialized during GC and are still readable.
  const stack = keep[5].stack!;
  expect(stack).toContain("at run (");
  expect(stack).toContain("error-stack-gc-finalizer-atom.test.ts");
  delete (globalThis as any).__errorGCFinalizerKeep;
});
