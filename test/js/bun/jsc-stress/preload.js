// JSC test harness polyfills for Bun
// These globals are used by JSC stress tests but are not available in Bun.

// noInline: hints JSC to not inline the function. No-op in Bun.
globalThis.noInline = require("bun:jsc").noInline;

// testLoopCount: iteration count to trigger JIT tier-up (Baseline -> DFG -> FTL).
globalThis.testLoopCount = 10000;

// print: JSC's output function, mapped to console.log.
globalThis.print = console.log;

// Wasm test polyfills
globalThis.callerIsBBQOrOMGCompiled = function () {
  return 1;
};
if (!globalThis.$) globalThis.$ = {};
if (!$.agent) $.agent = { report: function () {} };
